/**
 * Small popup helpers shared by the block menu and the suggestion popup:
 * dismiss on an outside pointer-down or Escape, anchor-relative placement
 * inside the editor root, the box of the selection, and roving focus over
 * a list of items.
 */

import { rangeIn } from './selection.js';

/** Call `onDismiss` on a pointer-down outside `el` (and its anchor) or on Escape. Returns the disposer. */
export function onDismiss(el: HTMLElement, onDismissFn: () => void, anchor?: HTMLElement | null): () => void {
    const d = el.ownerDocument;
    const onPointerDown = (e: PointerEvent): void => {
        const target = e.target as Node | null;
        if (!target) return;
        if (el.contains(target) || (anchor && anchor.contains(target))) return;
        onDismissFn();
    };
    const onKeydown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onDismissFn();
        }
    };
    d.addEventListener('pointerdown', onPointerDown, true);
    d.addEventListener('keydown', onKeydown, true);
    return () => {
        d.removeEventListener('pointerdown', onPointerDown, true);
        d.removeEventListener('keydown', onKeydown, true);
    };
}

export interface AnchoredPosition {
    left: number;
    top: number;
}

/** Position a popup below (or above when there is no room) an anchor, in the coordinate space of `container` (which must be positioned). */
export function anchoredPosition(anchor: Element, container: Element, popupHeight: number, gap = 4): AnchoredPosition {
    const a = anchor.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    const viewportHeight = container.ownerDocument.defaultView?.innerHeight ?? Infinity;
    const below = a.bottom + gap;
    const fits = below + popupHeight <= viewportHeight || a.top - gap - popupHeight < 0;
    const top = fits ? below - c.top : a.top - gap - popupHeight - c.top;
    return { left: a.left - c.left, top };
}

/** Roving-focus keyboard handling for a vertical list of `[role=menuitem]` / `[role=option]` elements. Returns whether the key was handled. */
export function roveList(list: HTMLElement, e: KeyboardEvent, selector: string): boolean {
    const items = Array.from(list.querySelectorAll<HTMLElement>(selector)).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true');
    if (!items.length) return false;
    const active = list.ownerDocument.activeElement as HTMLElement | null;
    const index = active ? items.indexOf(active) : -1;
    let next: number | null = null;
    switch (e.key) {
        case 'ArrowDown':
            next = index < 0 ? 0 : (index + 1) % items.length;
            break;
        case 'ArrowUp':
            next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
            break;
        case 'Home':
            next = 0;
            break;
        case 'End':
            next = items.length - 1;
            break;
    }
    if (next === null) return false;
    e.preventDefault();
    items[next].focus();
    return true;
}

/** Where the current selection sits, in the coordinate space of `root` (which must be positioned). */
export interface SelectionBox {
    left: number;
    /** Top of the selection's first line. */
    top: number;
    /** Bottom of its last line. */
    bottom: number;
}

/**
 * The box of the DOM selection when it lies in `root` (a caret or a range, across
 * blocks too); `fallback` (a surface's caret rect, root-relative) otherwise.
 */
export function selectionBox(root: HTMLElement, fallback?: () => { x: number; y: number; height: number } | null): SelectionBox | null {
    const r = root.getBoundingClientRect();
    // Both ends inside the root (a drag out of the editor is not ours); composed ranges recover them in a shadow root.
    const ends = rangeIn(root);
    if (ends) {
        const range = root.ownerDocument.createRange();
        const forward = ends.startContainer === ends.endContainer ? ends.startOffset <= ends.endOffset : (ends.startContainer.compareDocumentPosition(ends.endContainer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        const [a, b] = forward ? [[ends.startContainer, ends.startOffset], [ends.endContainer, ends.endOffset]] : [[ends.endContainer, ends.endOffset], [ends.startContainer, ends.startOffset]];
        range.setStart(a[0] as Node, a[1] as number);
        range.setEnd(b[0] as Node, b[1] as number);
        const rects = Array.from(range.getClientRects()).filter((x) => x.width || x.height);
        const box = rects.length ? null : range.getBoundingClientRect();
        if (rects.length) return { left: rects[0].left - r.left, top: rects[0].top - r.top, bottom: rects[rects.length - 1].bottom - r.top };
        if (box && (box.width || box.height)) return { left: box.left - r.left, top: box.top - r.top, bottom: box.bottom - r.top };
    }
    const caret = fallback?.();
    return caret ? { left: caret.x, top: caret.y, bottom: caret.y + caret.height } : null;
}

