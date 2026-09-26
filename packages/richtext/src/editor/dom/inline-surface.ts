/**
 * `DomInlineSurface` — the contenteditable implementation of `InlineSurface`.
 *
 * One host element per inline block. The browser edits the DOM; the surface
 * reads it back (`readInline`) after every `input` and reports the whole
 * content (the bridge diffs it). Structure never changes here: Enter,
 * Backspace/Delete at the edges, arrows off the first/last visual line, Tab
 * and Escape are `boundary` events the core answers; every modifier chord is
 * forwarded as `keydown` so the keymap (and plugin popups) see it. Native
 * formatting commands (`formatBold`, `historyUndo`, …) are cancelled and
 * routed through the keymap, paste goes through `paste`, drops are refused.
 *
 * IME: `compositionstart` opens a composition, every `input` during it is a
 * `composing` change, `compositionend` reads the committed content once. A
 * trailing `input` some browsers fire after `compositionend` is deduplicated
 * against the last reported content.
 */

import { flatEquals } from '../inline-flat.js';
import type { PasteData } from '../paste.js';
import type { InlineFlat } from '../inline-flat.js';
import { keyNames } from '../keys.js';
import type { KeyPlatform } from '../keys.js';
import type { BoundaryKey, CaretRect, InlineSurface, InlineSurfaceInit, Range as TextRange } from '../surface.js';
import { hostLength, offsetToPoint, pointToOffset, readInline, renderInline } from './inline-dom.js';
import type { AtomRenderer } from './inline-dom.js';
import { caretClientRect, isForward, onEdgeLine, pointFromClient, rangeIn, relativeCaretRect, selectionFor, setDomSelection } from './selection.js';

export interface DomInlineSurfaceOptions {
    platform: KeyPlatform;
    /** Atom renderers by type (mention chips, images). */
    atoms?: ReadonlyMap<string, AtomRenderer>;
    /** The element `caretRect` is relative to. Default: the host. */
    origin?: () => Element;
    /** Called when the host's emptiness changes (for the placeholder). */
    onEmpty?: (empty: boolean) => void;
}

export interface DomInlineSurface extends InlineSurface {
    readonly host: HTMLElement;
    readonly key: string;
}

const FORMAT_KEYS: Record<string, string> = {
    formatBold: 'Mod-b',
    formatItalic: 'Mod-i',
    formatStrikeThrough: 'Mod-Shift-x',
    historyUndo: 'Mod-z',
    historyRedo: 'Mod-Shift-z',
};

/** Input types the browser must never perform on an inline surface (structure, drops, unsupported formatting). */
const REFUSED_INPUT = new Set([
    'insertParagraph',
    'insertLineBreak',
    'insertOrderedList',
    'insertUnorderedList',
    'insertHorizontalRule',
    'insertFromDrop',
    'insertLink',
    'formatUnderline',
    'formatSuperscript',
    'formatSubscript',
    'formatJustifyFull',
    'formatJustifyCenter',
    'formatJustifyRight',
    'formatJustifyLeft',
    'formatIndent',
    'formatOutdent',
    'formatRemove',
    'formatSetBlockTextDirection',
    'formatSetInlineTextDirection',
    'formatBackColor',
    'formatFontColor',
    'formatFontName',
]);

/** Per-document `selectionchange` fan-out: one listener, however many surfaces; removed with the last subscriber. */
const listeners = new WeakMap<Document, { set: Set<() => void>; handler: () => void }>();
function watchSelection(d: Document, fn: () => void): () => void {
    let entry = listeners.get(d);
    if (!entry) {
        const set = new Set<() => void>();
        const handler = (): void => {
            for (const f of Array.from(set)) f();
        };
        entry = { set, handler };
        listeners.set(d, entry);
        d.addEventListener('selectionchange', handler);
    }
    entry.set.add(fn);
    return () => {
        const e = listeners.get(d);
        if (!e) return;
        e.set.delete(fn);
        if (e.set.size === 0) {
            d.removeEventListener('selectionchange', e.handler);
            listeners.delete(d);
        }
    };
}

export function createDomInlineSurface(host: HTMLElement, init: InlineSurfaceInit, opts: DomInlineSurfaceOptions): DomInlineSurface {
    const { events } = init;
    const d = host.ownerDocument;
    let readOnly = init.readOnly;
    let composing = false;
    let destroyed = false;
    /** The last content reported to, or received from, the core — the echo and duplicate guard. */
    let known: InlineFlat = init.flat;
    /** The last range reported through `selection`. */
    let lastRange: TextRange | null = null;
    /** A selection to restore on the next focus when the host is not yet laid out. */
    let pendingRange: TextRange | null = null;
    let wasEmpty = init.flat.text.length === 0;

    host.setAttribute('contenteditable', readOnly ? 'false' : 'true');
    host.setAttribute('role', 'textbox');
    host.setAttribute('aria-multiline', 'false');
    host.setAttribute('spellcheck', 'true');
    if (init.placeholder !== undefined) host.setAttribute('data-placeholder', init.placeholder);
    renderInline(host, init.flat, { atoms: opts.atoms, schema: init.schema });
    syncEmpty(init.flat);

    function syncEmpty(flat: InlineFlat): void {
        const empty = flat.text.length === 0;
        host.toggleAttribute('data-empty', empty);
        if (empty !== wasEmpty) {
            wasEmpty = empty;
            opts.onEmpty?.(empty);
        }
    }

    const length = (): number => hostLength(host);

    function currentRange(): TextRange | null {
        const r = rangeIn(host);
        if (!r) return null;
        const a = pointToOffset(host, r.startContainer, r.startOffset);
        const f = pointToOffset(host, r.endContainer, r.endOffset);
        return { start: Math.min(a, f), end: Math.max(a, f) };
    }

    function focusPoint(): { node: Node; offset: number } | null {
        const r = rangeIn(host);
        if (!r) return null;
        const sel = selectionFor(host);
        const forward = sel ? isForward(sel) : true;
        return forward ? { node: r.endContainer, offset: r.endOffset } : { node: r.startContainer, offset: r.startOffset };
    }

    function clientCaret(): DOMRect | null {
        const p = focusPoint();
        return p ? caretClientRect(host, p) : null;
    }

    function applySelection(range: TextRange): void {
        const len = length();
        const start = Math.max(0, Math.min(range.start, len));
        const end = Math.max(0, Math.min(range.end, len));
        setDomSelection(host, offsetToPoint(host, start), offsetToPoint(host, end));
        lastRange = { start, end };
    }

    function report(): void {
        const flat = readInline(host, init.schema);
        syncEmpty(flat);
        if (!composing && flatEquals(flat, known, init.schema)) return;
        known = flat;
        events.change({ flat, selection: currentRange(), composing });
    }

    function boundary(key: BoundaryKey, range: TextRange, goalX?: number): boolean {
        return events.boundary(goalX === undefined ? { key, range } : { key, range, goalX });
    }

    function forwardKey(e: KeyboardEvent, range: TextRange): boolean {
        if (!events.keydown) return false;
        for (const name of keyNames(e, opts.platform)) if (events.keydown(name, range)) return true;
        return false;
    }

    // -- listeners ---------------------------------------------------------

    const onKeydown = (e: KeyboardEvent): void => {
        if (readOnly || composing || e.isComposing || e.keyCode === 229) return;
        const range = currentRange() ?? lastRange ?? { start: 0, end: 0 };
        const collapsed = range.start === range.end;
        const len = length();
        const mod = e.ctrlKey || e.metaKey;
        let consumed: boolean | null = null;
        switch (e.key) {
            case 'Enter':
                if (e.altKey) break;
                consumed = boundary(e.shiftKey ? 'Shift-Enter' : mod ? 'Mod-Enter' : 'Enter', range);
                break;
            case 'Backspace':
                if (collapsed && range.start === 0 && !e.altKey && !mod) consumed = boundary('Backspace', range);
                else consumed = false;
                break;
            case 'Delete':
                if (collapsed && range.start === len && !e.altKey && !mod) consumed = boundary('Delete', range);
                else consumed = false;
                break;
            case 'ArrowUp':
            case 'ArrowDown': {
                if (e.altKey || mod) break;
                const caret = clientCaret();
                const edge = e.key === 'ArrowUp' ? 'first' : 'last';
                if (!onEdgeLine(host, caret, edge)) {
                    consumed = false;
                    break;
                }
                if (e.shiftKey) {
                    // Shift-arrows off the edge extend into a block selection: a keymap binding, not a boundary.
                    consumed = forwardKey(e, range);
                    break;
                }
                const origin = opts.origin?.() ?? host;
                const goalX = caret ? relativeCaretRect(caret, origin).x : undefined;
                consumed = boundary(e.key, range, goalX);
                break;
            }
            case 'ArrowLeft':
                if (collapsed && range.start === 0 && !e.altKey && !mod) consumed = boundary('ArrowLeft', range);
                else consumed = false;
                break;
            case 'ArrowRight':
                if (collapsed && range.start === len && !e.altKey && !mod) consumed = boundary('ArrowRight', range);
                else consumed = false;
                break;
            case 'Tab':
                if (e.altKey || mod) break;
                consumed = boundary(e.shiftKey ? 'Shift-Tab' : 'Tab', range);
                break;
            case 'Escape':
                consumed = boundary('Escape', range);
                break;
        }
        if (consumed === null && mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
            // Select-all is progressive: the block's own text first (the browser's default), every block on the next press.
            consumed = collapsed || range.start > 0 || range.end < len ? false : forwardKey(e, range);
            if (len === 0) consumed = forwardKey(e, range);
        }
        if (consumed === null) {
            // Everything else reaches the keymap only when it is a chord or a named key; plain typing stays with the browser.
            const named = e.key.length > 1 && e.key !== 'Unidentified' && e.key !== 'Dead';
            if (mod || e.altKey || named) consumed = forwardKey(e, range);
            else consumed = false;
        }
        if (consumed) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    const onBeforeInput = (e: InputEvent): void => {
        if (readOnly) {
            e.preventDefault();
            return;
        }
        const type = e.inputType;
        if (REFUSED_INPUT.has(type)) {
            e.preventDefault();
            const range = currentRange() ?? lastRange ?? { start: 0, end: 0 };
            // A virtual keyboard's Enter arrives here without a usable keydown.
            if (type === 'insertParagraph') boundary('Enter', range);
            else if (type === 'insertLineBreak') boundary('Shift-Enter', range);
            return;
        }
        const chord = FORMAT_KEYS[type];
        if (chord) {
            e.preventDefault();
            events.keydown?.(chord, currentRange() ?? lastRange ?? { start: 0, end: 0 });
            return;
        }
        if (composing || e.isComposing) return;
        const range = currentRange();
        if (!range) return;
        const collapsed = range.start === range.end;
        // Deletes across the block edge belong to the core (a virtual keyboard sends no keydown).
        if ((type === 'deleteContentBackward' || type === 'deleteWordBackward' || type === 'deleteSoftLineBackward' || type === 'deleteHardLineBackward') && collapsed && range.start === 0) {
            if (boundary('Backspace', range)) e.preventDefault();
        } else if ((type === 'deleteContentForward' || type === 'deleteWordForward' || type === 'deleteSoftLineForward' || type === 'deleteHardLineForward') && collapsed && range.start === length()) {
            if (boundary('Delete', range)) e.preventDefault();
        }
    };

    const onInput = (e: Event): void => {
        if (readOnly || destroyed) return;
        const ie = e as InputEvent;
        if (ie.isComposing && !composing) {
            // Some browsers report composition input before `compositionstart` reached us.
            composing = true;
            events.compositionStart();
        }
        report();
    };

    const onCompositionStart = (): void => {
        if (readOnly || composing) return;
        composing = true;
        events.compositionStart();
    };

    const onCompositionEnd = (): void => {
        if (!composing) return;
        composing = false;
        const flat = readInline(host, init.schema);
        syncEmpty(flat);
        known = flat;
        events.compositionEnd(flat);
    };

    const onPaste = (e: ClipboardEvent): void => {
        if (readOnly) {
            e.preventDefault();
            return;
        }
        const data = e.clipboardData;
        if (!data) return;
        const flavours = readPasteData(data);
        const range = currentRange() ?? lastRange ?? { start: length(), end: length() };
        if (events.paste({ data: flavours, range })) e.preventDefault();
    };

    const onDrop = (e: Event): void => {
        e.preventDefault();
    };

    const onFocus = (): void => {
        if (pendingRange) {
            const r = pendingRange;
            pendingRange = null;
            applySelection(r);
        }
        events.focus();
    };

    const onBlur = (): void => {
        events.blur();
    };

    const onSelectionChange = (): void => {
        if (destroyed || readOnly) return;
        // Only the focused host reports: after keyboard focus moved to the editor
        // root (a block selection) the DOM range may still sit in this host, and
        // reporting it would turn the block selection back into a text one.
        if (d.activeElement !== host) return;
        const range = currentRange();
        if (!range) return;
        if (lastRange && lastRange.start === range.start && lastRange.end === range.end) return;
        lastRange = range;
        events.selection({ range, caret: surface.caretRect() });
    };

    host.addEventListener('keydown', onKeydown);
    host.addEventListener('beforeinput', onBeforeInput as EventListener);
    host.addEventListener('input', onInput);
    host.addEventListener('compositionstart', onCompositionStart);
    host.addEventListener('compositionend', onCompositionEnd);
    host.addEventListener('paste', onPaste);
    host.addEventListener('drop', onDrop);
    host.addEventListener('dragover', onDrop);
    host.addEventListener('focus', onFocus);
    host.addEventListener('blur', onBlur);
    const unwatch = watchSelection(d, onSelectionChange);

    // -- commands ----------------------------------------------------------

    const surface: DomInlineSurface = {
        host,
        key: init.key,
        setInline(flat) {
            // Compare with what the core knows, never with the live DOM: between
            // the browser's mutation and our `input` event a selection-only
            // transaction may push the (unchanged) content back.
            if (flatEquals(flat, known, init.schema)) return;
            const focused = d.activeElement === host || host.contains(d.activeElement);
            const range = focused ? currentRange() : null;
            known = flat;
            renderInline(host, flat, { atoms: opts.atoms, schema: init.schema });
            syncEmpty(flat);
            if (range) applySelection(range);
        },
        setAttrs(blockType, attrs) {
            host.setAttribute('data-block-type', blockType);
            void attrs;
        },
        setSelection(range) {
            if (!host.isConnected) {
                pendingRange = range;
                lastRange = range;
                return;
            }
            applySelection(range);
        },
        focus(target) {
            if (d.activeElement !== host) host.focus({ preventScroll: true });
            const len = length();
            let offset: number;
            if (!target) offset = lastRange?.start ?? len;
            else if ('edge' in target) offset = target.edge === 'start' ? 0 : len;
            else if ('offset' in target) offset = target.offset;
            else offset = surface.offsetAtX(target.line, target.x);
            surface.setSelection({ start: offset, end: offset });
        },
        blur() {
            if (d.activeElement === host) host.blur();
        },
        getFlat: () => readInline(host, init.schema),
        getSelection() {
            const r = currentRange();
            if (r) return r;
            return pendingRange ?? (d.activeElement === host ? lastRange : null);
        },
        caretRect(): CaretRect | null {
            const rect = clientCaret();
            if (!rect) return null;
            return relativeCaretRect(rect, opts.origin?.() ?? host);
        },
        offsetAtX(line, x) {
            const len = length();
            const h = host.getBoundingClientRect();
            if (h.width === 0 && h.height === 0) return line === 'first' ? 0 : len;
            const origin = (opts.origin?.() ?? host).getBoundingClientRect();
            const clientX = Math.min(Math.max(origin.left + x, h.left + 1), h.right - 1);
            const clientY = line === 'first' ? h.top + 2 : h.bottom - 2;
            const p = pointFromClient(d, clientX, clientY);
            if (!p || !host.contains(p.node)) return line === 'first' ? 0 : len;
            return pointToOffset(host, p.node, p.offset);
        },
        isComposing: () => composing,
        setReadOnly(next) {
            readOnly = next;
            host.setAttribute('contenteditable', next ? 'false' : 'true');
        },
        setPlaceholder(placeholder) {
            if (placeholder === undefined) host.removeAttribute('data-placeholder');
            else host.setAttribute('data-placeholder', placeholder);
        },
        destroy() {
            destroyed = true;
            unwatch();
            host.removeEventListener('keydown', onKeydown);
            host.removeEventListener('beforeinput', onBeforeInput as EventListener);
            host.removeEventListener('input', onInput);
            host.removeEventListener('compositionstart', onCompositionStart);
            host.removeEventListener('compositionend', onCompositionEnd);
            host.removeEventListener('paste', onPaste);
            host.removeEventListener('drop', onDrop);
            host.removeEventListener('dragover', onDrop);
            host.removeEventListener('focus', onFocus);
            host.removeEventListener('blur', onBlur);
        },
    };
    return surface;
}

/** Every text flavour on a clipboard payload: `text/plain` as `text`, the rest by MIME type (files skipped). */
export function readPasteData(data: DataTransfer): PasteData {
    const flavours: PasteData = { text: data.getData('text/plain') };
    for (const type of Array.from(data.types ?? [])) {
        if (type === 'text/plain' || type === 'Files') continue;
        const value = data.getData(type);
        if (value) flavours[type] = value;
    }
    return flavours;
}
