/**
 * The surface bridge: turns what a surface reports into transactions, and
 * decides what a surface must be told after a transaction.
 *
 * Echo suppression has two layers. A transaction produced by a surface is
 * tagged `origin: 'surface'` + `sourceKey`, and the view never pushes such a
 * transaction back into its source. Even when that fast path is missed
 * (undo, a command editing the focused block), `InlineSurface.setInline` is a
 * no-op when the content is already equal, so nothing flickers.
 *
 * IME: while a surface is composing, its provisional changes still reach the
 * state (triggers and the toolbar need the text) as one open `ime` history
 * group, but the editor suppresses model write-back and structural commands
 * until `compositionEnd`. External document writes that arrive mid-composition
 * are queued by the editor (`pendingExternal`) and applied afterwards.
 */

import type { InlineFlat } from './inline-flat.js';
import type { Schema } from '../schema/index.js';
import { flatEquals } from './inline-flat.js';
import type { PasteData } from './paste.js';
import type { EditorSelection, TextSelection } from './state.js';
import { textSelection } from './state.js';
import type { Step } from './steps.js';
import type { Transaction } from './transaction.js';
import type { CodeSurfaceEvents, InlineSurfaceEvents, Range, SurfaceChangeEvent } from './surface.js';

/** What the bridge needs from the editor. */
export interface BridgeHost {
    /** The document schema (marks vs atoms, for comparing flat models). */
    schema: Schema;
    dispatch(tr: Transaction): void;
    /** Run the keymap binding for a boundary key against the current state; returns whether something handled it. */
    runKey(name: string): boolean;
    /** Update the selection without a document change. */
    setSelection(selection: EditorSelection): void;
    /** Paste handling: the editor picks the format that reads a flavour present. Returns whether it was handled. */
    paste(data: PasteData): boolean;
    /** Current flat content of a block (for diffing whole-content changes). */
    flatOf(key: string): InlineFlat | null;
    /** Current value of a code block. */
    valueOf(key: string): string | null;
    focused(key: string | null): void;
    /** The editor's stored marks (for text typed next at a caret); hosts without them omit it. */
    storedMarks?(): readonly string[] | null;
}

/** Compute the minimal `replaceInline` between two flat models (common prefix/suffix on the text; spans from the new model). */
export function diffFlat(prev: InlineFlat, next: InlineFlat, schema?: Schema): { from: number; to: number; insert: InlineFlat } | null {
    if (flatEquals(prev, next, schema)) return null;
    const a = prev.text;
    const b = next.text;
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA--;
        endB--;
    }
    // Spans differ but text does not (a mark toggle): fall back to a whole-content replacement.
    if (start === endA && start === endB && a === b) return { from: 0, to: a.length, insert: next };
    const insert: InlineFlat = {
        text: b.slice(start, endB),
        spans: next.spans
            .filter((s) => s.end > start && s.start < endB)
            .map((s) => ({ ...s, start: Math.max(s.start, start) - start, end: Math.min(s.end, endB) - start })),
    };
    return { from: start, to: endA, insert };
}

export interface InlineBridge {
    events: InlineSurfaceEvents;
    /** Whether a transaction must be pushed into this surface (false for its own echoes). */
    shouldPush(tr: Transaction): boolean;
}

/** Create the event handlers for an inline surface bound to block `key`. */
export function createInlineBridge(key: string, host: BridgeHost): InlineBridge {
    let composing = false;

    /** A selection the surface reports, clamped to `length` (surfaces may report stale offsets). */
    const sel = (range: Range, length: number): TextSelection => {
        const r = clampRange(range, length);
        return textSelection(key, r.start, r.end);
    };
    /** The current content's length, for events that carry a range but no content. */
    const lengthOf = (): number => host.flatOf(key)?.text.length ?? 0;

    const submit = (e: SurfaceChangeEvent, endingComposition = false): void => {
        const prev = host.flatOf(key);
        if (!prev) return;
        const selection: EditorSelection = e.selection ? sel(e.selection, e.flat.text.length) : null;
        let steps: Step[];
        if (e.replaced && replacedMatches(prev, e.replaced, e.flat)) {
            steps = [{ type: 'replaceInline', key, from: e.replaced.from, to: e.replaced.to, slice: e.replaced.insert }];
        } else {
            const d = diffFlat(prev, e.flat, host.schema);
            if (!d) {
                if (e.selection) host.setSelection(selection);
                return;
            }
            // A whole-content replacement (mark toggles, IME commits) is a setInline; a local edit stays a replaceInline so history can group it.
            steps = d.from === 0 && d.to === prev.text.length && d.insert.text === e.flat.text ? [{ type: 'setInline', key, flat: e.flat }] : [{ type: 'replaceInline', key, from: d.from, to: d.to, slice: d.insert }];
        }
        // Stored marks (a mark toggled at the caret) decide the marks of typed text: the surface
        // rendered it with the marks around it, so the result is pushed back to it (origin command).
        let origin: 'surface' | 'command' = 'surface';
        const stored = !e.composing && !endingComposition ? host.storedMarks?.() : null;
        const step = steps[0];
        if (stored && steps.length === 1 && step.type === 'replaceInline' && step.slice.text) {
            const len = step.slice.text.length;
            const kept = step.slice.spans.filter((s) => host.schema.role(s.type) !== 'mark' || (s.attrs && Object.keys(s.attrs).length));
            steps = [{ ...step, slice: { text: step.slice.text, spans: [...kept, ...stored.map((type) => ({ start: 0, end: len, type }))] } }];
            origin = 'command';
        }
        host.dispatch({
            steps,
            selection: e.selection ? selection : undefined,
            composing: e.composing,
            // They hold while typing continues at the caret (a browser decides for itself whether the caret after a
            // mark types inside it); moving the caret clears them.
            ...(origin === 'command' ? { storedMarks: stored } : {}),
            // The commit that ends a composition joins the open `ime` group, so the whole composition is one undo.
            meta: { origin, sourceKey: key, group: e.composing || endingComposition ? 'ime' : 'typing', composing: e.composing },
        });
    };

    const events: InlineSurfaceEvents = {
        change: (e) => {
            composing = e.composing;
            submit(e);
        },
        selection: (e) => host.setSelection(sel(e.range, lengthOf())),
        boundary: (e) => {
            host.setSelection(sel(e.range, lengthOf()));
            return host.runKey(e.key);
        },
        keydown: (name, range) => {
            host.setSelection(sel(range, lengthOf()));
            return host.runKey(name);
        },
        paste: (e) => {
            host.setSelection(sel(e.range, lengthOf()));
            return host.paste(e.data);
        },
        focus: () => host.focused(key),
        blur: () => host.focused(null),
        compositionStart: () => {
            composing = true;
            host.dispatch({ steps: [], composing: true, meta: { origin: 'surface', sourceKey: key, addToHistory: false, composing: true } });
        },
        compositionEnd: (flat) => {
            composing = false;
            submit({ flat, selection: null, composing: false }, true);
            host.dispatch({ steps: [], composing: false, meta: { origin: 'surface', sourceKey: key, addToHistory: false } });
        },
    };

    return {
        events,
        shouldPush: (tr) => !(tr.meta.origin === 'surface' && tr.meta.sourceKey === key) && !(composing && tr.meta.composing),
    };
}

export interface CodeBridge {
    events: CodeSurfaceEvents;
    shouldPush(tr: Transaction): boolean;
}

export function createCodeBridge(key: string, host: BridgeHost): CodeBridge {
    const sel = (range: Range, length: number): TextSelection => {
        const r = clampRange(range, length);
        return textSelection(key, r.start, r.end);
    };
    const lengthOf = (): number => host.valueOf(key)?.length ?? 0;

    const events: CodeSurfaceEvents = {
        change: (e) => {
            const prev = host.valueOf(key);
            if (prev === null || prev === e.value) {
                if (e.selection) host.setSelection(sel(e.selection, e.value.length));
                return;
            }
            host.dispatch({
                steps: [{ type: 'setValue', key, value: e.value }],
                selection: e.selection ? sel(e.selection, e.value.length) : undefined,
                composing: e.composing,
                meta: { origin: 'surface', sourceKey: key, group: e.composing ? 'ime' : 'typing', composing: e.composing },
            });
        },
        selection: (e) => host.setSelection(sel(e.range, lengthOf())),
        boundary: (e) => {
            host.setSelection(sel(e.range, lengthOf()));
            return host.runKey(e.key);
        },
        keydown: (name, range) => {
            host.setSelection(textSelection(key, range.start, range.end));
            return host.runKey(name);
        },
        langChange: (lang) => host.dispatch({ steps: [{ type: 'setAttrs', key, attrs: { lang } }], meta: { origin: 'surface', sourceKey: key } }),
        focus: () => host.focused(key),
        blur: () => host.focused(null),
    };
    return { events, shouldPush: (tr) => !(tr.meta.origin === 'surface' && tr.meta.sourceKey === key) };
}

/**
 * Whether a surface's `replaced` hint really turns `prev` into `next`. A
 * surface reports the edit against what it last showed, which can be stale
 * (an external write deferred past a composition, a delayed DOM selection
 * update); a hint that is out of range or does not reproduce the content
 * would make `applyStep` throw or corrupt the block, so the bridge falls back
 * to diffing the content instead.
 */
function replacedMatches(prev: InlineFlat, r: { from: number; to: number; insert: InlineFlat }, next: InlineFlat): boolean {
    if (r.from < 0 || r.to > prev.text.length || r.from > r.to) return false;
    return prev.text.slice(0, r.from) + r.insert.text + prev.text.slice(r.to) === next.text;
}

/** Clamp a range to a length (surfaces may report stale offsets). */
export function clampRange(range: Range, length: number): Range {
    return { start: Math.max(0, Math.min(range.start, length)), end: Math.max(0, Math.min(range.end, length)) };
}
