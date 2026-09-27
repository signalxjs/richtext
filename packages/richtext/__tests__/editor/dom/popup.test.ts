/**
 * `selectionBox`: the DOM selection's box in the root's coordinates, only when
 * both ends lie inside the root; the fallback (a surface caret) otherwise.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectionBox } from '../../../src/editor/dom/popup.js';

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

function setup() {
    const root = document.createElement('div');
    root.innerHTML = '<p>hello</p><p>world</p>';
    const outside = document.createElement('p');
    outside.textContent = 'outside';
    document.body.append(root, outside);
    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([
        { left: 10, top: 20, right: 40, bottom: 36, width: 30, height: 16 },
        { left: 0, top: 40, right: 20, bottom: 56, width: 20, height: 16 },
    ] as unknown as DOMRectList);
    return { root, outside, text: (i: number) => root.children[i].firstChild! };
}

describe('selectionBox', () => {
    it('boxes a selection inside the root, first line to last', () => {
        const { root, text } = setup();
        document.getSelection()!.setBaseAndExtent(text(0), 1, text(1), 3);
        expect(selectionBox(root)).toEqual({ left: 10, top: 20, bottom: 56 });
    });

    it('ignores a selection that leaves the root and uses the fallback', () => {
        const { root, outside, text } = setup();
        document.getSelection()!.setBaseAndExtent(text(0), 1, outside.firstChild!, 2);
        expect(selectionBox(root, () => ({ x: 5, y: 6, height: 7 }))).toEqual({ left: 5, top: 6, bottom: 13 });
        expect(selectionBox(root)).toBeNull();
    });
});
