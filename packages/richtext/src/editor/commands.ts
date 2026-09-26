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
import type { BlockEntry, EditorBlock, EditorSelection, EditorState, Point, TextSelection } from './state.js';
import { blockSelection, isCrossBlock, normalizeDoc, selectionEquals, selectionRange, textRange, textSelection } from './state.js';
import type { Step } from './steps.js';
import { flatOf } from './steps.js';
import type { Transaction, TransactionMeta } from './transaction.js';
import { applyTransaction } from './transaction.js';
import { clipboardRoot, entryOf, firstEditable, lastEditable, lengthOf, ownAttrs, siblingRun, stripKeys } from './blocks.js';
import { normalizeTextRange, rangeBlocks, sliceDoc, type RangeBlock } from './range.js';

export { entryOf, firstEditable, lastEditable, lengthOf, ownAttrs, stripKeys };

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

/**
 * Run `first`, then `second` on the state it leaves, as ONE transaction (one
 * history entry): both commands' steps, the selection `second` ends with,
 * and their metadata merged (`second` wins). Applies only when both do.
 */
export function sequence(first: Command, second: Command): Command {
    return (state, dispatch, ctx) => {
        let a: Transaction | null = null;
        if (!first(state, (tr) => (a = tr), ctx) || !a) return false;
        const trA: Transaction = a;
        const mid = applyTransaction(state, trA, ctx).state;
        let b: Transaction | null = null;
        if (!second(mid, (tr) => (b = tr), ctx) || !b) return false;
        const trB: Transaction = b;
        if (dispatch) {
            const end = applyTransaction(mid, trB, ctx).state;
            dispatch({ steps: [...trA.steps, ...trB.steps], selection: end.selection, meta: { ...trA.meta, ...trB.meta }, ...(trB.composing !== undefined ? { composing: trB.composing } : trA.composing !== undefined ? { composing: trA.composing } : {}) });
        }
        return true;
    };
}

/** The selection is a text range across blocks. */
export function crossBlock(state: EditorState): boolean {
    const sel = state.selection;
    return !!sel && sel.mode === 'text' && isCrossBlock(sel);
}

/**
 * Over a cross-block range: delete it, then run `command` at the collapsed
 * caret — one transaction. Otherwise does not apply. A grouped result (typing)
 * is bound to the caret's block, so the keystrokes that follow merge into the
 * same undo entry and one undo restores the range.
 */
export function overRange(command: Command): Command {
    return (state, dispatch, ctx) =>
        crossBlock(state) &&
        sequence(deleteRange, command)(
            state,
            dispatch &&
                ((tr) => {
                    const sel = tr.selection;
                    const key = tr.meta.group && !tr.meta.sourceKey && sel?.mode === 'text' ? sel.head.key : undefined;
                    dispatch(key ? { ...tr, meta: { ...tr.meta, sourceKey: key } } : tr);
                }),
            ctx,
        );
}

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

/** The selection when it is a text selection inside ONE block (the single-block commands' input); a cross-block range is not. */
export function textSel(state: EditorState): TextSelection | null {
    const sel = state.selection;
    return sel && sel.mode === 'text' && !isCrossBlock(sel) ? sel : null;
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

/** An empty block of the schema's default type (a paragraph in the standard vocabulary). */
export function defaultBlock(ctx: CommandContext, children: PhrasingContent[] = []): BlockContent {
    const spec = ctx.schema.get(ctx.schema.defaultBlock);
    return spec?.fromInline ? spec.fromInline(children) : ctx.schema.createBlock(ctx.schema.defaultBlock);
}

/** The key a node will have after `insertBlock` under `parentKey` at `index`. */
export function keyAt(parentKey: string | null, index: number): string {
    return parentKey === null ? `b-${index}` : `${parentKey}.${index}`;
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
        if (crossBlock(state)) return overRange(insertText(text, opts))(state, dispatch, ctx);
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
        if (!replace && crossBlock(state)) return overRange(insertAtom(type, attrs))(state, dispatch, ctx);
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
    if (crossBlock(state)) return overRange(insertHardBreak)(state, dispatch, ctx);
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
    if (crossBlock(state)) return overRange(splitTextBlock)(state, dispatch, ctx);
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
    if (crossBlock(state)) return deleteRange(state, dispatch, ctx);
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

// ---------------------------------------------------------------------------
// Ranges across blocks
// ---------------------------------------------------------------------------

/**
 * Delete a cross-block text range (Backspace/Delete, and the first half of
 * typing, Enter or paste over one). When both ends are text blocks they join:
 * the start block keeps its text before the range and takes the end block's
 * text after it. Otherwise (an end is a code block) each end is trimmed on its
 * own. Every block in between goes; containers left empty collapse; a table
 * inside the range goes whole. The caret lands where the range started.
 * A range that `normalizeTextRange` shrinks to one block deletes inside it.
 */
export const deleteRange: Command = (state, dispatch, ctx) => {
    const raw = state.selection;
    if (!raw || raw.mode !== 'text' || !isCrossBlock(raw)) return false;
    const sel = normalizeTextRange(state, raw, ctx);
    if (!isCrossBlock(sel)) return insertText('', { group: undefined })({ ...state, selection: sel }, dispatch, ctx);
    const covered = rangeBlocks(state, sel, ctx);
    // A stale selection (a key no longer in the document) covers nothing.
    if (!covered.length) return false;
    const start = covered[0];
    const end = covered[covered.length - 1];
    const steps: Step[] = [];
    let cur = state;
    const push = (more: Step[]): void => {
        for (const step of more) {
            steps.push(step);
            cur = applyTransaction(cur, { steps: [step], selection: null, meta: meta() }, ctx).state;
        }
    };
    const trim = (block: RangeBlock, keep: 'head' | 'tail'): void => {
        const node = entryOf(cur, block.key)!.node;
        if (ctx.schema.role(node.type) === 'code') {
            const value = (node as { value: string }).value;
            const next = keep === 'head' ? value.slice(0, block.from) : value.slice(block.to);
            if (next !== value) push([{ type: 'setValue', key: block.key, value: next }]);
            return;
        }
        const flat = inlineFlat(cur, block.key, ctx)!;
        const next = keep === 'head' ? sliceFlat(flat, 0, block.from) : sliceFlat(flat, block.to, flat.text.length);
        if (next.text.length !== flat.text.length) push([{ type: 'setInline', key: block.key, flat: next }]);
    };
    // The end block goes first: it is last in document order, so no earlier key shifts.
    if (start.role === 'textblock' && end.role === 'textblock') {
        const head = sliceFlat(inlineFlat(cur, start.key, ctx)!, 0, start.from);
        const endFlat = inlineFlat(cur, end.key, ctx)!;
        push([{ type: 'setInline', key: start.key, flat: concatFlat(head, sliceFlat(endFlat, end.to, endFlat.text.length)) }]);
        push(removeSteps(cur, entryOf(cur, end.key)!, ctx));
    } else {
        trim(end, 'tail');
        trim(start, 'head');
    }
    // Then the outermost fully covered blocks in between, last first.
    for (const key of coveredTops(state, covered.slice(1, -1).map((b) => b.key), ctx).reverse()) {
        const entry = entryOf(cur, key);
        if (entry) push(removeSteps(cur, entry, ctx));
    }
    dispatch?.({ steps, selection: textSelection(start.key, start.from), meta: meta() });
    return true;
};

/**
 * The outermost blocks whose every leaf is in `leaves` (a leaf: a text, code
 * or void block, or a whole table), in document order — what removing those
 * leaves removes, so a list whose items are all covered goes as one block.
 */
function coveredTops(state: EditorState, leaves: readonly string[], ctx: CommandContext): string[] {
    const set = new Set(leaves);
    const index = state.index();
    const keys = index.keys();
    const leavesOf = (key: string): string[] => {
        const out: string[] = [];
        let skip: string | null = null;
        for (let i = index.position(key); i < keys.length && (keys[i] === key || keys[i].startsWith(key + '.')); i++) {
            const k = keys[i];
            if (skip !== null && k.startsWith(skip)) continue;
            skip = null;
            const role = ctx.schema.role(index.get(k)!.node.type);
            if (role === 'table') skip = k + '.';
            if (role === 'table' || role === 'void' || role === 'textblock' || role === 'code') out.push(k);
        }
        return out;
    };
    const tops = new Set<string>();
    for (const leaf of leaves) {
        let top = entryOf(state, leaf)!;
        while (top.parentKey !== null) {
            const parent = entryOf(state, top.parentKey)!;
            if (!leavesOf(parent.node.key!).every((k) => set.has(k))) break;
            top = parent;
        }
        tops.add(top.node.key!);
    }
    return [...tops].sort((a, b) => index.position(a) - index.position(b));
}

/**
 * What the selection copies, as a document: a text range through `sliceDoc`
 * (one block or many), a block selection through `blocksToRoot`. `null` for
 * a collapsed caret or no selection. The host hands it to the clipboard
 * writers (`editor.clipboard(root)`).
 */
export function copySelection(state: EditorState, ctx: CommandContext): Root | null {
    const sel = state.selection;
    if (!sel) return null;
    if (sel.mode === 'block') return blocksToRoot(state, selectedBlockKeys(state), ctx);
    if (!isCrossBlock(sel) && sel.anchor.offset === sel.head.offset) return null;
    return sliceDoc(state, sel, ctx);
}

/** Remove what `copySelection` copied: a range, a text selection's text, or the selected blocks. */
export const cutSelection: Command = (state, dispatch, ctx) => {
    const sel = state.selection;
    if (!sel) return false;
    if (sel.mode === 'block') return deleteBlock(state, dispatch, ctx);
    if (isCrossBlock(sel)) return deleteRange(state, dispatch, ctx);
    if (sel.anchor.offset === sel.head.offset) return false;
    return insertText('', { group: undefined })(state, dispatch, ctx);
};

/**
 * Shift+Up/Down across blocks, platform-neutral: move a text selection's head
 * into the previous/next editable block (the view supplies the x-goal offset
 * through `offsetAt`; without it, the start going down and the end going up).
 * With no neighbour the head goes to its own block's edge. Void blocks and
 * tables in between join the range whole (`normalizeTextRange`).
 */
export const extendSelectionToNeighbour =
    (dir: 'up' | 'down', offsetAt?: (key: string, edge: 'first' | 'last') => number): Command =>
    (state, dispatch, ctx) => {
        const sel = state.selection;
        if (!sel || sel.mode !== 'text') return false;
        const own = entryOf(state, sel.head.key);
        if (!own || !entryOf(state, sel.anchor.key)) return false;
        const index = state.index();
        const next = dir === 'down' ? index.nextEditable(sel.head.key) : index.prevEditable(sel.head.key);
        const nextEntry = next ? entryOf(state, next) : undefined;
        let head: Point;
        if (next && nextEntry) {
            const len = lengthOf(nextEntry.node, ctx);
            const fallback = dir === 'down' ? 0 : len;
            head = { key: next, offset: Math.max(0, Math.min(offsetAt?.(next, dir === 'down' ? 'first' : 'last') ?? fallback, len)) };
        } else {
            head = { key: sel.head.key, offset: dir === 'down' ? lengthOf(own.node, ctx) : 0 };
            if (head.offset === sel.head.offset) return false;
        }
        const selection = normalizeTextRange(state, textRange(sel.anchor, head), ctx);
        if (selectionEquals(selection, sel)) return false;
        dispatch?.({ steps: [], selection, meta: meta() });
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

/** Keep the selection, each end clamped to its converted block's length (a heading drops hard breaks, a code block joins the text). The surface clamps on its side too. */
function clampSelection(sel: TextSelection, steps: Step[], ctx: CommandContext): EditorSelection {
    const clamp = (p: TextSelection['anchor']): TextSelection['anchor'] => {
        const step = steps.find((s) => s.type === 'replaceBlock' && s.key === p.key);
        return step && step.type === 'replaceBlock' ? { key: p.key, offset: Math.min(p.offset, lengthOf(step.node, ctx)) } : p;
    };
    return { mode: 'text', anchor: clamp(sel.anchor), head: clamp(sel.head) };
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
    if (sel.mode === 'text') return isCrossBlock(sel) ? siblingRun(state, sel.anchor.key, sel.head.key) : [sel.anchor.key];
    return siblingRun(state, sel.anchorKey, sel.headKey);
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
    return clipboardRoot(state, entries[0].parentKey, entries.map((e) => stripKeys(e.node)), ctx);
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
    // The ends may sit deeper than the run (a lifted selection): re-anchor on the run's ends, keeping the
    // direction — read from document order, since the ends' own indexes may be in different sibling lists.
    const keysInOrder = state.index().keys();
    const forward = keysInOrder.indexOf(sel.anchorKey) <= keysInOrder.indexOf(sel.headKey);
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
    const sel = state.selection;
    if (sel?.mode === 'text' && isCrossBlock(sel)) return selectRunOf(state, sel, dispatch);
    const single = textSel(state);
    if (!single) return false;
    const entry = entryOf(state, single.anchor.key);
    if (!entry) return false;
    dispatch?.({ steps: [], selection: blockSelection(topLevelOf(state, entry).node.key!), meta: meta() });
    return true;
};

/** A cross-block text selection becomes the block selection of its sibling run, keeping its direction. */
function selectRunOf(state: EditorState, sel: TextSelection, dispatch: Dispatch | undefined): boolean {
    const run = siblingRun(state, sel.anchor.key, sel.head.key);
    if (!run.length) return false;
    const index = state.index();
    const forward = index.position(sel.anchor.key) <= index.position(sel.head.key);
    const [first, last] = [run[0], run[run.length - 1]];
    dispatch?.({ steps: [], selection: forward ? blockSelection(first, last) : blockSelection(last, first), meta: meta() });
    return true;
}

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
        if (sel.mode === 'text' && isCrossBlock(sel)) return selectRunOf(state, sel, dispatch);
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
        // A cross-block range collapses to its head.
        if (sel?.mode === 'text') fromKey = sel.head.key;
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
        if (crossBlock(state)) return overRange(insertBlocks(blocks))(state, dispatch, ctx);
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
