/**
 * Multi-block mode — text selection across blocks on the web.
 *
 * Every text block is its own contenteditable host, and a browser never lets
 * a selection that starts in one editing host end in another. So while a
 * selection crosses a block boundary, the editor's content element becomes
 * the editing host (`contenteditable` on it, set imperatively) and the
 * browser paints one native selection over the blocks — the approach of the
 * WordPress block editor. The browser still never edits anything in this
 * mode: every key, input, paste and drop is routed to the core's range
 * commands, which answer with transactions like any other edit.
 *
 * Ways in: a drag that leaves the block it started in, Shift+Arrow at a
 * block edge, Shift+click on another block, and any `selectionchange` whose
 * ends land in different blocks (Firefox lets a drag cross hosts). Ways out:
 * the selection collapsing into one block (a command, an arrow, a click),
 * blur, read-only. The model is the source of truth: DOM selections are read
 * back into it (`domPointToModel`), and a cross-block model selection is
 * painted into the DOM (`paint`) after every transaction.
 */

import type { Command } from '../commands.js';
import { extendSelectionToNeighbour, insertText } from '../commands.js';
import { keyNames } from '../keys.js';
import { normalizeTextRange, orderedRange } from '../range.js';
import type { EditorState, Point, TextSelection } from '../state.js';
import { isCrossBlock, selectionEquals, textRange, textSelection } from '../state.js';
import type { EditorView } from './context.js';
import { hostLength, offsetToPoint, pointToOffset } from './inline-dom.js';
import { readPasteData } from './inline-surface.js';
import { caretClientRect, isForward, onEdgeLine, pointFromClient, relativeCaretRect, selectionFor } from './selection.js';

/** Native formatting and history inputs, as the chords the keymap answers. */
const INPUT_CHORDS: Record<string, string> = {
    formatBold: 'Mod-b',
    formatItalic: 'Mod-i',
    formatStrikeThrough: 'Mod-Shift-x',
    historyUndo: 'Mod-z',
    historyRedo: 'Mod-Shift-z',
};

export interface MultiSelection {
    /** The content element to toggle (the parent of every block); `null` on unmount. */
    attach(content: HTMLElement | null): void;
    /** Whether the content element is the editing host right now. */
    readonly active: boolean;
    /** Call from the editor listener after every transaction, before the blocks react. */
    sync(state: EditorState): void;
    /**
     * Bring the model up to the DOM selection now. `selectionchange` is
     * asynchronous: a key pressed right after a native Shift+Arrow must act
     * on the range the user sees. Called before handling any input in the mode.
     */
    refresh(): void;
    destroy(): void;
}

/**
 * The model point for a DOM point inside the editor's content. `side` says
 * which end of the range it is: a block that cannot hold a DOM caret (a code
 * block's textarea, a void block, the space between blocks) resolves to the
 * nearest editable block's start (`'start'`) or end (`'end'`).
 */
export function domPointToModel(view: EditorView, content: HTMLElement, node: Node, offset: number, side: 'start' | 'end'): Point | null {
    const { editor } = view;
    const state = editor.state;
    const index = state.index();
    const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
    if (!el || !content.contains(el)) return null;
    const host = el.closest('[data-part="inline"][data-key]');
    if (host && content.contains(host)) {
        const key = host.getAttribute('data-key')!;
        if (index.get(key)) return { key, offset: pointToOffset(host as HTMLElement, node, offset) };
    }
    const lengthOf = (key: string): number => editor.flatOf(key)?.text.length ?? (index.get(key)?.node as { value?: string } | undefined)?.value?.length ?? 0;
    const editable = (key: string): boolean => editor.schema.isEditable(index.get(key)?.node.type ?? '');
    const keys = index.keys();
    /** The first editable block at or after document position `i`, at offset 0 — or the last one before it, at its end. */
    const resolveFrom = (i: number, dir: 1 | -1): Point | null => {
        for (let j = i; j >= 0 && j < keys.length; j += dir) {
            if (editable(keys[j])) return { key: keys[j], offset: dir === 1 ? 0 : lengthOf(keys[j]) };
        }
        return null;
    };
    const toward = (i: number): Point | null => (side === 'start' ? resolveFrom(i, 1) ?? resolveFrom(i - 1, -1) : resolveFrom(i, -1) ?? resolveFrom(i + 1, 1));
    const keyed = el.closest('[data-key]');
    if (keyed && content.contains(keyed) && keyed !== content) {
        // Inside a block but not in a text host: a code block, a void block, a block's chrome.
        const key = keyed.getAttribute('data-key')!;
        const entry = index.get(key);
        if (!entry) return null;
        if (editable(key)) return { key, offset: side === 'start' ? 0 : lengthOf(key) };
        const at = index.position(key);
        // After the whole subtree when resolving an end.
        let last = at;
        while (last + 1 < keys.length && keys[last + 1].startsWith(key + '.')) last++;
        return side === 'start' ? resolveFrom(at, 1) ?? resolveFrom(at - 1, -1) : resolveFrom(last, -1) ?? resolveFrom(last + 1, 1);
    }
    // Between blocks: the child at `offset` (or the end of `node`).
    const container = node.nodeType === 1 ? (node as Element) : null;
    if (!container) return null;
    // The first keyed block at or after the child at `offset` (text, comments and renderer anchors skipped).
    let nextKeyed: Element | null = null;
    for (let n: Node | null = container.childNodes[offset] ?? null; n && !nextKeyed; n = n.nextSibling) {
        if (n.nodeType === 1) nextKeyed = (n as Element).matches('[data-key]') ? (n as Element) : (n as Element).querySelector('[data-key]');
    }
    if (nextKeyed) {
        const pos = index.position(nextKeyed.getAttribute('data-key')!);
        return side === 'start' ? resolveFrom(pos, 1) : resolveFrom(pos - 1, -1) ?? resolveFrom(pos, 1);
    }
    return toward(keys.length - 1);
}

/** Two text selections cover the same span, whichever way round. */
function sameSpan(state: EditorState, a: TextSelection, b: TextSelection): boolean {
    const x = orderedRange(state, a);
    const y = orderedRange(state, b);
    return x.from.key === y.from.key && x.from.offset === y.from.offset && x.to.key === y.to.key && x.to.offset === y.to.offset;
}

export function createMultiSelection(view: EditorView): MultiSelection {
    const { editor } = view;
    let content: HTMLElement | null = null;
    let active = false;
    /** A read-back is being dispatched: the DOM already shows the selection. */
    let reading = false;
    let paintQueued = false;
    let drag: { host: Element } | null = null;
    /** A pointerdown was handled (Shift+click): its mousedown must not place the caret either. */
    let swallowMouseDown = false;

    const doc = (): Document | null => content?.ownerDocument ?? null;

    /** Make the content the editing host. `focus`: move keyboard focus to it too, so a drag in progress continues across blocks. */
    function enter(focus = false): void {
        if (!content || active || view.readOnly()) return;
        active = true;
        content.contentEditable = 'true';
        content.setAttribute('data-multi', '');
        if (focus) content.focus({ preventScroll: true });
    }

    function exit(): void {
        if (!content || !active) return;
        active = false;
        content.removeAttribute('contenteditable');
        content.removeAttribute('data-multi');
    }

    /** A DOM point for one end of the model range: a caret in a text host, or before / after a block that holds none. */
    function domPoint(p: Point, side: 'start' | 'end'): { node: Node; offset: number } | null {
        const surface = view.surfaces.get(p.key) as { host?: HTMLElement; textarea?: HTMLTextAreaElement } | undefined;
        if (surface?.host) return offsetToPoint(surface.host, Math.max(0, Math.min(p.offset, hostLength(surface.host))));
        const el = surface?.textarea?.closest('[data-part="block"]') ?? content?.querySelector(`[data-part="block"][data-key="${p.key}"]`);
        if (!el?.parentNode) return null;
        const i = Array.prototype.indexOf.call(el.parentNode.childNodes, el) as number;
        return { node: el.parentNode, offset: side === 'start' ? i : i + 1 };
    }

    /** Draw the model's cross-block selection as the DOM selection (after the blocks re-rendered). */
    function paint(): void {
        paintQueued = false;
        const state = editor.state;
        const sel = state.selection;
        if (!content || !sel || sel.mode !== 'text' || !isCrossBlock(sel)) return;
        const { forward } = orderedRange(state, sel);
        const anchor = domPoint(sel.anchor, forward ? 'start' : 'end');
        const head = domPoint(sel.head, forward ? 'end' : 'start');
        const dom = selectionFor(content);
        if (!anchor || !head || !dom) return;
        const d = content.ownerDocument;
        if (active && !content.contains(d.activeElement)) content.focus({ preventScroll: true });
        dom.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
    }

    function schedulePaint(): void {
        if (paintQueued) return;
        paintQueued = true;
        queueMicrotask(paint);
    }

    /** The model selection the DOM selection shows, when it lies in the content. */
    function readDom(): TextSelection | null {
        if (!content) return null;
        const sel = selectionFor(content);
        if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null;
        if (!content.contains(sel.anchorNode) || !content.contains(sel.focusNode)) return null;
        const forward = isForward(sel);
        const a = domPointToModel(view, content, sel.anchorNode, sel.anchorOffset, forward ? 'start' : 'end');
        const h = domPointToModel(view, content, sel.focusNode, sel.focusOffset, forward ? 'end' : 'start');
        return a && h ? textRange(a, h) : null;
    }

    const onSelectionChange = (): void => {
        if (!content || editor.state.composing) return;
        const read = readDom();
        if (!read) return;
        // A selection inside one block belongs to that block's surface — unless it was ours.
        if (!isCrossBlock(read) && !active) return;
        const next = normalizeTextRange(editor.state, read, editor.ctx);
        const current = editor.state.selection;
        if (selectionEquals(next, current)) return;
        // The same range read backwards (some engines drop a selection's direction): nothing changed.
        if (current && current.mode === 'text' && sameSpan(editor.state, next, current)) return;
        // Normalisation may have moved an end (past a table): then the DOM needs repainting.
        reading = selectionEquals(next, read);
        editor.setSelection(next);
        reading = false;
    };

    const run = (command: Command | string): boolean => editor.run(command);

    /** Shift+Arrow at the edge of a focused text block: extend the range into the neighbour. */
    function extendFromEdge(e: KeyboardEvent): boolean {
        const target = e.target as Element | null;
        const host = target?.closest?.('[data-part="inline"][data-key]') as HTMLElement | null;
        if (!host || !content?.contains(host)) return false;
        const dom = selectionFor(host);
        if (!dom?.anchorNode || !dom.focusNode || !host.contains(dom.anchorNode) || !host.contains(dom.focusNode)) return false;
        const key = host.getAttribute('data-key')!;
        const anchor = pointToOffset(host, dom.anchorNode, dom.anchorOffset);
        const head = pointToOffset(host, dom.focusNode, dom.focusOffset);
        let dir: 'up' | 'down';
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            const edge = e.key === 'ArrowUp' ? 'first' : 'last';
            const caret = caretClientRect(host, { node: dom.focusNode, offset: dom.focusOffset });
            if (!onEdgeLine(host, caret, edge)) return false;
            const root = view.root();
            if (caret && root) view.goalX = relativeCaretRect(caret, root).x;
            dir = e.key === 'ArrowUp' ? 'up' : 'down';
        } else if (e.key === 'ArrowLeft' && head === 0) dir = 'up';
        else if (e.key === 'ArrowRight' && head === hostLength(host)) dir = 'down';
        else return false;
        const offsetAt = (k: string, edge: 'first' | 'last'): number => {
            const s = view.surfaces.get(k) as { offsetAtX?: (line: 'first' | 'last', x: number) => number } | undefined;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || view.goalX === undefined || !s?.offsetAtX) return edge === 'first' ? 0 : Number.MAX_SAFE_INTEGER;
            return s.offsetAtX(edge, view.goalX);
        };
        const from = { ...editor.state, selection: textRange({ key, offset: anchor }, { key, offset: head }) };
        return extendSelectionToNeighbour(dir, offsetAt)(from, editor.dispatch, editor.ctx);
    }

    const onKeydown = (e: KeyboardEvent): void => {
        if (view.readOnly()) return;
        const mod = e.ctrlKey || e.metaKey;
        if (!active) {
            const arrow = e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight';
            if (arrow && e.shiftKey && !mod && !e.altKey && !e.isComposing && extendFromEdge(e)) {
                e.preventDefault();
                e.stopPropagation();
            }
            return;
        }
        onSelectionChange();
        const state = editor.state;
        const sel = state.selection;
        if (!sel || sel.mode !== 'text' || !isCrossBlock(sel)) return;
        // The blocks' own surfaces never see a key in this mode: it is not theirs.
        e.stopPropagation();
        let handled: boolean;
        if (e.isComposing || e.keyCode === 229 || e.key === 'Process') {
            // An IME is starting: clear the range and let the composition begin in the start block.
            run('deleteRange');
            return;
        }
        switch (e.key) {
            case 'ArrowLeft':
            case 'ArrowUp':
            case 'ArrowRight':
            case 'ArrowDown': {
                if (e.shiftKey && !mod && !e.altKey) return; // the browser extends it; read back
                const { from, to } = orderedRange(state, sel);
                const at = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? from : to;
                editor.setSelection(textSelection(at.key, at.offset));
                handled = true;
                break;
            }
            case 'Tab':
                handled = true;
                break;
            default:
                if (!mod && !e.altKey && e.key.length === 1) {
                    handled = run(insertText(e.key));
                    break;
                }
                handled = false;
                for (const name of keyNames(e, editor.platform)) {
                    if (editor.runKey(name)) {
                        handled = true;
                        break;
                    }
                }
        }
        if (handled) e.preventDefault();
    };

    const onBeforeInput = (e: InputEvent): void => {
        if (!active) return;
        onSelectionChange();
        const type = e.inputType;
        const chord = INPUT_CHORDS[type];
        e.stopPropagation();
        if (type === 'insertCompositionText' && !e.cancelable) {
            run('deleteRange');
            return;
        }
        e.preventDefault();
        if (chord) editor.runKey(chord);
        else if (type === 'insertText' || type === 'insertReplacementText') {
            const text = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
            if (text) run(insertText(text));
        } else if (type.startsWith('delete')) run('deleteRange');
        else if (type === 'insertParagraph') editor.runKey('Enter');
        else if (type === 'insertLineBreak') editor.runKey('Shift-Enter');
    };

    const onPaste = (e: ClipboardEvent): void => {
        if (!active || !e.clipboardData) return;
        onSelectionChange();
        e.preventDefault();
        e.stopPropagation();
        editor.paste(readPasteData(e.clipboardData));
    };

    const refuse = (e: Event): void => {
        if (!active) return;
        e.preventDefault();
        e.stopPropagation();
    };

    const onPointerMove = (e: PointerEvent): void => {
        if (!drag || !content) return;
        if ((e.buttons & 1) === 0) {
            stopDrag();
            return;
        }
        const t = e.target as Node | null;
        if (!t || !content.contains(t) || drag.host.contains(t)) return;
        // The drag left the block it started in: let the selection follow across blocks.
        stopDrag();
        enter(true);
    };

    function stopDrag(): void {
        drag = null;
        const d = doc();
        d?.removeEventListener('pointermove', onPointerMove, true);
        d?.removeEventListener('pointerup', stopDrag, true);
    }

    const onPointerDown = (e: PointerEvent): void => {
        // A cancelled pointerdown may suppress its mousedown altogether: never let the flag outlive its click.
        swallowMouseDown = false;
        if (!content || e.button !== 0) return;
        const target = e.target as Element | null;
        if (e.shiftKey && !view.readOnly() && shiftClick(e)) {
            e.preventDefault();
            e.stopPropagation();
            swallowMouseDown = true;
            return;
        }
        // A plain click ends the mode before the browser places the caret.
        if (active) exit();
        const host = target?.closest?.('[data-part="inline"]');
        if (!host || !content.contains(host) || view.readOnly()) return;
        stopDrag();
        drag = { host };
        const d = content.ownerDocument;
        d.addEventListener('pointermove', onPointerMove, true);
        d.addEventListener('pointerup', stopDrag, true);
    };

    // Cancelling pointerdown does not stop a browser's mousedown default (caret placement, focus).
    const onMouseDown = (e: MouseEvent): void => {
        if (!swallowMouseDown) return;
        swallowMouseDown = false;
        e.preventDefault();
        e.stopPropagation();
    };

    /** Shift+click on another block extends the current text selection to the point clicked. */
    function shiftClick(e: PointerEvent): boolean {
        const state = editor.state;
        const sel = state.selection;
        if (!content || !sel || sel.mode !== 'text') return false;
        const p = pointFromClient(content.ownerDocument, e.clientX, e.clientY);
        if (!p) return false;
        const index = state.index();
        const probe = domPointToModel(view, content, p.node, p.offset, 'end');
        if (!probe || (probe.key === sel.anchor.key && !active)) return false;
        const side = index.position(probe.key) < index.position(sel.anchor.key) ? 'start' : 'end';
        const head = side === 'end' ? probe : domPointToModel(view, content, p.node, p.offset, 'start');
        if (!head) return false;
        editor.setSelection(normalizeTextRange(state, textRange(sel.anchor, head), editor.ctx));
        return true;
    }

    const onFocusOut = (e: FocusEvent): void => {
        if (!active || !content) return;
        const next = e.relatedTarget as Node | null;
        if (next && content.contains(next)) return;
        const root = view.root();
        if (next && root?.contains(next)) return;
        exit();
    };

    let unwatch: (() => void) | null = null;

    function listen(el: HTMLElement): void {
        el.addEventListener('keydown', onKeydown, true);
        el.addEventListener('beforeinput', onBeforeInput as EventListener, true);
        el.addEventListener('paste', onPaste, true);
        el.addEventListener('drop', refuse, true);
        el.addEventListener('dragstart', refuse, true);
        el.addEventListener('pointerdown', onPointerDown, true);
        el.addEventListener('mousedown', onMouseDown, true);
        el.addEventListener('focusout', onFocusOut);
        const d = el.ownerDocument;
        d.addEventListener('selectionchange', onSelectionChange);
        unwatch = () => {
            el.removeEventListener('keydown', onKeydown, true);
            el.removeEventListener('beforeinput', onBeforeInput as EventListener, true);
            el.removeEventListener('paste', onPaste, true);
            el.removeEventListener('drop', refuse, true);
            el.removeEventListener('dragstart', refuse, true);
            el.removeEventListener('pointerdown', onPointerDown, true);
            el.removeEventListener('mousedown', onMouseDown, true);
            el.removeEventListener('focusout', onFocusOut);
            d.removeEventListener('selectionchange', onSelectionChange);
        };
    }

    return {
        refresh: onSelectionChange,
        get active() {
            return active;
        },
        attach(el) {
            if (el === content) return;
            exit();
            stopDrag();
            unwatch?.();
            unwatch = null;
            content = el;
            if (el) listen(el);
        },
        sync(state) {
            const sel = state.selection;
            if (sel && sel.mode === 'text' && isCrossBlock(sel)) {
                if (view.readOnly()) return;
                if (!active && view.hasFocus()) enter();
                if (active && !reading) schedulePaint();
            } else if (active) exit();
        },
        destroy() {
            exit();
            stopDrag();
            unwatch?.();
            unwatch = null;
            content = null;
        },
    };
}
