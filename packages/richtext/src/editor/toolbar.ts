/**
 * The toolbar contract — the editor analogue of the renderer's component
 * map. A toolbar is an array of `ToolbarItem`s; skins render them however
 * they like while the items (what is active, what a tap does) stay shared,
 * and plugins contribute additional items through the same shape.
 * `toolbarState` derives everything an item needs from the editor state.
 */

import type { List, ListItem } from '../ast/index.js';
import type { Command, CommandContext, Dispatch } from './commands.js';
import { setBlockType } from './commands.js';
import { insertTable, listKindOf, setLink, toggleList, type ListKind } from './commands-standard.js';
import { commands } from './registry.js';
import { marksAt } from './inline-flat.js';
import type { BlockEntry, EditorState } from './state.js';
import { isCrossBlock, selectionRange } from './state.js';
import { orderedRange, rangeLeafKeys, textSegments } from './range.js';
import { flatOf } from './steps.js';

export interface ToolbarState {
    /** Marks at the caret / covering the selection. */
    activeMarks: readonly string[];
    /** Type of the selection's block (`paragraph`, `heading`, `code`, …). */
    blockType: string | null;
    /** The block's own attributes (`depth`, `lang`, …). */
    attrs: Record<string, unknown>;
    /** Types of the block's ancestors, nearest first (`listItem`, `list`, `blockquote`, …). */
    ancestors: readonly string[];
    /** Kind of the enclosing list, when the block is in one. */
    listKind: ListKind | null;
    inBlockquote: boolean;
    canUndo: boolean;
    canRedo: boolean;
    mode: 'text' | 'block' | 'none';
    /**
     * The text selection spans blocks. `activeMarks` are then the marks
     * covering all of its text, `blockType` / `attrs` the ones every covered
     * block shares (`null` / `{}` when they differ), and `ancestors`,
     * `listKind`, `inBlockquote` describe the block where it starts.
     */
    multiBlock: boolean;
}

export interface ToolbarContext {
    state: EditorState;
    dispatch: Dispatch;
    ctx: CommandContext;
    /** Run a command (or undo/redo) against the editor; the command's result. */
    run(command: Command | 'undo' | 'redo'): boolean;
}

export interface ToolbarItem {
    /** Stable identifier (also the default render key). */
    id: string;
    /** Short text rendering (`B`, `H1`, …); skins may render `icon` instead. */
    label?: string;
    /** Icon hint for skins (an icon-set name). Never required. */
    icon?: string;
    /** Items with the same group render adjacent (skins may add separators). */
    group?: string;
    isActive?(tb: ToolbarState): boolean;
    /** Default: enabled whenever there is a selection. */
    isEnabled?(tb: ToolbarState): boolean;
    run(tc: ToolbarContext): void;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function ownAttrs(node: object): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) if (k !== 'type' && k !== 'key' && k !== 'children' && k !== 'position' && k !== 'value') out[k] = v;
    return out;
}

function ancestorTypes(state: EditorState, entry: BlockEntry): string[] {
    const out: string[] = [];
    let cur: BlockEntry | undefined = entry.parentKey === null ? undefined : state.index().get(entry.parentKey);
    while (cur) {
        out.push(cur.node.type);
        cur = cur.parentKey === null ? undefined : state.index().get(cur.parentKey);
    }
    return out;
}

/** The list kind and blockquote-ness of a block, from its ancestors (and itself when it is a list). */
function containerInfo(state: EditorState, entry: BlockEntry): { listKind: ListKind | null; inBlockquote: boolean } {
    let listKind: ListKind | null = null;
    let inBlockquote = false;
    if (entry.node.type === 'list') {
        const list = entry.node as List;
        if (list.children.length) listKind = listKindOf(list, list.children[0]);
    }
    let cur: BlockEntry | undefined = entry;
    while (cur) {
        if (cur.node.type === 'blockquote') inBlockquote = true;
        if (cur.node.type === 'listItem' && listKind === null && cur.parent.type === 'list') listKind = listKindOf(cur.parent as List, cur.node as ListItem);
        cur = cur.parentKey === null ? undefined : state.index().get(cur.parentKey);
    }
    return { listKind, inBlockquote };
}

const NONE: Omit<ToolbarState, 'canUndo' | 'canRedo'> = { activeMarks: [], blockType: null, attrs: {}, ancestors: [], listKind: null, inBlockquote: false, mode: 'none', multiBlock: false };

/** Two attribute records hold the same keys and values, whatever the key order (values compared as JSON). */
function sameAttrs(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const keys = Object.keys(a).filter((k) => a[k] !== undefined);
    if (keys.length !== Object.keys(b).filter((k) => b[k] !== undefined).length) return false;
    return keys.every((k) => k in b && JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

/** The marks at the caret / covering a text selection (empty for block selections and code). */
function activeMarksOf(state: EditorState, ctx: CommandContext): string[] {
    const sel = state.selection;
    if (!sel || sel.mode !== 'text') return [];
    if (isCrossBlock(sel)) {
        // The marks covering every text segment of the range.
        const segments = textSegments(state, sel, ctx);
        if (!segments.length) return [];
        return segments.map((s) => marksAt(s.flat, s.from, s.to, ctx.schema)).reduce((acc, marks) => acc.filter((m) => marks.includes(m)));
    }
    const entry = state.index().get(sel.anchor.key);
    if (!entry || ctx.schema.role(entry.node.type) !== 'textblock') return [];
    const { from, to } = selectionRange(sel);
    return marksAt(flatOf(entry.node, ctx), from, to, ctx.schema);
}

/** Derive the toolbar's view of the editor from the selection. */
export function toolbarState(state: EditorState, ctx: CommandContext, history: { canUndo(): boolean; canRedo(): boolean }): ToolbarState {
    const sel = state.selection;
    const base = { canUndo: history.canUndo(), canRedo: history.canRedo() };
    if (!sel) return { ...NONE, ...base };
    const multiBlock = sel.mode === 'text' && isCrossBlock(sel);
    const key = sel.mode === 'text' ? (multiBlock ? orderedRange(state, sel).from.key : sel.anchor.key) : sel.anchorKey;
    const entry = state.index().get(key);
    if (!entry) return { ...NONE, ...base };
    let blockType: string | null = entry.node.type;
    let attrs = ownAttrs(entry.node);
    if (multiBlock) {
        // Shared by every covered text / code block, else unset.
        const nodes = rangeLeafKeys(state, sel, ctx).map((k) => state.index().get(k)!.node);
        const same = nodes.every((n) => n.type === blockType && sameAttrs(ownAttrs(n), attrs));
        if (!nodes.every((n) => n.type === blockType)) blockType = null;
        if (!same) attrs = {};
    }
    return {
        activeMarks: activeMarksOf(state, ctx),
        blockType,
        attrs,
        ancestors: ancestorTypes(state, entry),
        ...containerInfo(state, entry),
        mode: sel.mode,
        multiBlock,
        ...base,
    };
}

// ---------------------------------------------------------------------------
// Default items
// ---------------------------------------------------------------------------

const markActive = (type: string) => (tb: ToolbarState) => tb.activeMarks.includes(type);
const headingActive = (depth: number) => (tb: ToolbarState) => tb.blockType === 'heading' && tb.attrs.depth === depth;
const listActive = (kind: ListKind) => (tb: ToolbarState) => tb.listKind === kind;
const inText = (tb: ToolbarState) => tb.mode === 'text';
const hasSelection = (tb: ToolbarState) => tb.mode !== 'none';

/** The type of the block the selection is in (its anchor block). */
function currentBlockType(tc: ToolbarContext): string | null {
    const sel = tc.state.selection;
    if (!sel) return null;
    return tc.state.index().get(sel.mode === 'text' ? sel.anchor.key : sel.anchorKey)?.node.type ?? null;
}

const listItem = (id: string, label: string, icon: string, kind: ListKind): ToolbarItem => ({
    id,
    label,
    icon,
    group: 'block',
    isActive: listActive(kind),
    isEnabled: hasSelection,
    // `toggleList` already unwraps when the block is in a list of this kind.
    run: (tc) => void tc.run(toggleList(kind)),
});

/** The neutral default item set, grouped `inline` | `block` | `insert` | `history`. */
export const defaultToolbarItems: ToolbarItem[] = [
    { id: 'bold', label: 'B', icon: 'bold', group: 'inline', isActive: markActive('strong'), isEnabled: inText, run: (tc) => void tc.run(commands.toggleStrong) },
    { id: 'italic', label: 'I', icon: 'italic', group: 'inline', isActive: markActive('emphasis'), isEnabled: inText, run: (tc) => void tc.run(commands.toggleEmphasis) },
    { id: 'strike', label: 'S', icon: 'strikethrough', group: 'inline', isActive: markActive('delete'), isEnabled: inText, run: (tc) => void tc.run(commands.toggleDelete) },
    { id: 'code', label: '</>', icon: 'code', group: 'inline', isActive: markActive('inlineCode'), isEnabled: inText, run: (tc) => void tc.run(commands.toggleInlineCode) },
    {
        // The neutral item links the selection to (or inserts) a placeholder
        // URL, and unlinks when already linked — a real link UX (URL prompt)
        // is a skin concern calling `setLink` itself.
        id: 'link',
        label: 'Link',
        icon: 'link',
        group: 'inline',
        isActive: markActive('link'),
        isEnabled: inText,
        run: (tc) => void tc.run(activeMarksOf(tc.state, tc.ctx).includes('link') ? commands.unsetLink : setLink('https://')),
    },
    { id: 'h1', label: 'H1', icon: 'heading-1', group: 'block', isActive: headingActive(1), isEnabled: hasSelection, run: (tc) => void tc.run(commands.setHeading1) },
    { id: 'h2', label: 'H2', icon: 'heading-2', group: 'block', isActive: headingActive(2), isEnabled: hasSelection, run: (tc) => void tc.run(commands.setHeading2) },
    { id: 'h3', label: 'H3', icon: 'heading-3', group: 'block', isActive: headingActive(3), isEnabled: hasSelection, run: (tc) => void tc.run(commands.setHeading3) },
    { id: 'paragraph', label: '¶', icon: 'pilcrow', group: 'block', isActive: (tb) => tb.blockType === 'paragraph', isEnabled: hasSelection, run: (tc) => void tc.run(commands.setParagraph) },
    listItem('bullet', '•', 'list', 'bullet'),
    listItem('ordered', '1.', 'list-ordered', 'ordered'),
    listItem('task', '☑', 'list-checks', 'task'),
    {
        id: 'quote',
        label: '❝',
        icon: 'quote',
        group: 'block',
        isActive: (tb) => tb.inBlockquote,
        isEnabled: hasSelection,
        run: (tc) => void (tc.run(commands.liftOutOfBlockquote) || tc.run(commands.wrapInBlockquote)),
    },
    {
        id: 'codeBlock',
        label: '{ }',
        icon: 'code-block',
        group: 'block',
        isActive: (tb) => tb.blockType === 'code',
        isEnabled: hasSelection,
        run: (tc) => void tc.run(currentBlockType(tc) === 'code' ? commands.setParagraph : setBlockType('code')),
    },
    { id: 'hr', label: '—', icon: 'minus', group: 'insert', isEnabled: hasSelection, run: (tc) => void tc.run(commands.insertThematicBreak) },
    { id: 'table', label: '⊞', icon: 'table', group: 'insert', isEnabled: hasSelection, run: (tc) => void tc.run(insertTable()) },
    { id: 'undo', label: '↶', icon: 'undo', group: 'history', isEnabled: (tb) => tb.canUndo, run: (tc) => void tc.run('undo') },
    { id: 'redo', label: '↷', icon: 'redo', group: 'history', isEnabled: (tb) => tb.canRedo, run: (tc) => void tc.run('redo') },
];
