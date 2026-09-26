/**
 * The standard vocabulary's commands — lists, blockquotes, tables, headings,
 * links, thematic breaks, images. They know the standard node types by name
 * (that vocabulary is the core's); `commands.ts` holds the commands that
 * know none. `splitBlock` and `joinBackward` are the chains a keymap binds
 * to Enter and Backspace: the list and quote behaviour first, then the
 * generic split / join.
 */

import type { BlockContent, List, ListItem, PhrasingContent, Table, TableCell, TableRow } from '../ast/index.js';
import type { InlineFlat } from './inline-flat.js';
import { addMark, removeMark, sliceFlat, toInline } from './inline-flat.js';
import { chain, deleteRange, overRange, entryOf, firstEditable, inlineFlat, insertAtom, insertBlockAfter, joinTextBackward, keyAt, lengthOf, meta, selectedBlockKeys, setBlockType, splitTextBlock, textSel, toggleMark, type Command, type CommandContext, type Dispatch } from './commands.js';
import type { BlockEntry, EditorSelection, EditorState } from './state.js';
import { blockSelection, isCrossBlock, selectionRange, textSelection } from './state.js';
import type { Step } from './steps.js';

function paragraph(children: PhrasingContent[] = []): BlockContent {
    return { type: 'paragraph', children };
}

function listItem(children: BlockContent[], checked?: boolean | null): ListItem {
    const item: ListItem = { type: 'listItem', spread: false, children };
    if (checked !== undefined && checked !== null) item.checked = checked;
    return item;
}

/** The nearest ancestor (or self) entry of a given type. */
function ancestor(state: EditorState, key: string, type: string): BlockEntry | undefined {
    let cur = entryOf(state, key);
    while (cur) {
        if (cur.node.type === type) return cur;
        if (cur.parentKey === null) return undefined;
        cur = entryOf(state, cur.parentKey);
    }
    return undefined;
}

/** The list item and list around a block, when it lives directly in a list item's first block. */
function listContext(state: EditorState, key: string): { item: BlockEntry; list: BlockEntry; itemIndex: number } | null {
    const entry = entryOf(state, key);
    if (!entry || entry.parent.type !== 'listItem' || entry.index !== 0) return null;
    const item = entryOf(state, entry.parentKey!)!;
    if (item.parent.type !== 'list') return null;
    const list = entryOf(state, item.parentKey!)!;
    return { item, list, itemIndex: item.index };
}

export type ListKind = 'bullet' | 'ordered' | 'task';

export function listKindOf(list: List, item: ListItem): ListKind {
    if (item.checked !== undefined && item.checked !== null) return 'task';
    return list.ordered ? 'ordered' : 'bullet';
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export const setLink =
    (url: string, title?: string): Command =>
    (state, dispatch, ctx) => {
        const sel = textSel(state);
        if (!sel) return false;
        const { from, to } = selectionRange(sel);
        const flat = inlineFlat(state, sel.anchor.key, ctx);
        if (!flat) return false;
        const attrs: Record<string, string> = { url };
        if (title) attrs.title = title;
        if (from === to) {
            // No selection: insert the url as its own linked text, as an autolink (`<url>`).
            const slice: InlineFlat = { text: url, spans: [{ start: 0, end: url.length, type: 'link', attrs: { ...attrs, autolink: 'true' } }] };
            dispatch?.({ steps: [{ type: 'replaceInline', key: sel.anchor.key, from, to, slice }], selection: textSelection(sel.anchor.key, from + url.length), meta: meta() });
            return true;
        }
        const next = addMark(removeMark(flat, 'link', from, to), 'link', from, to, attrs);
        dispatch?.({ steps: [{ type: 'setInline', key: sel.anchor.key, flat: next }], selection: sel, meta: meta() });
        return true;
    };

export const unsetLink: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const flat = inlineFlat(state, sel.anchor.key, ctx);
    if (!flat) return false;
    let { from, to } = selectionRange(sel);
    if (from === to) {
        const span = flat.spans.find((s) => s.type === 'link' && s.start <= from && s.end >= from);
        if (!span) return false;
        from = span.start;
        to = span.end;
    }
    dispatch?.({ steps: [{ type: 'setInline', key: sel.anchor.key, flat: removeMark(flat, 'link', from, to) }], selection: sel, meta: meta() });
    return true;
};

// ---------------------------------------------------------------------------
// Enter / Backspace in lists and quotes
// ---------------------------------------------------------------------------

/**
 * Enter in a list item's first text block: an empty item outdents (or becomes
 * a paragraph after the list at the top level); otherwise the caret's tail
 * starts a new item carrying the rest of the old item's blocks.
 */
export const splitListItem: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const key = sel.anchor.key;
    const entry = entryOf(state, key);
    if (!entry || ctx.schema.role(entry.node.type) !== 'textblock') return false;
    const lc = listContext(state, key);
    if (!lc) return false;
    const flat = inlineFlat(state, key, ctx)!;
    const item = lc.item.node as ListItem;
    if (flat.text.length === 0 && item.children.length === 1) {
        return outdentListItem(state, dispatch, ctx) || liftEmptyItem(state, dispatch, ctx, lc);
    }
    const { from, to } = selectionRange(sel);
    const head = sliceFlat(flat, 0, from);
    const tail = sliceFlat(flat, to, flat.text.length);
    const spec = ctx.schema.get(entry.node.type)!;
    const atEnd = to === flat.text.length;
    const nextType = atEnd && spec.splitsTo ? spec.splitsTo : entry.node.type;
    const nextSpec = ctx.schema.get(nextType);
    if (!nextSpec?.fromInline) return false;
    const attrs: Record<string, unknown> = {};
    if (nextType === entry.node.type) for (const [k, v] of Object.entries(entry.node)) if (k !== 'type' && k !== 'key' && k !== 'children' && k !== 'position' && k !== 'value') attrs[k] = v;
    const nextNode = nextSpec.fromInline(toInline(tail, ctx.schema), attrs);
    const rest = item.children.slice(1);
    const checked = item.checked;
    const steps: Step[] = [{ type: 'setInline', key, flat: head }];
    if (rest.length) steps.push({ type: 'replaceBlock', key: item.key!, node: listItem([item.children[0]], checked) });
    steps.push({ type: 'insertBlock', parentKey: lc.list.node.key!, index: lc.itemIndex + 1, node: listItem([nextNode, ...rest], checked === undefined ? undefined : false) });
    dispatch?.({ steps, selection: textSelection(`${keyAt(lc.list.node.key!, lc.itemIndex + 1)}.0`, 0), meta: meta() });
    return true;
};

function liftEmptyItem(state: EditorState, dispatch: Dispatch | undefined, ctx: CommandContext, lc: NonNullable<ReturnType<typeof listContext>>): boolean {
    // Top-level list: turn the item into a paragraph after the list (splitting the list when the item is in the middle).
    const list = lc.list.node as List;
    const before = list.children.slice(0, lc.itemIndex);
    const after = list.children.slice(lc.itemIndex + 1);
    const steps: Step[] = [];
    const listEntry = lc.list;
    const at = listEntry.index;
    if (before.length === 0 && after.length === 0) {
        steps.push({ type: 'replaceBlock', key: list.key!, node: paragraph() });
        dispatch?.({ steps, selection: textSelection(list.key!, 0), meta: meta() });
        return true;
    }
    if (before.length) steps.push({ type: 'replaceBlock', key: list.key!, node: { ...list, children: before } });
    else steps.push({ type: 'removeBlock', parentKey: listEntry.parentKey, index: at });
    const insertAt = before.length ? at + 1 : at;
    steps.push({ type: 'insertBlock', parentKey: listEntry.parentKey, index: insertAt, node: paragraph() });
    if (after.length) steps.push({ type: 'insertBlock', parentKey: listEntry.parentKey, index: insertAt + 1, node: { ...list, children: after } });
    void ctx;
    void state;
    dispatch?.({ steps, selection: textSelection(keyAt(listEntry.parentKey, insertAt), 0), meta: meta() });
    return true;
}

function liftEmptyItemWithContent(state: EditorState, dispatch: Dispatch | undefined, ctx: CommandContext, lc: NonNullable<ReturnType<typeof listContext>>): boolean {
    // Top-level item with content: the item becomes a paragraph (+ its other blocks) after the preceding items.
    const list = lc.list.node as List;
    const item = lc.item.node as ListItem;
    const before = list.children.slice(0, lc.itemIndex);
    const after = list.children.slice(lc.itemIndex + 1);
    const listEntry = lc.list;
    const at = listEntry.index;
    const steps: Step[] = [];
    if (before.length) steps.push({ type: 'replaceBlock', key: list.key!, node: { ...list, children: before } });
    else steps.push({ type: 'removeBlock', parentKey: listEntry.parentKey, index: at });
    let insertAt = before.length ? at + 1 : at;
    const firstKey = keyAt(listEntry.parentKey, insertAt);
    for (const child of item.children) steps.push({ type: 'insertBlock', parentKey: listEntry.parentKey, index: insertAt++, node: child });
    if (after.length) steps.push({ type: 'insertBlock', parentKey: listEntry.parentKey, index: insertAt, node: { ...list, children: after } });
    void state;
    void ctx;
    dispatch?.({ steps, selection: textSelection(firstKey, 0), meta: meta() });
    return true;
}

/** Enter in an empty paragraph that ends a blockquote: lift it out. */
export const liftOutOfBlockquoteAtEnd: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const entry = entryOf(state, sel.anchor.key);
    if (!entry || entry.node.type !== ctx.schema.defaultBlock || entry.parent.type !== 'blockquote') return false;
    if (lengthOf(entry.node, ctx) !== 0 || entry.index !== (entry.parent as { children: unknown[] }).children.length - 1) return false;
    return liftOutOfBlockquote(state, dispatch, ctx);
};

/** Backspace at the start of a list item's paragraph: outdent, or lift the item (with its content) out of a top-level list. */
export const joinBackwardInList: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const { from, to } = selectionRange(sel);
    if (from !== 0 || to !== 0) return false;
    const entry = entryOf(state, sel.anchor.key);
    if (!entry || entry.node.type !== ctx.schema.defaultBlock) return false;
    const lc = listContext(state, sel.anchor.key);
    if (!lc) return false;
    return outdentListItem(state, dispatch, ctx) || liftEmptyItemWithContent(state, dispatch, ctx, lc);
};

/** Backspace at the start of a blockquote's first paragraph: lift it out. */
export const liftOutOfBlockquoteAtStart: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const { from, to } = selectionRange(sel);
    if (from !== 0 || to !== 0) return false;
    const entry = entryOf(state, sel.anchor.key);
    if (!entry || entry.node.type !== ctx.schema.defaultBlock || entry.parent.type !== 'blockquote' || entry.index !== 0) return false;
    return liftOutOfBlockquote(state, dispatch, ctx);
};

const splitAtCaret: Command = chain(splitListItem, liftOutOfBlockquoteAtEnd, splitTextBlock);

/** Enter: over a cross-block range, delete it first; then the list and quote behaviour, then the generic split. */
export const splitBlock: Command = chain(overRange(splitAtCaret), splitAtCaret);

/** Backspace: a cross-block range is deleted; at offset 0, the list and quote behaviour, then the generic join. */
export const joinBackward: Command = chain(deleteRange, joinBackwardInList, liftOutOfBlockquoteAtStart, joinTextBackward);

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/** Wrap the current paragraph(s) in a list of `kind`, change the kind, or unwrap when already that kind. */
export const toggleList =
    (kind: ListKind): Command =>
    (state, dispatch, ctx) => {
        // Over a cross-block range: not yet (range formatting, #57).
        if (isCrossBlock(state.selection)) return false;
        const keys = selectedBlockKeys(state);
        if (!keys.length) return false;
        const first = entryOf(state, keys[0]);
        if (!first) return false;
        const lc = listContext(state, keys[0]);
        if (lc) {
            const list = lc.list.node as List;
            const current = listKindOf(list, lc.item.node as ListItem);
            if (current === kind) return liftEmptyItemWithContent(state, dispatch, ctx, lc);
            // Change the kind of the whole list.
            const steps: Step[] = [{ type: 'setAttrs', key: list.key!, attrs: { ordered: kind === 'ordered', start: kind === 'ordered' ? 1 : null } }];
            for (const item of list.children) {
                steps.push({ type: 'setAttrs', key: item.key!, attrs: { checked: kind === 'task' ? (item.checked ?? false) : undefined } });
            }
            dispatch?.({ steps, selection: state.selection, meta: meta() });
            return true;
        }
        // Wrap: each run of consecutive text blocks and lists among the selected
        // siblings becomes one list (a list's items are spliced in, converted to
        // `kind`); any other block stays where it is and ends the run.
        const entries = keys.map((k) => entryOf(state, k)).filter((e): e is BlockEntry => !!e);
        const isList = (e: BlockEntry): boolean => e.node.type === 'list';
        const convertible = (e: BlockEntry): boolean => isList(e) || (ctx.schema.role(e.node.type) === 'textblock' && e.node.type !== 'tableCell');
        const runs: BlockEntry[][] = [];
        let open: BlockEntry[] | null = null;
        for (const e of entries) {
            if (!convertible(e)) {
                open = null;
                continue;
            }
            if (!open) runs.push((open = []));
            open.push(e);
        }
        // Nothing to wrap, or every run is already a single list of this kind.
        if (!runs.length || runs.every((r) => r.length === 1 && isList(r[0]) && (r[0].node as List).children.every((item) => listKindOf(r[0].node as List, item) === kind))) return false;
        const asItem = (item: ListItem): ListItem => listItem(item.children as BlockContent[], kind === 'task' ? (item.checked ?? false) : undefined);
        const parentKey = entries[0].parentKey;
        const steps: Step[] = [];
        for (let r = runs.length - 1; r >= 0; r--) {
            const run = runs[r];
            const items = run.flatMap((e) => (isList(e) ? (e.node as List).children.map(asItem) : [listItem([e.node as BlockContent], kind === 'task' ? false : undefined)]));
            const list: List = { type: 'list', ordered: kind === 'ordered', spread: false, children: items };
            if (kind === 'ordered') list.start = 1;
            for (let i = run.length - 1; i >= 0; i--) steps.push({ type: 'removeBlock', parentKey, index: run[i].index });
            steps.push({ type: 'insertBlock', parentKey, index: run[0].index, node: list });
        }
        const sel = state.selection;
        const firstIndex = entries[0].index;
        const listKey = keyAt(parentKey, runs[0][0].index);
        let selection: EditorSelection;
        if (sel && sel.mode === 'text') {
            selection = { mode: 'text', anchor: { key: `${listKey}.0.0`, offset: sel.anchor.offset }, head: { key: `${listKey}.0.0`, offset: sel.head.offset } };
        } else {
            // Every run of n blocks collapses into one list.
            const lastIndex = entries[entries.length - 1].index - runs.reduce((n, r) => n + r.length - 1, 0);
            selection = blockSelection(keyAt(parentKey, firstIndex), keyAt(parentKey, lastIndex));
        }
        dispatch?.({ steps, selection, meta: meta() });
        return true;
    };

/** Tab in a list item: nest it under the previous item. */
export const indentListItem: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const lc = listContext(state, sel.anchor.key);
    if (!lc || lc.itemIndex === 0) return false;
    const list = lc.list.node as List;
    const prev = list.children[lc.itemIndex - 1];
    const item = lc.item.node as ListItem;
    const nested = prev.children[prev.children.length - 1];
    const steps: Step[] = [];
    let newKey: string;
    if (nested && nested.type === 'list') {
        // Append to the previous item's existing sub-list.
        steps.push({ type: 'removeBlock', parentKey: list.key!, index: lc.itemIndex });
        const subKey = nested.key!;
        steps.push({ type: 'insertBlock', parentKey: subKey, index: (nested as List).children.length, node: item });
        newKey = `${keyAt(subKey, (nested as List).children.length)}.0`;
    } else {
        steps.push({ type: 'removeBlock', parentKey: list.key!, index: lc.itemIndex });
        const sub: List = { type: 'list', ordered: list.ordered, spread: false, children: [item] };
        if (list.ordered) sub.start = 1;
        steps.push({ type: 'insertBlock', parentKey: prev.key!, index: prev.children.length, node: sub });
        newKey = `${keyAt(prev.key!, prev.children.length)}.0.0`;
    }
    void ctx;
    dispatch?.({ steps, selection: { mode: 'text', anchor: { key: newKey, offset: sel.anchor.offset }, head: { key: newKey, offset: sel.head.offset } }, meta: meta() });
    return true;
};

/** Shift-Tab in a nested list item: move it after its parent item (taking following siblings along as a sub-list). */
export const outdentListItem: Command = (state, dispatch, ctx) => {
    const sel = textSel(state);
    if (!sel) return false;
    const lc = listContext(state, sel.anchor.key);
    if (!lc) return false;
    const list = lc.list.node as List;
    const listEntry = lc.list;
    if (listEntry.parent.type !== 'listItem') return false;
    const parentItem = entryOf(state, listEntry.parentKey!)!;
    const grandList = entryOf(state, parentItem.parentKey!)!;
    const item = lc.item.node as ListItem;
    const after = list.children.slice(lc.itemIndex + 1);
    const before = list.children.slice(0, lc.itemIndex);
    const steps: Step[] = [];
    // Rebuild the parent item: keep its blocks, with the sub-list trimmed to `before` (or removed).
    const parentChildren = (parentItem.node as ListItem).children.slice();
    const subIndex = listEntry.index;
    if (before.length) parentChildren[subIndex] = { ...list, children: before };
    else parentChildren.splice(subIndex, 1);
    steps.push({ type: 'replaceBlock', key: parentItem.node.key!, node: { ...(parentItem.node as ListItem), children: parentChildren } });
    // The outdented item carries the following siblings as its own sub-list.
    const moved: ListItem = after.length ? { ...item, children: [...item.children, { ...list, children: after }] } : item;
    steps.push({ type: 'insertBlock', parentKey: grandList.node.key!, index: parentItem.index + 1, node: moved });
    const newKey = `${keyAt(grandList.node.key!, parentItem.index + 1)}.0`;
    void ctx;
    dispatch?.({ steps, selection: { mode: 'text', anchor: { key: newKey, offset: sel.anchor.offset }, head: { key: newKey, offset: sel.head.offset } }, meta: meta() });
    return true;
};

export const toggleTaskChecked =
    (key?: string): Command =>
    (state, dispatch) => {
        const target = key ?? (state.selection?.mode === 'text' ? state.selection.anchor.key : state.selection?.anchorKey);
        if (!target) return false;
        const item = ancestor(state, target, 'listItem');
        if (!item) return false;
        const node = item.node as ListItem;
        if (node.checked === undefined || node.checked === null) return false;
        dispatch?.({ steps: [{ type: 'setAttrs', key: node.key!, attrs: { checked: !node.checked } }], selection: state.selection, meta: meta() });
        return true;
    };

// ---------------------------------------------------------------------------
// Blockquotes
// ---------------------------------------------------------------------------

export const wrapInBlockquote: Command = (state, dispatch) => {
    // Over a cross-block range: not yet (range formatting, #57).
    if (isCrossBlock(state.selection)) return false;
    const keys = selectedBlockKeys(state);
    if (!keys.length) return false;
    const entries = keys.map((k) => entryOf(state, k)).filter((e): e is BlockEntry => !!e);
    if (!entries.length || entries[0].parent.type === 'blockquote') return false;
    const parentKey = entries[0].parentKey;
    const startIndex = entries[0].index;
    const steps: Step[] = [];
    for (let i = entries.length - 1; i >= 0; i--) steps.push({ type: 'removeBlock', parentKey, index: entries[i].index });
    steps.push({ type: 'insertBlock', parentKey, index: startIndex, node: { type: 'blockquote', children: entries.map((e) => e.node as BlockContent) } });
    const qKey = keyAt(parentKey, startIndex);
    const sel = state.selection;
    const selection: EditorSelection = sel && sel.mode === 'text' ? { mode: 'text', anchor: { key: `${qKey}.0`, offset: sel.anchor.offset }, head: { key: `${qKey}.0`, offset: sel.head.offset } } : blockSelection(qKey);
    dispatch?.({ steps, selection, meta: meta() });
    return true;
};

export const liftOutOfBlockquote: Command = (state, dispatch) => {
    // Over a cross-block range: not yet (range formatting, #57).
    if (isCrossBlock(state.selection)) return false;
    const keys = selectedBlockKeys(state);
    if (!keys.length) return false;
    const entry = entryOf(state, keys[0]);
    if (!entry || entry.parent.type !== 'blockquote') return false;
    const quote = entryOf(state, entry.parentKey!)!;
    const children = (quote.node as { children: BlockContent[] }).children;
    const before = children.slice(0, entry.index);
    const lifted = children.slice(entry.index, entry.index + keys.length);
    const after = children.slice(entry.index + keys.length);
    const steps: Step[] = [];
    const at = quote.index;
    if (before.length) steps.push({ type: 'replaceBlock', key: quote.node.key!, node: { type: 'blockquote', children: before } });
    else steps.push({ type: 'removeBlock', parentKey: quote.parentKey, index: at });
    let insertAt = before.length ? at + 1 : at;
    const firstKey = keyAt(quote.parentKey, insertAt);
    for (const node of lifted) steps.push({ type: 'insertBlock', parentKey: quote.parentKey, index: insertAt++, node });
    if (after.length) steps.push({ type: 'insertBlock', parentKey: quote.parentKey, index: insertAt, node: { type: 'blockquote', children: after } });
    const sel = state.selection;
    const selection: EditorSelection = sel && sel.mode === 'text' ? { mode: 'text', anchor: { key: firstKey, offset: sel.anchor.offset }, head: { key: firstKey, offset: sel.head.offset } } : blockSelection(firstKey);
    dispatch?.({ steps, selection, meta: meta() });
    return true;
};

// ---------------------------------------------------------------------------
// Void blocks, images, tables
// ---------------------------------------------------------------------------

export const insertThematicBreak: Command = insertBlockAfter({ type: 'thematicBreak' }, { replaceEmpty: true });

export const insertImage = (url: string, alt = '', title?: string): Command => {
    return (state, dispatch, ctx) => {
        const attrs: Record<string, string> = { url, alt };
        if (title) attrs.title = title;
        return insertAtom('image', attrs)(state, dispatch, ctx);
    };
};

export const insertTable =
    (rows = 2, cols = 2): Command =>
    (state, dispatch, ctx) => {
        const cell = (): TableCell => ({ type: 'tableCell', children: [] });
        const row = (): TableRow => ({ type: 'tableRow', children: Array.from({ length: cols }, cell) });
        const table: Table = { type: 'table', align: Array.from({ length: cols }, () => null), children: Array.from({ length: rows }, row) };
        return insertBlockAfter(table)(state, dispatch, ctx);
    };

function tableContext(state: EditorState, key: string): { table: BlockEntry; row: BlockEntry; cell: BlockEntry } | null {
    const cell = entryOf(state, key);
    if (!cell || cell.node.type !== 'tableCell') return null;
    const row = entryOf(state, cell.parentKey!)!;
    const table = entryOf(state, row.parentKey!)!;
    return { table, row, cell };
}

const tableOp =
    (fn: (table: Table, row: number, col: number) => Table | null, selectCell?: (row: number, col: number) => [number, number]): Command =>
    (state, dispatch) => {
        const key = textSel(state)?.anchor.key;
        if (!key) return false;
        const tc = tableContext(state, key);
        if (!tc) return false;
        const next = fn(tc.table.node as Table, tc.row.index, tc.cell.index);
        if (!next) return false;
        const [r, c] = selectCell ? selectCell(tc.row.index, tc.cell.index) : [tc.row.index, tc.cell.index];
        const tableKey = tc.table.node.key!;
        const cr = Math.min(r, next.children.length - 1);
        const cc = Math.min(c, next.children[cr].children.length - 1);
        dispatch?.({ steps: [{ type: 'replaceBlock', key: tableKey, node: next }], selection: textSelection(`${tableKey}.${cr}.${cc}`, 0), meta: meta() });
        return true;
    };

const emptyRow = (cols: number): TableRow => ({ type: 'tableRow', children: Array.from({ length: cols }, () => ({ type: 'tableCell', children: [] })) });

export const addRowAfter: Command = tableOp((t, r) => ({ ...t, children: [...t.children.slice(0, r + 1), emptyRow(t.children[0].children.length), ...t.children.slice(r + 1)] }), (r, c) => [r + 1, c]);
export const addRowBefore: Command = tableOp((t, r) => (r === 0 ? null : { ...t, children: [...t.children.slice(0, r), emptyRow(t.children[0].children.length), ...t.children.slice(r)] }));
export const deleteRow: Command = tableOp((t, r) => (r === 0 || t.children.length <= 2 ? null : { ...t, children: t.children.filter((_, i) => i !== r) }), (r, c) => [Math.max(1, r - 1), c]);
export const addColumnAfter: Command = tableOp((t, _r, c) => ({
    ...t,
    align: [...(t.align ?? []).slice(0, c + 1), null, ...(t.align ?? []).slice(c + 1)],
    children: t.children.map((row) => ({ ...row, children: [...row.children.slice(0, c + 1), { type: 'tableCell', children: [] }, ...row.children.slice(c + 1)] })),
}), (r, c) => [r, c + 1]);
export const addColumnBefore: Command = tableOp((t, _r, c) => ({
    ...t,
    align: [...(t.align ?? []).slice(0, c), null, ...(t.align ?? []).slice(c)],
    children: t.children.map((row) => ({ ...row, children: [...row.children.slice(0, c), { type: 'tableCell', children: [] }, ...row.children.slice(c)] })),
}));
export const deleteColumn: Command = tableOp((t, _r, c) =>
    t.children[0].children.length <= 1
        ? null
        : { ...t, align: (t.align ?? []).filter((_, i) => i !== c), children: t.children.map((row) => ({ ...row, children: row.children.filter((_, i) => i !== c) })) }, (r, c) => [r, Math.max(0, c - 1)]);
export const setColumnAlign = (align: 'left' | 'center' | 'right' | null): Command =>
    tableOp((t, _r, c) => {
        const next = [...(t.align ?? t.children[0].children.map(() => null))];
        next[c] = align;
        return { ...t, align: next };
    });

// ---------------------------------------------------------------------------
// Named forms
// ---------------------------------------------------------------------------

export const toggleStrong: Command = toggleMark('strong');
export const toggleEmphasis: Command = toggleMark('emphasis');
export const toggleDelete: Command = toggleMark('delete');
export const toggleInlineCode: Command = toggleMark('inlineCode');
export const setParagraph: Command = setBlockType('paragraph');
export const setHeading = (depth: 1 | 2 | 3 | 4 | 5 | 6): Command => setBlockType('heading', { depth });
export const setCodeBlock: Command = setBlockType('code');
export const toggleBulletList: Command = toggleList('bullet');
export const toggleOrderedList: Command = toggleList('ordered');
export const toggleTaskList: Command = toggleList('task');

/** Whether a block is a list item's paragraph (for toolbars and menus). */
export function inListItem(state: EditorState, key: string): boolean {
    return listContext(state, key) !== null;
}

export { firstEditable };
