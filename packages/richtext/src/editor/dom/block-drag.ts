/**
 * Block drag and drop — reorder blocks by dragging their handle.
 *
 * A drag starts on a block handle (`start`) and carries that block, or the
 * whole block selection when the block is part of one. While it is over the
 * content, the drop point is resolved to a gap between the dragged blocks'
 * siblings (before or after the sibling under the pointer, by its vertical
 * middle) and shown as the drop indicator; dropping runs `moveBlocksTo`.
 * The content listens in the capture phase and stops block drags there, so
 * the text surfaces (which refuse drops) never see them.
 */

import { signal } from '@sigx/reactivity';
import { moveBlocksTo, selectBlock, selectedBlockKeys } from '../commands.js';
import { blockSelection } from '../state.js';
import type { EditorView } from './context.js';

/** Where the indicator is drawn, in the editor root's coordinates. */
export interface DropIndicator {
    top: number;
    left: number;
    width: number;
}

export interface BlockDrag {
    /** The content element drops land on; `null` on unmount. */
    attach(content: HTMLElement | null): void;
    /** A handle's dragstart for block `key`. */
    start(key: string, e: DragEvent): void;
    /** The drop indicator to render, or null (reactive). */
    indicator(): DropIndicator | null;
    destroy(): void;
}

const MIME = 'application/x-richtext-blocks';

export function createBlockDrag(view: EditorView): BlockDrag {
    const { editor } = view;
    let current: DropIndicator | null = null;
    const rev = signal(0);
    let content: HTMLElement | null = null;
    let dragging: { keys: string[]; parentKey: string | null; first: number; last: number } | null = null;
    let target: number | null = null;

    const show = (next: DropIndicator | null): void => {
        const cur = current;
        if (cur === next || (cur && next && cur.top === next.top && cur.left === next.left && cur.width === next.width)) return;
        current = next;
        rev.value++;
    };

    const stop = (): void => {
        dragging = null;
        target = null;
        show(null);
    };

    /** The insertion index the pointer points at, with the sibling element it is measured against. */
    function resolve(e: DragEvent): { index: number; el: Element; before: boolean } | null {
        if (!dragging || !content) return null;
        const state = editor.state;
        const parent = dragging.parentKey === null ? state.doc : state.index().get(dragging.parentKey)?.node;
        const siblings = ((parent as { children?: { key?: string }[] } | undefined)?.children ?? []).map((c) => c.key!);
        if (!siblings.length) return null;
        const keys = new Set(siblings);
        let el = (e.target as Element | null)?.closest?.('[data-key]') ?? null;
        while (el && content.contains(el) && !keys.has(el.getAttribute('data-key')!)) el = el.parentElement?.closest('[data-key]') ?? null;
        let index: number;
        let before: boolean;
        if (el && content.contains(el)) {
            // Measure the block's outermost element (its wrapper), not an inner one that shares the key (the text host).
            el = content.querySelector(`[data-key="${el.getAttribute('data-key')}"]`) ?? el;
            const r = el.getBoundingClientRect();
            before = e.clientY < r.top + r.height / 2;
            index = siblings.indexOf(el.getAttribute('data-key')!) + (before ? 0 : 1);
        } else if (dragging.parentKey === null) {
            // Over the content's own padding (below the last block, above the first): the nearest end.
            const last = content.querySelector(`[data-key="${siblings[siblings.length - 1]}"]`);
            const firstEl = content.querySelector(`[data-key="${siblings[0]}"]`);
            if (!last || !firstEl) return null;
            before = e.clientY < firstEl.getBoundingClientRect().top;
            el = before ? firstEl : last;
            index = before ? 0 : siblings.length;
        } else return null;
        // The run's own place is no move.
        if (index >= dragging.first && index <= dragging.last + 1) return null;
        return { index, el, before };
    }

    const onDragOver = (e: DragEvent): void => {
        if (!dragging) return;
        e.stopPropagation();
        const hit = resolve(e);
        const root = view.root();
        if (!hit || !root) {
            target = null;
            show(null);
            return;
        }
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        target = hit.index;
        const r = hit.el.getBoundingClientRect();
        const o = root.getBoundingClientRect();
        show({ top: (hit.before ? r.top : r.bottom) - o.top, left: r.left - o.left, width: r.width });
    };

    const onDrop = (e: DragEvent): void => {
        if (!dragging) return;
        e.preventDefault();
        e.stopPropagation();
        const keys = dragging.keys;
        const index = target ?? resolve(e)?.index ?? null;
        stop();
        if (index === null) return;
        if (editor.run(moveBlocksTo(keys, index))) view.focusRoot();
    };

    const onDragLeave = (e: DragEvent): void => {
        // Only the content's own dragleave: one bubbling from a child fires on every move between
        // children, sometimes without a relatedTarget.
        if (!dragging || !content || e.target !== content) return;
        const next = e.relatedTarget as Node | null;
        if (next && content.contains(next)) return;
        target = null;
        show(null);
    };

    const onDragEnd = (): void => stop();

    function listen(el: HTMLElement): () => void {
        el.addEventListener('dragover', onDragOver, true);
        el.addEventListener('drop', onDrop, true);
        el.addEventListener('dragleave', onDragLeave, true);
        const d = el.ownerDocument;
        d.addEventListener('dragend', onDragEnd, true);
        return () => {
            el.removeEventListener('dragover', onDragOver, true);
            el.removeEventListener('drop', onDrop, true);
            el.removeEventListener('dragleave', onDragLeave, true);
            d.removeEventListener('dragend', onDragEnd, true);
        };
    }

    let unlisten: (() => void) | null = null;

    return {
        indicator: () => {
            void rev.value;
            return current;
        },
        attach(el) {
            if (el === content) return;
            unlisten?.();
            unlisten = null;
            stop();
            content = el;
            if (el) unlisten = listen(el);
        },
        start(key, e) {
            if (view.readOnly()) {
                e.preventDefault();
                return;
            }
            const state = editor.state;
            const entry = state.index().get(key);
            if (!entry) return;
            // The whole block selection when the dragged block is part of it; else the block alone.
            const selected = state.selection?.mode === 'block' ? selectedBlockKeys(state) : [];
            const keys = selected.includes(key) ? selected : [key];
            const entries = keys.map((k) => state.index().get(k)!);
            dragging = { keys, parentKey: entry.parentKey, first: entries[0].index, last: entries[entries.length - 1].index };
            if (!selected.includes(key)) editor.run(selectBlock(key));
            else editor.dispatch({ steps: [], selection: blockSelection(keys[0], keys[keys.length - 1]), meta: { origin: 'command', addToHistory: false } });
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData(MIME, keys.join(','));
                const wrapper = (e.currentTarget as Element | null)?.closest('[data-key]');
                if (wrapper && typeof e.dataTransfer.setDragImage === 'function') e.dataTransfer.setDragImage(wrapper, 0, 0);
            }
        },
        destroy() {
            unlisten?.();
            unlisten = null;
            stop();
            content = null;
        },
    };
}
