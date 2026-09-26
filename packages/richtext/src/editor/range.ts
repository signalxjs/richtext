/**
 * Text ranges across blocks — the model half of cross-block selection.
 *
 * A `TextSelection` whose ends are in different blocks covers everything
 * between them in document order (the pre-order walk `BlockIndex.keys()`
 * gives). The helpers here turn such a selection into the leaves it touches
 * and keep it well-formed; the range commands build on them.
 *
 * Isolating structures (a table, its rows and cells) are all or nothing: a
 * range never ends inside one it does not start in (`normalizeTextRange`),
 * so `rangeBlocks` reports a table as one whole unit.
 */

import type { Root } from '../ast/index.js';
import type { CommandContext } from './commands.js';
import { clipboardRoot, entryOf, firstEditable, lastEditable, lengthOf, siblingRun, stripKeys } from './blocks.js';
import { sliceFlat, toInline, type InlineFlat } from './inline-flat.js';
import type { BlockEntry, EditorBlock, EditorSelection, EditorState, Point, TextSelection } from './state.js';
import { flatOf } from './steps.js';
import { comparePoints, isCrossBlock, textRange } from './state.js';

/** A text selection's ends in document order. */
export interface OrderedRange {
    from: Point;
    to: Point;
    /** The anchor comes first. */
    forward: boolean;
}

export function orderedRange(state: EditorState, sel: TextSelection): OrderedRange {
    const forward = comparePoints(state.index(), sel.anchor, sel.head) <= 0;
    return forward ? { from: sel.anchor, to: sel.head, forward } : { from: sel.head, to: sel.anchor, forward };
}

/** One leaf a range covers. `from`/`to` are offsets into the block's text (0 / 0 for a void block or a table). */
export interface RangeBlock {
    key: string;
    role: 'textblock' | 'code' | 'void' | 'table';
    from: number;
    to: number;
    /** The range covers the whole block. */
    whole: boolean;
}

/**
 * The leaves a text selection covers, in document order: text and code
 * blocks (partial at the two edges), void blocks, and tables as whole units
 * (their cells are not listed). Containers (lists, quotes) are not listed;
 * their leaves are. A single-block selection gives that one block.
 */
export function rangeBlocks(state: EditorState, sel: TextSelection, ctx: CommandContext): RangeBlock[] {
    const index = state.index();
    const { from, to } = orderedRange(state, sel);
    const start = index.position(from.key);
    const end = index.position(to.key);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
    const keys = index.keys();
    const out: RangeBlock[] = [];
    let skipUnder: string | null = null;
    for (let i = start; i <= end; i++) {
        const key = keys[i];
        if (skipUnder !== null && key.startsWith(skipUnder)) continue;
        skipUnder = null;
        const node = index.get(key)!.node;
        const role = ctx.schema.role(node.type);
        if (role === 'table') {
            out.push({ key, role, from: 0, to: 0, whole: true });
            skipUnder = key + '.';
        } else if (role === 'void') {
            out.push({ key, role, from: 0, to: 0, whole: true });
        } else if (role === 'textblock' || role === 'code') {
            const len = lengthOf(node, ctx);
            const a = key === from.key ? Math.min(from.offset, len) : 0;
            const b = key === to.key ? Math.min(to.offset, len) : len;
            out.push({ key, role, from: a, to: b, whole: a === 0 && b === len });
        }
    }
    return out;
}

/** The outermost isolating block holding `key` (itself included), if any. */
function isolatingRoot(state: EditorState, key: string, ctx: CommandContext): BlockEntry | undefined {
    let found: BlockEntry | undefined;
    for (let e = entryOf(state, key); e; e = e.parentKey === null ? undefined : entryOf(state, e.parentKey)) {
        if (ctx.schema.get(e.node.type)?.isolating) found = e;
    }
    return found;
}

/** `outer` is `key` or one of its ancestors. */
function contains(outer: string, key: string): boolean {
    return key === outer || key.startsWith(outer + '.');
}

/**
 * Keep a cross-block text selection inside the rules:
 *
 * - it starts inside an isolating block (a table cell): the head is clamped
 *   to that block's edge — selecting across cells is a block selection;
 * - its head lands in an isolating structure the anchor is not in: the head
 *   jumps past it (forward: offset 0 of the next editable block; backward:
 *   the end of the previous one), so the structure is covered whole. With
 *   nothing editable beyond it, the head stops on the near side instead.
 *
 * Both ends then sit in text or code blocks. A single-block selection is
 * returned unchanged.
 */
export function normalizeTextRange(state: EditorState, sel: TextSelection, ctx: CommandContext): TextSelection {
    if (!isCrossBlock(sel)) return sel;
    const index = state.index();
    const forward = comparePoints(index, sel.anchor, sel.head) <= 0;
    const anchorRoot = isolatingRoot(state, sel.anchor.key, ctx);
    if (anchorRoot) {
        const cell = entryOf(state, sel.anchor.key);
        if (!cell) return sel;
        // The innermost isolating editable holding the anchor (the cell itself).
        return textRange(sel.anchor, { key: sel.anchor.key, offset: forward ? lengthOf(cell.node, ctx) : 0 });
    }
    const headRoot = isolatingRoot(state, sel.head.key, ctx);
    if (!headRoot || contains(headRoot.node.key!, sel.anchor.key)) return sel;
    const first = firstEditable(headRoot.node, ctx)?.key;
    const last = lastEditable(headRoot.node, ctx)?.key;
    const after = last ? index.nextEditable(last) : null;
    const before = first ? index.prevEditable(first) : null;
    const pointAfter = (): Point | null => (after ? { key: after, offset: 0 } : null);
    const pointBefore = (): Point | null => {
        const e = before ? entryOf(state, before) : undefined;
        return e ? { key: e.node.key!, offset: lengthOf(e.node, ctx) } : null;
    };
    const head = forward ? (pointAfter() ?? pointBefore()) : (pointBefore() ?? pointAfter());
    return head ? textRange(sel.anchor, head) : sel;
}

/** Normalise any selection: a cross-block text selection through `normalizeTextRange`, anything else as is. */
export function normalizeSelection(state: EditorState, sel: EditorSelection, ctx: CommandContext): EditorSelection {
    return sel && sel.mode === 'text' ? normalizeTextRange(state, sel, ctx) : sel;
}

/**
 * A copy of what a text selection covers, as a document for the clipboard:
 * the edge blocks cut at the range's ends (text through its flat model, so
 * marks survive; code by value), containers on an edge pruned to the children
 * inside the range (a list keeps its attributes), everything in between whole.
 * Blocks that cannot stand alone are wrapped in the parent they need (see
 * `clipboardRoot`). Keys and positions are stripped.
 */
export function sliceDoc(state: EditorState, sel: TextSelection, ctx: CommandContext): Root {
    const norm = normalizeTextRange(state, sel, ctx);
    const { from, to } = orderedRange(state, norm);
    const index = state.index();
    const keys = index.keys();
    const start = index.position(from.key);
    const end = index.position(to.key);
    const lastUnder = (key: string): number => {
        let i = index.position(key);
        while (i + 1 < keys.length && keys[i + 1].startsWith(key + '.')) i++;
        return i;
    };
    const intersects = (key: string): boolean => index.position(key) <= end && lastUnder(key) >= start;
    const prune = (node: EditorBlock): EditorBlock => {
        const key = node.key!;
        const role = ctx.schema.role(node.type);
        if (role === 'textblock') {
            const flat = flatOf(node, ctx);
            const a = key === from.key ? from.offset : 0;
            const b = key === to.key ? to.offset : flat.text.length;
            return a === 0 && b === flat.text.length ? node : ({ ...node, children: toInline(sliceFlat(flat, a, b), ctx.schema) } as EditorBlock);
        }
        if (role === 'code') {
            const value = (node as { value: string }).value;
            const a = key === from.key ? from.offset : 0;
            const b = key === to.key ? to.offset : value.length;
            return { ...node, value: value.slice(a, b) } as EditorBlock;
        }
        const children = (node as { children?: EditorBlock[] }).children;
        if (role === 'table' || !children || !ctx.schema.isContainer(node.type)) return node;
        return { ...node, children: children.filter((c) => c.key && intersects(c.key)).map(prune) } as EditorBlock;
    };
    const run = siblingRun(state, from.key, to.key);
    if (!run.length) return { type: 'root', children: [] };
    const first = entryOf(state, run[0])!;
    return clipboardRoot(state, first.parentKey, run.map((k) => stripKeys(prune(entryOf(state, k)!.node))), ctx);
}

/** A non-empty stretch of one text block inside a range, with the block's flat model. */
export interface TextSegment {
    key: string;
    from: number;
    to: number;
    flat: InlineFlat;
}

/**
 * The text a range covers, block by block: every text block with a
 * non-empty stretch in it (code, void blocks and tables are left out) —
 * what marks and links apply to.
 */
export function textSegments(state: EditorState, sel: TextSelection, ctx: CommandContext): TextSegment[] {
    const out: TextSegment[] = [];
    for (const b of rangeBlocks(state, normalizeTextRange(state, sel, ctx), ctx)) {
        if (b.role !== 'textblock' || b.from >= b.to) continue;
        out.push({ key: b.key, from: b.from, to: b.to, flat: flatOf(entryOf(state, b.key)!.node, ctx) });
    }
    return out;
}

/** The text and code blocks a range covers, in document order (table cells excluded) — what block-type changes apply to. */
export function rangeLeafKeys(state: EditorState, sel: TextSelection, ctx: CommandContext): string[] {
    return rangeBlocks(state, normalizeTextRange(state, sel, ctx), ctx)
        .filter((b) => b.role === 'textblock' || b.role === 'code')
        .map((b) => b.key);
}

