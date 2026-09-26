/**
 * Tree helpers every command module shares: block lookup, the editable
 * leaves at a block's edges, and a block's text length. Kept apart from the
 * commands so `range.ts` and the command modules can all build on them.
 */

import type { BlockContent, PhrasingContent, Root } from '../ast/index.js';
import type { Schema } from '../schema/index.js';
import { toFlat } from './inline-flat.js';
import type { BlockEntry, EditorBlock, EditorState } from './state.js';

/** The part of a command context the helpers read. */
export interface SchemaContext {
    schema: Schema;
}

export function entryOf(state: EditorState, key: string): BlockEntry | undefined {
    return state.index().get(key);
}

/** First editable descendant of a block (or itself). */
export function firstEditable(node: EditorBlock, ctx: SchemaContext): EditorBlock | undefined {
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

export function lastEditable(node: EditorBlock, ctx: SchemaContext): EditorBlock | undefined {
    const role = ctx.schema.role(node.type);
    if (role === 'textblock' || role === 'code') return node;
    const children = (node as { children?: EditorBlock[] }).children ?? [];
    for (let i = children.length - 1; i >= 0; i--) {
        const found = lastEditable(children[i], ctx);
        if (found) return found;
    }
    return undefined;
}

export function lengthOf(node: EditorBlock, ctx: SchemaContext): number {
    const role = ctx.schema.role(node.type);
    if (role === 'code') return (node as { value: string }).value.length;
    if (role === 'textblock') return toFlat((node as { children: PhrasingContent[] }).children, ctx.schema).text.length;
    return 0;
}

/** A block's own attributes (everything but type, key, children, position, value). */
export function ownAttrs(node: EditorBlock): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) if (k !== 'type' && k !== 'key' && k !== 'children' && k !== 'position' && k !== 'value') out[k] = v;
    return out;
}

export function stripKeys<T>(node: T): T {
    return JSON.parse(JSON.stringify(node, (k, v) => (k === 'key' || k === 'position' ? undefined : v)));
}

/** `entry` and its ancestors, outermost first. */
function pathOf(state: EditorState, entry: BlockEntry): BlockEntry[] {
    const path = [entry];
    while (path[0].parentKey !== null) path.unshift(entryOf(state, path[0].parentKey)!);
    return path;
}

/** The sibling run between two blocks at their lowest common parent (see `selectedBlockKeys`), in document order. */
export function siblingRun(state: EditorState, anchorKey: string, headKey: string): string[] {
    const a = entryOf(state, anchorKey);
    const h = entryOf(state, headKey);
    if (!a || !h) return a ? [anchorKey] : [];
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
 * A clipboard document of sibling `nodes` that live under `parentKey`. Nodes
 * that cannot stand on their own are wrapped in a copy of the parent they
 * need (a list item in its list, a row in its table): the walk goes up until
 * it reaches the root or a flow container (one with `fillsWith`, whose
 * children can be any block).
 */
export function clipboardRoot(state: EditorState, parentKey: string | null, nodes: EditorBlock[], ctx: SchemaContext): Root {
    let out = nodes;
    let key = parentKey;
    while (key !== null) {
        const parent = entryOf(state, key)!;
        if (ctx.schema.get(parent.node.type)?.fillsWith) break;
        out = [{ type: parent.node.type, ...stripKeys(ownAttrs(parent.node)), children: out } as EditorBlock];
        key = parent.parentKey;
    }
    return { type: 'root', children: out as BlockContent[] };
}
