/**
 * Transactions — a list of steps applied atomically to a state, with the
 * metadata the history, the surfaces and the plugins need to interpret it.
 */

import type { Root } from '../ast/index.js';
import type { Schema } from '../schema/index.js';
import type { BlockIndex, EditorSelection, EditorState, Point } from './state.js';
import { buildIndex, makeState } from './state.js';
import type { Step, StepContext } from './steps.js';
import { applyStep, invertStep } from './steps.js';

export type TransactionOrigin = 'surface' | 'command' | 'history' | 'external' | 'paste' | 'inputRule';

export interface TransactionMeta {
    /** Who produced it. `surface` transactions are never pushed back to their source surface. */
    origin: TransactionOrigin;
    /** The block key of the surface that produced a `surface` transaction. */
    sourceKey?: string;
    /** Record in history (default `true`; `false` for `history` and `external`). */
    addToHistory?: boolean;
    /** History grouping key: consecutive entries with the same group merge (`'typing'`, `'ime'`, …). */
    group?: string;
    /** An IME composition is in progress (the entry joins the open `ime` group and is never pushed to surfaces). */
    composing?: boolean;
    /** The input rule that fired, so Backspace right after can undo just that. */
    inputRule?: string;
    /** Free-form plugin data. */
    [key: string]: unknown;
}

export interface Transaction {
    steps: Step[];
    /** Selection after the transaction; `undefined` keeps the current one (mapped through the steps where possible). */
    selection?: EditorSelection;
    /** Set `composing` on the resulting state. */
    composing?: boolean;
    meta: TransactionMeta;
}

export interface AppliedTransaction {
    state: EditorState;
    /** The steps that undo this transaction, in the order to apply them. */
    inverse: Step[];
}

export function transaction(steps: Step[], meta: TransactionMeta, extra?: Omit<Transaction, 'steps' | 'meta'>): Transaction {
    return { steps, meta, ...extra };
}

/** Apply a transaction, producing the next state and its inverse steps. Steps are applied in order; the inverse list is reversed. */
export function applyTransaction(state: EditorState, tr: Transaction, ctx: StepContext): AppliedTransaction {
    let doc: Root = state.doc;
    const inverse: Step[] = [];
    for (const step of tr.steps) {
        inverse.push(invertStep(doc, step, ctx));
        doc = applyStep(doc, step, ctx);
    }
    inverse.reverse();
    const selection = tr.selection !== undefined ? tr.selection : mapSelection(state.selection, tr.steps, doc, ctx.schema);
    const composing = tr.composing ?? (tr.meta.composing ?? state.composing);
    const next = makeState(doc, selection, state.rev + (tr.steps.length || tr.selection !== undefined ? 1 : 0), composing, ctx.schema);
    return { state: next, inverse };
}

/**
 * Keep a selection meaningful across steps that did not set one: each end of
 * a text selection follows inline edits in its own block, and the selection
 * is dropped when either end's block disappears; block selections are
 * dropped on structural change.
 */
export function mapSelection(sel: EditorSelection, steps: Step[], doc: Root, schema: Schema): EditorSelection {
    if (!sel) return null;
    // The post-step index, built once on first need and shared by every structural step.
    let index: BlockIndex | null = null;
    const existsIn = (key: string): boolean => (index ??= buildIndex(doc, schema)).get(key) !== undefined;
    let cur: EditorSelection = sel;
    for (const step of steps) {
        if (!cur) return null;
        if (cur.mode === 'text') {
            const anchor = mapPoint(cur.anchor, step, existsIn);
            const head = mapPoint(cur.head, step, existsIn);
            cur = anchor && head ? (anchor === cur.anchor && head === cur.head ? cur : { mode: 'text', anchor, head }) : null;
        } else if (step.type !== 'replaceInline' && step.type !== 'setInline' && step.type !== 'setValue' && step.type !== 'setAttrs') {
            cur = existsIn(cur.anchorKey) && existsIn(cur.headKey) ? cur : null;
        }
    }
    return cur;
}

/** One end of a text selection through one step; `null` when its block is gone. Returns `p` itself when unchanged. */
function mapPoint(p: Point, step: Step, existsIn: (key: string) => boolean): Point | null {
    switch (step.type) {
        case 'replaceInline': {
            if (step.key !== p.key) return p;
            const o = p.offset;
            const offset = o <= step.from ? o : o >= step.to ? o + (step.slice.text.length - (step.to - step.from)) : step.from + step.slice.text.length;
            return offset === o ? p : { key: p.key, offset };
        }
        case 'setInline':
        case 'setValue': {
            if (step.key !== p.key) return p;
            const len = step.type === 'setInline' ? step.flat.text.length : step.value.length;
            return p.offset <= len ? p : { key: p.key, offset: len };
        }
        case 'replaceBlock':
        case 'insertBlock':
        case 'removeBlock':
        case 'moveBlock':
        case 'replaceDoc':
            // Structural: keep only if the block still exists (keys may have shifted, so verify).
            return existsIn(p.key) ? p : null;
        default:
            return p;
    }
}
