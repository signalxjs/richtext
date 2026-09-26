/**
 * Commands — every user-level edit, written once against the state and
 * expressed as a transaction. A command returns `false` when it does not
 * apply (so a keymap can fall through) and, when given `dispatch`, submits
 * its transaction. Commands are pure: they read the state and produce steps;
 * surfaces and views never edit the tree themselves.
 *
 * This module is the format- and vocabulary-agnostic core: it knows roles,
 * `schema.defaultBlock` and the spec flags (`isolating`, `collapsesWhenEmpty`,
 * `moveAsUnit`, `splitsTo`), never a node type by name. The standard
 * vocabulary's commands (lists, quotes, tables, headings, links) are in
 * `commands-standard.ts`; `registry.ts` names them all.
 */

import type { BlockContent, PhrasingContent, Root } from '../ast/index.js';
import { plainTextFormat, type DocumentFormat } from '../document/index.js';
import type { RichTextPlugin } from '../plugin/index.js';
import type { NodeSpec, Schema } from '../schema/index.js';
import type { InlineFlat } from './inline-flat.js';
import { ATOM_CHAR, concatFlat, marksAt, sliceFlat, toFlat, toInline, toggleMark as toggleFlatMark } from './inline-flat.js';
import { pickPasteFormat, type PasteData } from './paste.js';
import type { BlockEntry, EditorBlock, EditorSelection, EditorState, TextSelection } from './state.js';
import { blockSelection, normalizeDoc, selectionRange, textSelection } from './state.js';
import type { Step } from './steps.js';
import { flatOf } from './steps.js';
import type { Transaction, TransactionMeta } from './transaction.js';

export interface CommandContext {
    schema: Schema;
    /** The formats the editor reads: the primary one first (`setSource` without an id, and the first paste candidate). */
    formats: readonly DocumentFormat[];
    /** Plugins threaded into every parse. */
    plugins?: readonly RichTextPlugin[];
}

export type Dispatch = (tr: Transaction) => void;

/** A command: inspect `state`, optionally dispatch, report applicability. */
export type Command = (state: EditorState, dispatch: Dispatch | undefined, ctx: CommandContext) => boolean;

export const meta = (extra: Partial<TransactionMeta> = {}): TransactionMeta => ({ origin: 'command', ...extra });

/** The first command that applies wins (the ProseMirror `chainCommands`). */
export function chain(...commands: readonly Command[]): Command {
    return (state, dispatch, ctx) => {
        for (const command of commands) if (command(state, dispatch, ctx)) return true;
        return false;
    };
}

// ---------------------------------------------------------------------------
// Helpers (shared with the standard commands)
// ---------------------------------------------------------------------------

export function textSel(state: EditorState): TextSelection | null {
    return state.selection && state.selection.mode === 'text' ? state.selection : null;
}

export function entryOf(state: EditorState, key: string): BlockEntry | undefined {
    return state.index().get(key);
}

export function specOf(node: { type: string }, ctx: CommandContext): NodeSpec | undefined {
    return ctx.schema.get(node.type);
}

export function inlineFlat(state: EditorState, key: string, ctx: CommandContext): InlineFlat | null {
    const entry = entryOf(state, key);
    if (!entry || ctx.schema.role(entry.node.type) !== 'textblock') return null;
    return flatOf(entry.node, ctx);
}

export function isTextBlock(state: EditorState, key: string, ctx: CommandContext): boolean {
    const entry = entryOf(state, key);
    return !!entry && ctx.schema.role(entry.node.type) === 'textblock';
}

/** First editable descendant of a block (or itself). */
export function firstEditable(node: EditorBlock, ctx: CommandContext): EditorBlock | undefined {
    const role = ctx.schema.role(node.type);
    if (role === 'textblock' || role === 'code') return node;
    const spec = ctx.schema.get(node.type);
    if (spec?.entry) {
        const e = spec.entry(node);
        if (e) return firstEditable(e as EditorBlock, ctx);
    }
    for (const child of (node as { children?: EditorBlock[] }).children ?? []) {
        const found = firstEditable(child, ctx);
        if (found) return found;
    }
    return undefined;
}

export function lastEditable(node: EditorBlock, ctx: CommandContext): EditorBlock | undefined {
    const role = ctx.schema.role(node.type);
    if (role === 'textblock' || role === 'code') return node;
    const children = (node as { children?: EditorBlock[] }).children ?? [];
    for (let i = children.length - 1; i >= 0; i--) {
        const found = lastEditable(children[i], ctx);
        if (found) return found;
    }
    return undefined;
}

export function lengthOf(node: EditorBlock, ctx: CommandContext): number {
    const role = ctx.schema.role(node.type);
    if (role === 'code') return (node as { value: string }).value.length;
    if (role === 'textblock') return toFlat((node as { children: PhrasingContent[] }).children, ctx.schema).text.length;
    return 0;
}

/** An empty block of the schema's default type (a paragraph in the standard vocabulary). */
export function defaultBlock(ctx: CommandContext, children: PhrasingContent[] = []): BlockContent {
    const spec = ctx.schema.get(ctx.schema.defaultBlock);
    return spec?.fromInline ? spec.fromInline(children) : ctx.schema.createBlock(ctx.schema.defaultBlock);
}

/** The key a node will have after `insertBlock` under `parentKey` at `index`. */
export function keyAt(parentKey: string | null, index: number): string {
    return parentKey === null ? `b-${index}` : `${parentKey}.${index}`;
}

/** A block's own attributes (everything but type, key, children, position, value). */
export function ownAttrs(node: EditorBlock): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) if (k !== 'type' && k !== 'key' && k !== 'children' && k !== 'position' && k !== 'value') out[k] = v;
    return out;
}

function isolating(type: string, ctx: CommandContext): boolean {
    return ctx.schema.get(type)?.isolating === true;
}

/** Steps that remove a block, and its parent when that becomes empty and collapses (list items, lists, quotes). */
export function removeSteps(state: EditorState, entry: BlockEntry, ctx: CommandContext): Step[] {
    const siblings = (entry.parent as { children: EditorBlock[] }).children;
    if (siblings.length === 1 && entry.parentKey !== null) {
        const parent = entryOf(state, entry.parentKey)!;
        if (ctx.schema.get(parent.node.type)?.collapsesWhenEmpty) return removeSteps(state, parent, ctx);
    }
    return [{ type: 'removeBlock', parentKey: entry.parentKey, index: entry.index }];
}

export function prevBlockOf(state: EditorState, entry: BlockEntry): BlockEntry | undefined {
    if (entry.index > 0) {
        const siblings = (entry.parent as { children: EditorBlock[] }).children;
        return entryOf(state, siblings[entry.index - 1].key!);
    }
    return entry.parentKey === null ? undefined : prevBlockOf(state, entryOf(state, entry.parentKey)!);
}

/** The key `target` (a descendant of `node`, matched by identity) will have once `node` is keyed `key`. */
export function relKey(key: string, node: EditorBlock | BlockContent, target: EditorBlock, ctx: CommandContext): string {
    if ((node as EditorBlock) === target) return key;
    const children = (node as { children?: EditorBlock[] }).children ?? [];
    for (let i = 0; i < children.length; i++) {
        if (!ctx.schema.isContainer(children[i].type) && children[i] !== target) continue;
        const found = relKey(`${key}.${i}`, children[i], target, ctx);
        if (found) return found;
    }
    return '';
}

export function stripKeys<T>(node: T): T {
    return JSON.parse(JSON.stringify(node, (k, v) => (k === 'key' || k === 'position' ? undefined : v)));
}

export function topLevelOf(state: EditorState, entry: BlockEntry): BlockEntry {
    let cur = entry;
    while (cur.parentKey !== null) cur = entryOf(state, cur.parentKey)!;
    return cur;
}

// ---------------------------------------------------------------------------
// Inline commands
// ---------------------------------------------------------------------------

/** Replace the selection (or insert at the caret) with text that inherits the marks at the selection. */
export const insertText =
    (text: string, opts: { group?: string; origin?: TransactionMeta['origin'] } = {}): Command =>
    (state, dispatch, ctx) => {
        const sel = textSel(state);
        if (!sel) return false;
        const key = sel.anchor.key;
        const entry = entryOf(state, key);
        if (!entry) return false;
        const { from, to } = selectionRange(sel);
        if (ctx.schema.role(entry.node.type) === 'code') {
            const value = (entry.node as { value: string }).value;
            dispatch?.({
                steps: [{ type: 'setValue', key, value: value.slice(0, from) + text + value.slice(to) }],
                selection: textSelection(key, from + text.length),
                meta: meta({ group: opts.group ?? 'typing', origin: opts.origin ?? 'command' }),
            });
            return true;
        }
        const flat = inlineFlat(state, key, ctx);
        if (!flat) return false;
        const marks = marksAt(flat, from, to, ctx.schema);
        // A mark that carries attrs (a link) is inherited only when text is replaced, never extended from a caret.
        const slice: InlineFlat = {
            text,
            spans: text
                ? marks
                      .filter((m) => from < to || !flat.spans.find((s) => s.type === m)?.attrs)
                      .map((type) => ({ start: 0, end: text.length, type, attrs: flat.spans.find((s) => s.type === type)?.attrs }))
                : [],
        };
        for (const s of slice.spans) if (!s.attrs) delete s.attrs;
        dispatch?.({
            steps: [{ type: 'replaceInline', key, from, to, slice }],
            selection: textSelection(key, from + text.length),
            meta: meta({ group: opts.group ?? 'typing', origin: opts.origin ?? 'command' }),
        });
        return true;
    };

/** Replace `[from, to)` of a block with a flat slice (paste, chips, plugin insertions). */
export const replaceRange =
    (key: string, from: number, to: number, slice: InlineFlat, opts: { group?: string } = {}): Command =>
    (state, dispatch, ctx) => {
        if (!isTextBlock(state, key, ctx)) return false;
        dispatch?.({
            steps: [{ type: 'replaceInline', key, from, to, slice }],
            selection: textSelection(key, from + slice.text.length),
            meta: meta({ group: opts.group }),
        });
        return true;
    };

/** Toggle a mark over the selection. Collapsed selections are a surface concern (typing attributes) and return false. */
export const toggleMark =
    (type: string, attrs?: Record<string, string>): Command =>
    (state, dispatch, ctx) => {
        const sel = textSel(state);
        if (!sel) return false;
        const { from, to } = selectionRange(sel);
        if (from === to) return false;
        const flat = inlineFlat(state, sel.anchor.key, ctx);
        if (!flat) return false;
        const next = toggleFlatMark(flat, type, from, to, attrs);
        dispatch?.({ steps: [{ type: 'setInline', key: sel.anchor.key, flat: next }], selection: sel, meta: meta() });
        return true;
    };

/** Insert an atom (image, mention, …) at the selection, replacing it. */
export const insertAtom =
    (type: string, attrs: Record<string, string>, replace?: { from: number; to: number }): Command =>
    (state, dispatch, ctx) => {
        const sel = textSel(state);
        if (!sel) return false;
        const key = sel.anchor.key;
        if (!isTextBlock(state, key, ctx)) return false;
        const { from, to } = replace ?? selectionRange(sel);
        const slice: InlineFlat = { text: ATOM_CHAR, spans: [{ start: 0, end: 1, type, attrs }] };
        dispatch?.({ steps: [{ type: 'replaceInline', key, from, to, slice }], selection: textSelection(key, from + 1), meta: meta() });
        return true;
    };

export const insertHardBreak: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const entry = entryOf(state, sel.anchor.key);
    if (!entry || !ctx.schema.get(entry.node.type)?.allowsHardBreak) return false;
    return insertText('\n', { group: undefined })(state, dispatch, ctx);
};

// ---------------------------------------------------------------------------
// Block commands
// ---------------------------------------------------------------------------

/**
 * Enter in a text block: split it at the caret. The tail becomes a block of
 * the same type (or `splitsTo` at the end — a heading yields a paragraph);
 * a code block inserts a newline (leave it with `exitCode`); an isolating
 * block (a table cell) never splits. The standard vocabulary's list and
 * quote behaviour runs first through `splitBlock` in `commands-standard.ts`.
 */
export const splitTextBlock: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const key = sel.anchor.key;
    const entry = entryOf(state, key);
    if (!entry) return false;
    const role = ctx.schema.role(entry.node.type);
    if (role === 'code') return insertText('\n')(state, dispatch, ctx);
    if (role !== 'textblock' || isolating(entry.node.type, ctx)) return false;
    const flat = inlineFlat(state, key, ctx)!;
    const { from, to } = selectionRange(sel);
    const head = sliceFlat(flat, 0, from);
    const tail = sliceFlat(flat, to, flat.text.length);
    const spec = ctx.schema.get(entry.node.type)!;
    const atEnd = to === flat.text.length;
    const nextType = atEnd && spec.splitsTo ? spec.splitsTo : entry.node.type;
    const nextSpec = ctx.schema.get(nextType);
    if (!nextSpec?.fromInline) return false;
    const attrs = nextType === entry.node.type ? ownAttrs(entry.node) : {};
    const nextNode = nextSpec.fromInline(toInline(tail, ctx.schema), attrs);
    const steps: Step[] = [
        { type: 'setInline', key, flat: head },
        { type: 'insertBlock', parentKey: entry.parentKey, index: entry.index + 1, node: nextNode as EditorBlock },
    ];
    dispatch?.({ steps, selection: textSelection(keyAt(entry.parentKey, entry.index + 1), 0), meta: meta() });
    return true;
};

/**
 * Backspace at offset 0: a text block of another type first becomes the
 * default block; then the block joins the previous editable one (a void
 * block before it is selected instead; a code block before it takes the
 * caret at its end). Isolating blocks never join.
 */
export const joinTextBackward: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const { from, to } = selectionRange(sel);
    if (from !== 0 || to !== 0) return false;
    const key = sel.anchor.key;
    const entry = entryOf(state, key);
    if (!entry) return false;
    const role = ctx.schema.role(entry.node.type);
    if (role !== 'textblock' && role !== 'code') return false;
    if (isolating(entry.node.type, ctx)) return false;

    if (entry.node.type !== ctx.schema.defaultBlock) return setBlockType(ctx.schema.defaultBlock)(state, dispatch, ctx);

    // A void block right before this one is selected instead of merged into.
    const prevTop = prevBlockOf(state, entry);
    if (prevTop && ctx.schema.role(prevTop.node.type) === 'void') {
        dispatch?.({ steps: [], selection: blockSelection(prevTop.node.key!), meta: meta() });
        return true;
    }
    const prevKey = state.index().prevEditable(key);
    if (!prevKey) return false;
    const prev = entryOf(state, prevKey)!;
    // A code block before: move the caret to its end instead of merging.
    if (ctx.schema.role(prev.node.type) !== 'textblock') {
        dispatch?.({ steps: [], selection: textSelection(prevKey, lengthOf(prev.node, ctx)), meta: meta() });
        return true;
    }
    const prevFlat = flatOf(prev.node, ctx);
    const flat = inlineFlat(state, key, ctx)!;
    const merged = concatFlat(prevFlat, flat);
    const steps: Step[] = [{ type: 'setInline', key: prevKey, flat: merged }, ...removeSteps(state, entry, ctx)];
    dispatch?.({ steps, selection: textSelection(prevKey, prevFlat.text.length), meta: meta() });
    return true;
};

/** Delete at the end: join the next editable block into this one. */
export const joinForward: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const key = sel.anchor.key;
    const entry = entryOf(state, key);
    if (!entry || ctx.schema.role(entry.node.type) !== 'textblock') return false;
    const flat = inlineFlat(state, key, ctx)!;
    const { from, to } = selectionRange(sel);
    if (from !== flat.text.length || to !== from) return false;
    const nextKey = state.index().nextEditable(key);
    if (!nextKey) return false;
    const next = entryOf(state, nextKey)!;
    if (ctx.schema.role(next.node.type) !== 'textblock' || isolating(next.node.type, ctx)) {
        dispatch?.({ steps: [], selection: textSelection(nextKey, 0), meta: meta() });
        return true;
    }
    const merged = concatFlat(flat, flatOf(next.node, ctx));
    const steps: Step[] = [{ type: 'setInline', key, flat: merged }, ...removeSteps(state, next, ctx)];
    dispatch?.({ steps, selection: textSelection(key, flat.text.length), meta: meta() });
    return true;
};

/** Convert the current block (or every block in a block selection) to another text/code type. */
export const setBlockType =
    (type: string, attrs?: Record<string, unknown>): Command =>
    (state, dispatch, ctx) => {
        const target = ctx.schema.get(type);
        if (!target || !target.fromInline) return false;
        const keys = selectedBlockKeys(state);
        if (!keys.length) return false;
        const steps: Step[] = [];
        for (const key of keys) {
            const entry = entryOf(state, key);
            if (!entry) continue;
            const source = ctx.schema.get(entry.node.type);
            if (!source?.toInline || isolating(entry.node.type, ctx)) continue;
            if (entry.node.type === type) {
                if (attrs) steps.push({ type: 'setAttrs', key, attrs });
                continue;
            }
            const children = source.toInline(entry.node);
            steps.push({ type: 'replaceBlock', key, node: target.fromInline(children, attrs) });
        }
        if (!steps.length) return false;
        const sel = state.selection;
        dispatch?.({ steps, selection: sel && sel.mode === 'text' ? clampSelection(sel, steps, ctx) : sel, meta: meta() });
        return true;
    };

/** Keep the caret, clamped to the converted block's length (a heading drops hard breaks, a code block joins the text). The surface clamps on its side too. */
function clampSelection(sel: TextSelection, steps: Step[], ctx: CommandContext): EditorSelection {
    const step = steps.find((s) => s.type === 'replaceBlock' && s.key === sel.anchor.key);
    if (!step || step.type !== 'replaceBlock') return sel;
    const len = lengthOf(step.node, ctx);
    return { mode: 'text', anchor: { key: sel.anchor.key, offset: Math.min(sel.anchor.offset, len) }, head: { key: sel.head.key, offset: Math.min(sel.head.offset, len) } };
}

/** `entry` and its ancestors, outermost first. */
function pathOf(state: EditorState, entry: BlockEntry): BlockEntry[] {
    const path = [entry];
    while (path[0].parentKey !== null) path.unshift(entryOf(state, path[0].parentKey)!);
    return path;
}

/**
 * Keys the current selection covers: the text block, or the blocks of a block
 * selection. A block selection whose ends have different parents is lifted to
 * their lowest common parent: the sibling run there from the child holding
 * one end to the child holding the other. When one end contains the other,
 * that outer block alone.
 */
export function selectedBlockKeys(state: EditorState): string[] {
    const sel = state.selection;
    if (!sel) return [];
    if (sel.mode === 'text') return [sel.anchor.key];
    const a = entryOf(state, sel.anchorKey);
    const h = entryOf(state, sel.headKey);
    if (!a || !h) return a ? [sel.anchorKey] : [];
    const pa = pathOf(state, a);
    const ph = pathOf(state, h);
    let depth = 0;
    while (depth < pa.length && depth < ph.length && pa[depth].node.key === ph[depth].node.key) depth++;
    // One end is (or contains) the other.
    if (depth === pa.length || depth === ph.length) return [pa[depth - 1].node.key!];
    const x = pa[depth];
    const y = ph[depth];
    const siblings = (x.parent as { children: EditorBlock[] }).children;
    const [from, to] = x.index <= y.index ? [x.index, y.index] : [y.index, x.index];
    return siblings.slice(from, to + 1).map((n) => n.key!);
}

/**
 * A document of the given sibling blocks, for the clipboard. Blocks that
 * cannot stand on their own are wrapped in a copy of the parent they need
 * (a list item in its list, a row in its table): the walk goes up until it
 * reaches the root or a flow container (one with `fillsWith`, whose children
 * can be any block).
 */
export function blocksToRoot(state: EditorState, keys: readonly string[], ctx: CommandContext): Root {
    const entries = keys.map((k) => entryOf(state, k)).filter((e): e is BlockEntry => !!e);
    if (!entries.length) return { type: 'root', children: [] };
    let nodes: EditorBlock[] = entries.map((e) => stripKeys(e.node));
    let parentKey = entries[0].parentKey;
    while (parentKey !== null) {
        const parent = entryOf(state, parentKey)!;
        if (ctx.schema.get(parent.node.type)?.fillsWith) break;
        nodes = [{ type: parent.node.type, ...stripKeys(ownAttrs(parent.node)), children: nodes } as EditorBlock];
        parentKey = parent.parentKey;
    }
    return { type: 'root', children: nodes as BlockContent[] };
}

/** Insert a block after the current one and move the caret into it (or select it when void). */
export const insertBlockAfter =
    (node: BlockContent, opts: { replaceEmpty?: boolean } = { replaceEmpty: true }): Command =>
    (state, dispatch, ctx) => {
        const keys = selectedBlockKeys(state);
        if (!keys.length) return false;
        const entry = entryOf(state, keys[keys.length - 1]);
        if (!entry) return false;
        // Inside an isolating structure (a table): insert after the enclosing block.
        let target = entry;
        while (target.parentKey !== null && (isolating(target.parent.type, ctx) || (isolating(target.node.type, ctx) && ctx.schema.isEditable(target.node.type)))) {
            target = entryOf(state, target.parentKey)!;
        }
        const steps: Step[] = [];
        let key: string;
        const empty = target.node.type === ctx.schema.defaultBlock && lengthOf(target.node, ctx) === 0;
        if (opts.replaceEmpty && empty) {
            steps.push({ type: 'replaceBlock', key: target.node.key!, node });
            key = target.node.key!;
        } else {
            steps.push({ type: 'insertBlock', parentKey: target.parentKey, index: target.index + 1, node });
            key = keyAt(target.parentKey, target.index + 1);
        }
        const role = ctx.schema.role(node.type);
        let selection: EditorSelection;
        if (role === 'void') selection = blockSelection(key);
        else {
            const keyed = { ...node, key } as EditorBlock;
            const first = firstEditable(keyed, ctx);
            selection = first ? textSelection(relKey(key, keyed, first, ctx), 0) : blockSelection(key);
        }
        dispatch?.({ steps, selection, meta: meta() });
        return true;
    };

/** Delete the selected block(s) (block selection) or the current block when it is void/code. */
export const deleteBlock: Command = (state, dispatch, ctx) => {
    const keys = selectedBlockKeys(state);
    if (!keys.length) return false;
    const entries = keys.map((k) => entryOf(state, k)).filter((e): e is BlockEntry => !!e);
    if (!entries.length) return false;
    const steps: Step[] = [];
    for (let i = entries.length - 1; i >= 0; i--) steps.push(...removeSteps(state, entries[i], ctx));
    // Focus: the previous editable block, else the next, else a fresh default block.
    const first = entries[0];
    const prevKey = state.index().prevEditable(firstEditable(first.node, ctx)?.key ?? first.node.key!);
    let selection: EditorSelection = null;
    if (prevKey && !keys.some((k) => prevKey.startsWith(k))) selection = textSelection(prevKey, lengthOf(entryOf(state, prevKey)!.node, ctx));
    const rootRemovals = steps.filter((s) => s.type === 'removeBlock' && s.parentKey === null).length;
    if (rootRemovals >= state.doc.children.length) {
        steps.push({ type: 'insertBlock', parentKey: null, index: 0, node: defaultBlock(ctx) });
        selection = textSelection('b-0', 0);
    }
    dispatch?.({ steps, selection, meta: meta() });
    return true;
};

export const duplicateBlock: Command = (state, dispatch) => {
    const keys = selectedBlockKeys(state);
    if (!keys.length) return false;
    const last = entryOf(state, keys[keys.length - 1]);
    if (!last) return false;
    const steps: Step[] = keys.map((k, i) => ({ type: 'insertBlock', parentKey: last.parentKey, index: last.index + 1 + i, node: structuredClone(stripKeys(entryOf(state, k)!.node)) }));
    dispatch?.({ steps, selection: blockSelection(keyAt(last.parentKey, last.index + 1), keyAt(last.parentKey, last.index + keys.length)), meta: meta() });
    return true;
};

const moveBy =
    (delta: -1 | 1): Command =>
    (state, dispatch, ctx) => {
        const keys = selectedBlockKeys(state);
        if (keys.length > 1) return moveRunBy(state, keys, delta, dispatch);
        if (keys.length !== 1) return false;
        const entry = entryOf(state, keys[0]);
        if (!entry) return false;
        // Move the unit the user sees: a block that is its parent's only child moves with the parent when the parent says so (a list item).
        let target = entry;
        while (target.parentKey !== null && ctx.schema.get(target.parent.type)?.moveAsUnit && target.index === 0 && (target.parent as { children: unknown[] }).children.length === 1) {
            target = entryOf(state, target.parentKey)!;
        }
        const siblings = (target.parent as { children: EditorBlock[] }).children;
        const to = target.index + delta;
        if (to < 0 || to >= siblings.length) return false;
        const newKey = keyAt(target.parentKey, to);
        const sel = state.selection;
        const selection: EditorSelection = sel && sel.mode === 'text' ? { mode: 'text', anchor: { key: sel.anchor.key.replace(target.node.key!, newKey), offset: sel.anchor.offset }, head: { key: sel.head.key.replace(target.node.key!, newKey), offset: sel.head.offset } } : blockSelection(newKey);
        dispatch?.({ steps: [{ type: 'moveBlock', key: target.node.key!, to: { parentKey: target.parentKey, index: to } }], selection, meta: meta() });
        return true;
    };

/** Move a run of sibling blocks: the neighbour on the far side moves to the near side of the run. */
function moveRunBy(state: EditorState, keys: readonly string[], delta: -1 | 1, dispatch: Dispatch | undefined): boolean {
    const sel = state.selection;
    const first = entryOf(state, keys[0]);
    const last = entryOf(state, keys[keys.length - 1]);
    if (!first || !last || sel?.mode !== 'block') return false;
    const siblings = (first.parent as { children: EditorBlock[] }).children;
    const neighbour = delta < 0 ? first.index - 1 : last.index + 1;
    if (neighbour < 0 || neighbour >= siblings.length) return false;
    // `to.index` counts after the neighbour's removal: past the run going up, before it going down.
    const to = delta < 0 ? last.index : first.index;
    const shift = (key: string): string => keyAt(first.parentKey, entryOf(state, key)!.index + delta);
    // The ends may sit deeper than the run (a lifted selection): re-anchor on the run's ends, keeping the direction.
    const forward = entryOf(state, sel.anchorKey)!.index <= entryOf(state, sel.headKey)!.index || keys[0] === keys[keys.length - 1];
    const [anchor, head] = forward ? [keys[0], keys[keys.length - 1]] : [keys[keys.length - 1], keys[0]];
    dispatch?.({ steps: [{ type: 'moveBlock', key: siblings[neighbour].key!, to: { parentKey: first.parentKey, index: to } }], selection: blockSelection(shift(anchor), shift(head)), meta: meta() });
    return true;
}

export const moveBlockUp: Command = moveBy(-1);
export const moveBlockDown: Command = moveBy(1);

/** Leave a code block: insert a default block after it and move the caret there. */
export const exitCode: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const entry = entryOf(state, sel.anchor.key);
    if (!entry || ctx.schema.role(entry.node.type) !== 'code') return false;
    return insertBlockAfter(defaultBlock(ctx), { replaceEmpty: false })(state, dispatch, ctx);
};

// ---------------------------------------------------------------------------
// Selection commands
// ---------------------------------------------------------------------------

export const selectBlock =
    (key: string): Command =>
    (state, dispatch) => {
        if (!entryOf(state, key)) return false;
        dispatch?.({ steps: [], selection: blockSelection(key), meta: meta() });
        return true;
    };

/** Escape from a text selection to selecting the enclosing top-level block. */
export const escapeToBlockSelection: Command = (state, dispatch) => {
    const sel = textSel(state);
    if (!sel) return false;
    const entry = entryOf(state, sel.anchor.key);
    if (!entry) return false;
    dispatch?.({ steps: [], selection: blockSelection(topLevelOf(state, entry).node.key!), meta: meta() });
    return true;
};

/** Enter a block selection's first block as text. */
export const escapeToText: Command = (state, dispatch, ctx) => {
    const sel = state.selection;
    if (!sel || sel.mode !== 'block') return false;
    const entry = entryOf(state, sel.anchorKey);
    if (!entry) return false;
    const first = firstEditable(entry.node, ctx);
    if (!first) return false;
    dispatch?.({ steps: [], selection: textSelection(first.key!, 0), meta: meta() });
    return true;
};

export const extendBlockSelection =
    (dir: 'up' | 'down'): Command =>
    (state, dispatch) => {
        const sel = state.selection;
        if (!sel) return false;
        let anchorKey: string;
        let headKey: string;
        if (sel.mode === 'text') {
            const entry = entryOf(state, sel.anchor.key);
            if (!entry) return false;
            anchorKey = headKey = topLevelOf(state, entry).node.key!;
        } else {
            anchorKey = sel.anchorKey;
            headKey = sel.headKey;
        }
        const head = entryOf(state, headKey);
        if (!head) return false;
        const siblings = (head.parent as { children: EditorBlock[] }).children;
        const next = head.index + (dir === 'down' ? 1 : -1);
        if (sel.mode === 'text') {
            dispatch?.({ steps: [], selection: blockSelection(anchorKey, anchorKey), meta: meta() });
            return true;
        }
        if (next < 0 || next >= siblings.length) return false;
        dispatch?.({ steps: [], selection: blockSelection(anchorKey, siblings[next].key!), meta: meta() });
        return true;
    };

export const selectAll: Command = (state, dispatch) => {
    const children = state.doc.children;
    if (!children.length) return false;
    dispatch?.({ steps: [], selection: blockSelection(children[0].key!, children[children.length - 1].key!), meta: meta() });
    return true;
};

/** Move the caret to the previous/next editable block (the view supplies the x-goal offset through `offsetAt`). */
export const focusNeighbour =
    (dir: 'up' | 'down', offsetAt?: (key: string, edge: 'first' | 'last') => number): Command =>
    (state, dispatch, ctx) => {
        const sel = state.selection;
        let fromKey: string | null = null;
        if (sel?.mode === 'text') fromKey = sel.anchor.key;
        else if (sel?.mode === 'block') {
            const e = entryOf(state, dir === 'down' ? sel.headKey : sel.anchorKey);
            if (!e) return false;
            const edge = dir === 'down' ? lastEditable(e.node, ctx) : firstEditable(e.node, ctx);
            if (edge) {
                // A selected block with text: enter it at the edge facing the direction.
                dispatch?.({ steps: [], selection: textSelection(edge.key!, dir === 'down' ? lengthOf(edge, ctx) : 0), meta: meta() });
                return true;
            }
            // A void block: step to the neighbouring top-level block.
            const top = topLevelOf(state, e);
            const n = state.doc.children[top.index + (dir === 'down' ? 1 : -1)];
            if (!n) return false;
            if (ctx.schema.role(n.type) === 'void') {
                dispatch?.({ steps: [], selection: blockSelection(n.key!), meta: meta() });
                return true;
            }
            const into = dir === 'down' ? firstEditable(n, ctx) : lastEditable(n, ctx);
            if (!into) return false;
            dispatch?.({ steps: [], selection: textSelection(into.key!, dir === 'down' ? 0 : lengthOf(into, ctx)), meta: meta() });
            return true;
        }
        if (!fromKey) return false;
        const index = state.index();
        const target = dir === 'up' ? index.prevEditable(fromKey) : index.nextEditable(fromKey);
        if (!target) {
            // No editable neighbour: maybe a void block sits there — select it.
            const entry = entryOf(state, fromKey)!;
            const top = topLevelOf(state, entry);
            const siblings = state.doc.children;
            const n = siblings[top.index + (dir === 'up' ? -1 : 1)];
            if (n && ctx.schema.role(n.type) === 'void') {
                dispatch?.({ steps: [], selection: blockSelection(n.key!), meta: meta() });
                return true;
            }
            return false;
        }
        // A void block between the two? Select it instead.
        const between = voidBetween(state, fromKey, target, dir, ctx);
        if (between) {
            dispatch?.({ steps: [], selection: blockSelection(between), meta: meta() });
            return true;
        }
        const node = entryOf(state, target)!.node;
        const offset = offsetAt ? offsetAt(target, dir === 'up' ? 'last' : 'first') : dir === 'up' ? lengthOf(node, ctx) : 0;
        dispatch?.({ steps: [], selection: textSelection(target, Math.max(0, Math.min(offset, lengthOf(node, ctx)))), meta: meta() });
        return true;
    };

function voidBetween(state: EditorState, fromKey: string, toKey: string, dir: 'up' | 'down', ctx: CommandContext): string | null {
    const a = topLevelOf(state, entryOf(state, fromKey)!);
    const b = topLevelOf(state, entryOf(state, toKey)!);
    const [lo, hi] = dir === 'down' ? [a.index, b.index] : [b.index, a.index];
    for (let i = lo + 1; i < hi; i++) {
        const n = state.doc.children[i];
        if (ctx.schema.role(n.type) === 'void') return dir === 'down' ? n.key! : state.doc.children[hi - 1].key!;
    }
    return null;
}

export const focusStart: Command = (state, dispatch, ctx) => {
    const first = state.doc.children.length ? firstEditable(state.doc.children[0], ctx) : undefined;
    if (!first) return false;
    dispatch?.({ steps: [], selection: textSelection(first.key!, 0), meta: meta() });
    return true;
};

export const focusEnd: Command = (state, dispatch, ctx) => {
    const children = state.doc.children;
    const last = children.length ? lastEditable(children[children.length - 1], ctx) : undefined;
    if (!last) return false;
    dispatch?.({ steps: [], selection: textSelection(last.key!, lengthOf(last, ctx)), meta: meta() });
    return true;
};

// ---------------------------------------------------------------------------
// Document commands
// ---------------------------------------------------------------------------

export const setDocument =
    (doc: Root, opts: { origin?: TransactionMeta['origin']; addToHistory?: boolean } = {}): Command =>
    (_state, dispatch, ctx) => {
        normalizeDoc(doc, ctx.schema);
        const first = doc.children.length ? firstEditable(doc.children[0] as EditorBlock, ctx) : undefined;
        dispatch?.({
            steps: [{ type: 'replaceDoc', doc }],
            selection: first?.key ? textSelection(first.key, 0) : null,
            meta: meta({ origin: opts.origin ?? 'external', addToHistory: opts.addToHistory ?? opts.origin !== undefined }),
        });
        return true;
    };

/** Replace the document with `source` parsed by a format (`formatId`, else the primary one). */
export const setSource =
    (source: string, formatId?: string, opts: { origin?: TransactionMeta['origin']; addToHistory?: boolean } = {}): Command =>
    (state, dispatch, ctx) => {
        const format = formatId ? ctx.formats.find((f) => f.id === formatId) : ctx.formats[0];
        if (!format) return false;
        return setDocument(format.parse(source, { plugins: ctx.plugins }), opts)(state, dispatch, ctx);
    };

export const clear: Command = (state, dispatch, ctx) =>
    setDocument({ type: 'root', children: [defaultBlock(ctx)] }, { origin: 'command', addToHistory: true })(state, dispatch, ctx);

// ---------------------------------------------------------------------------
// Paste
// ---------------------------------------------------------------------------

/**
 * Replace the blocks of a block selection with `blocks`. Under a list-like
 * parent (a container without `fillsWith`, whose children are all one kind),
 * a pasted block of the parent's type contributes its children and any other
 * block is wrapped in a copy of the selected child's type when that type is
 * a flow container (a list item). Isolating parents (table rows) refuse.
 */
export const replaceSelectedBlocks =
    (blocks: BlockContent[]): Command =>
    (state, dispatch, ctx) => {
        if (state.selection?.mode !== 'block' || !blocks.length) return false;
        const keys = selectedBlockKeys(state);
        const entries = keys.map((k) => entryOf(state, k)).filter((e): e is BlockEntry => !!e);
        if (!entries.length) return false;
        const first = entries[0];
        const parentType = first.parentKey === null ? null : first.parent.type;
        if (parentType !== null && isolating(parentType, ctx)) return false;
        let nodes: BlockContent[] = blocks;
        if (parentType !== null && !ctx.schema.get(parentType)?.fillsWith) {
            const shell = first.node;
            if (!ctx.schema.get(shell.type)?.fillsWith) return false;
            nodes = blocks.flatMap((b) =>
                b.type === parentType ? ((b as { children: BlockContent[] }).children ?? []) : [{ type: shell.type, ...stripKeys(ownAttrs(shell)), children: [b] } as unknown as BlockContent],
            );
            if (!nodes.length) return false;
        }
        const steps: Step[] = [];
        for (let i = entries.length - 1; i >= 0; i--) steps.push({ type: 'removeBlock', parentKey: first.parentKey, index: entries[i].index });
        nodes.forEach((node, i) => steps.push({ type: 'insertBlock', parentKey: first.parentKey, index: first.index + i, node }));
        const lastKey = keyAt(first.parentKey, first.index + nodes.length - 1);
        const lastNode = nodes[nodes.length - 1];
        const keyed = { ...lastNode, key: lastKey } as EditorBlock;
        const last = lastEditable(keyed, ctx);
        const selection = last ? textSelection(relKey(lastKey, keyed, last, ctx), lengthOf(last, ctx)) : blockSelection(keyAt(first.parentKey, first.index), lastKey);
        dispatch?.({ steps, selection, meta: meta({ origin: 'paste' }) });
        return true;
    };

/** Insert parsed blocks at the selection: the first block merges into the current text block when both are text; over a block selection they replace it. */
export const insertBlocks =
    (blocks: BlockContent[]): Command =>
    (state, dispatch, ctx) => {
        if (state.selection?.mode === 'block') return replaceSelectedBlocks(blocks)(state, dispatch, ctx);
        const sel = textSel(state);
        if (!sel || !blocks.length) return false;
        const key = sel.anchor.key;
        const entry = entryOf(state, key);
        if (!entry) return false;
        const { from, to } = selectionRange(sel);
        const steps: Step[] = [];
        let selection: EditorSelection = sel;
        const defaultType = ctx.schema.defaultBlock;
        if (ctx.schema.role(entry.node.type) === 'textblock' && blocks.length === 1 && ctx.schema.role(blocks[0].type) === 'textblock') {
            const slice = toFlat((blocks[0] as { children: PhrasingContent[] }).children, ctx.schema);
            steps.push({ type: 'replaceInline', key, from, to, slice });
            selection = textSelection(key, from + slice.text.length);
        } else if (ctx.schema.role(entry.node.type) === 'textblock') {
            // Split the current block around the selection; a pasted default block at either
            // edge merges into that half (a heading, list or code block stays its own block).
            const flat = inlineFlat(state, key, ctx)!;
            const head = sliceFlat(flat, 0, from);
            const tail = sliceFlat(flat, to, flat.text.length);
            const list = blocks.slice();
            let headFlat = head;
            if (list[0].type === defaultType) headFlat = concatFlat(head, toFlat((list.shift() as { children: PhrasingContent[] }).children, ctx.schema));
            let tailFlat = tail;
            let lastKey: string | null = null;
            let lastOffset = 0;
            if (list.length && list[list.length - 1].type === defaultType) {
                const lastFlat = toFlat((list.pop() as { children: PhrasingContent[] }).children, ctx.schema);
                lastOffset = lastFlat.text.length;
                tailFlat = concatFlat(lastFlat, tail);
            }
            let at = entry.index + 1;
            if (headFlat.text.length === 0 && list.length && entry.node.type === defaultType) {
                // Nothing before the caret: the first pasted block takes the block's place.
                steps.push({ type: 'replaceBlock', key, node: list.shift()! });
            } else {
                steps.push({ type: 'setInline', key, flat: headFlat });
            }
            for (const b of list) steps.push({ type: 'insertBlock', parentKey: entry.parentKey, index: at++, node: b });
            if (tailFlat.text.length || list.length === 0 || lastOffset) {
                steps.push({ type: 'insertBlock', parentKey: entry.parentKey, index: at, node: defaultBlock(ctx, toInline(tailFlat, ctx.schema)) });
                lastKey = keyAt(entry.parentKey, at);
                selection = textSelection(lastKey, lastOffset);
            } else {
                const lastInserted = keyAt(entry.parentKey, at - 1);
                // The caret lands at the end of the last inserted block (its last editable descendant for a list or quote).
                const last = lastEditable({ ...list[list.length - 1], key: lastInserted } as EditorBlock, ctx);
                selection = last ? textSelection(relKey(lastInserted, list[list.length - 1], last, ctx), lengthOf(last, ctx)) : blockSelection(lastInserted);
            }
        } else {
            let at = entry.index + 1;
            for (const b of blocks) steps.push({ type: 'insertBlock', parentKey: entry.parentKey, index: at++, node: b });
            selection = blockSelection(keyAt(entry.parentKey, entry.index + 1), keyAt(entry.parentKey, at - 1));
        }
        dispatch?.({ steps, selection, meta: meta({ origin: 'paste' }) });
        return true;
    };

/**
 * Paste: the first format (in order) that reads a flavour present in `data`
 * parses it — a markdown editor takes `text/markdown` over `text/plain`,
 * and claims plain text as markdown; a format that does not list
 * `text/plain` leaves plain text to `plainTextFormat`. Block structure
 * becomes blocks, a single line becomes inline content.
 */
export const paste =
    (data: PasteData): Command =>
    (state, dispatch, ctx) => {
        const picked = pickPasteFormat(data, ctx.formats) ?? (data.text ? { format: plainTextFormat, source: data.text } : null);
        if (!picked) return false;
        const root = picked.format.parse(picked.source, { plugins: ctx.plugins });
        const blocks = root.children.map((b) => stripKeys(b));
        if (!blocks.length) return false;
        return insertBlocks(blocks)(state, dispatch, ctx);
    };
