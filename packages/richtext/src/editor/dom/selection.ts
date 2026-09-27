/**
 * DOM selection helpers shared by the surfaces: reading the selection that
 * applies to a host (document or shadow root), caret rectangles, and the
 * first/last visual line tests behind ArrowUp/ArrowDown boundaries.
 */

import type { CaretRect } from '../surface.js';

interface SelectionRootLike {
    getSelection?(): Selection | null;
}

/** The `Selection` that covers `host`: the shadow root's own where the browser exposes one, else the document's. */
export function selectionFor(host: Element): Selection | null {
    const root = host.getRootNode() as Node & SelectionRootLike;
    if (root !== host.ownerDocument && typeof root.getSelection === 'function') {
        const s = root.getSelection();
        if (s) return s;
    }
    return host.ownerDocument.getSelection();
}

export interface DomRangeLike {
    startContainer: Node;
    startOffset: number;
    endContainer: Node;
    endOffset: number;
}

/**
 * The current selection's range when it lies inside `host`, else `null`.
 * Inside a shadow root Safari and Firefox report the shadow host as the
 * selection's node; `getComposedRanges` recovers the real endpoints there.
 */
export function rangeIn(host: Element): DomRangeLike | null {
    const sel = selectionFor(host);
    if (!sel || sel.rangeCount === 0) return null;
    let anchorNode: Node | null = sel.anchorNode;
    let anchorOffset = sel.anchorOffset;
    let focusNode: Node | null = sel.focusNode;
    let focusOffset = sel.focusOffset;
    const root = host.getRootNode();
    const composed = (sel as Selection & { getComposedRanges?: (...roots: ShadowRoot[]) => StaticRange[] }).getComposedRanges;
    if (anchorNode && !host.contains(anchorNode) && root instanceof ShadowRoot && typeof composed === 'function') {
        const [r] = composed.call(sel, root);
        if (!r) return null;
        anchorNode = r.startContainer;
        anchorOffset = r.startOffset;
        focusNode = r.endContainer;
        focusOffset = r.endOffset;
    }
    if (!anchorNode || !focusNode) return null;
    if (!host.contains(anchorNode) || !host.contains(focusNode)) return null;
    return { startContainer: anchorNode, startOffset: anchorOffset, endContainer: focusNode, endOffset: focusOffset };
}

/** Whether the anchor is before (or at) the focus in document order. */
export function isForward(sel: Selection): boolean {
    if (!sel.anchorNode || !sel.focusNode) return true;
    if (sel.anchorNode === sel.focusNode) return sel.anchorOffset <= sel.focusOffset;
    const pos = sel.anchorNode.compareDocumentPosition(sel.focusNode);
    return (pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** Place the selection at DOM points inside `host`. */
export function setDomSelection(host: Element, anchor: { node: Node; offset: number }, focus: { node: Node; offset: number }): void {
    const sel = selectionFor(host);
    if (!sel) return;
    if (typeof sel.setBaseAndExtent === 'function') {
        sel.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
        return;
    }
    const range = host.ownerDocument.createRange();
    range.setStart(anchor.node, anchor.offset);
    range.setEnd(focus.node, focus.offset);
    sel.removeAllRanges();
    sel.addRange(range);
}

/** The client rectangle of a collapsed DOM point (the caret). Falls back to the nearest element's rect. */
export function caretClientRect(host: Element, point: { node: Node; offset: number }): DOMRect | null {
    const d = host.ownerDocument;
    const range = d.createRange();
    try {
        range.setStart(point.node, point.offset);
        range.setEnd(point.node, point.offset);
    } catch {
        return null;
    }
    const rects = range.getClientRects();
    if (rects.length) return rects[0];
    // An element point (before/after a chip, an empty host): use the neighbouring node's rect.
    const el = point.node.nodeType === 1 ? (point.node as Element) : point.node.parentElement;
    if (!el) return null;
    const kids = point.node.nodeType === 1 ? Array.from(point.node.childNodes) : [];
    const after = kids[point.offset];
    const before = kids[point.offset - 1];
    const ref = (before ?? after) as Node | undefined;
    if (ref && ref.nodeType === 1) {
        const r = (ref as Element).getBoundingClientRect();
        return before ? new DOMRect(r.right, r.top, 0, r.height) : new DOMRect(r.left, r.top, 0, r.height);
    }
    const r = el.getBoundingClientRect();
    return new DOMRect(r.left, r.top, 0, r.height);
}

/** A caret rect relative to `origin` (the editor root or the block). */
export function relativeCaretRect(rect: DOMRect, origin: Element): CaretRect {
    const o = origin.getBoundingClientRect();
    return { x: rect.left - o.left, y: rect.top - o.top, height: rect.height };
}

/**
 * Whether a caret rect sits on the first / last visual line of `host` (true when geometry is unavailable).
 * Measured against the content's own line boxes, not the host's box: a host taller than its text
 * (padding, a min-height, a table cell stretched by its row) would otherwise hide the edge.
 */
export function onEdgeLine(host: Element, caret: DOMRect | null, edge: 'first' | 'last'): boolean {
    if (!caret) return true;
    const h = host.getBoundingClientRect();
    if (h.height === 0 && caret.height === 0) return true;
    const range = host.ownerDocument.createRange();
    range.selectNodeContents(host);
    const lines = Array.from(range.getClientRects()).filter((r) => r.height > 0);
    // An empty host is one line.
    if (!lines.length) return true;
    const top = Math.min(...lines.map((r) => r.top));
    const bottom = Math.max(...lines.map((r) => r.bottom));
    const tolerance = Math.max(2, caret.height / 2);
    return edge === 'first' ? caret.top - top < tolerance : bottom - caret.bottom < tolerance;
}

/** The DOM point under client coordinates, when the browser can tell. */
export function pointFromClient(d: Document, x: number, y: number): { node: Node; offset: number } | null {
    const doc = d as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    if (typeof doc.caretPositionFromPoint === 'function') {
        const p = doc.caretPositionFromPoint(x, y);
        return p ? { node: p.offsetNode, offset: p.offset } : null;
    }
    if (typeof doc.caretRangeFromPoint === 'function') {
        const r = doc.caretRangeFromPoint(x, y);
        return r ? { node: r.startContainer, offset: r.startOffset } : null;
    }
    return null;
}
