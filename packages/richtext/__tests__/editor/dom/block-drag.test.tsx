/**
 * Block drag and drop on happy-dom, with synthetic drag events: a handle's
 * dragstart selects its block, dragover shows the drop indicator at a gap,
 * drop moves the block; the block's own place, an unrelated drag and
 * read-only move nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsx } from 'sigx';
import { render } from '@sigx/runtime-dom';
import { RichTextEditor, type RichTextEditorController } from '../../../src/editor/dom/index.js';
import { markdownPreset } from '@sigx/richtext-markdown/editor';
import { markdownFormat } from '@sigx/richtext-markdown';

const containers: HTMLDivElement[] = [];
afterEach(() => {
    for (const c of containers.splice(0)) c.remove();
    vi.restoreAllMocks();
});

const tick = () => new Promise((r) => setTimeout(r, 0));

async function mount(source: string, props: Record<string, unknown> = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    let controller!: RichTextEditorController;
    render(jsx(RichTextEditor, { format: markdownFormat, defaultSource: source, plugins: [markdownPreset], ...props, ref: (c: RichTextEditorController) => (controller = c) }) as never, container);
    await tick();
    const root = container.querySelector('[data-scope=richtext-editor][data-part=root]') as HTMLElement;
    const wrapper = (key: string) => root.querySelector(`[data-part=block][data-key="${key}"]`) as HTMLElement;
    const fire = (el: Element, type: string, clientY = 0) => {
        const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
        Object.defineProperty(e, 'clientY', { value: clientY });
        Object.defineProperty(e, 'dataTransfer', { value: { effectAllowed: '', dropEffect: '', setData: vi.fn(), setDragImage: vi.fn() } });
        el.dispatchEvent(e);
        return e;
    };
    // happy-dom has no layout: give every block a 20px box stacked from the top.
    for (const [i, el] of Array.from(root.querySelectorAll('[data-part=block]')).entries()) {
        el.getBoundingClientRect = () => ({ top: i * 20, bottom: i * 20 + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: i * 20, toJSON() {} }) as DOMRect;
    }
    return { root, controller, wrapper, fire, handle: (key: string) => wrapper(key).querySelector(':scope > [data-part=handle]') as HTMLElement, source: () => controller.getSource() };
}

describe('block drag and drop', () => {
    it('drags a block after another; the indicator shows the gap while over it', async () => {
        const m = await mount('one\n\ntwo\n\nthree');
        const start = m.fire(m.handle('b-0'), 'dragstart');
        expect(start.defaultPrevented).toBe(false);
        expect(m.controller.editor.state.selection).toEqual({ mode: 'block', anchorKey: 'b-0', headKey: 'b-0' });
        // Lower half of "three": after it.
        const over = m.fire(m.wrapper('b-2').querySelector('[data-part=inline]')!, 'dragover', 55);
        expect(over.defaultPrevented).toBe(true);
        await tick();
        const line = m.root.querySelector('[data-part=drop-indicator]') as HTMLElement;
        expect(line.getAttribute('style')).toMatch(/top:\s*59px/);
        m.fire(m.wrapper('b-2'), 'drop', 55);
        await tick();
        expect(m.source()).toBe('two\n\nthree\n\none\n');
        expect(m.root.querySelector('[data-part=drop-indicator]')).toBeNull();
        expect(m.controller.editor.state.selection).toEqual({ mode: 'block', anchorKey: 'b-2', headKey: 'b-2' });
    });

    it('a dragleave bubbling from inside the content keeps the indicator (#77 review)', async () => {
        const m = await mount('one\n\ntwo\n\nthree');
        m.fire(m.handle('b-0'), 'dragstart');
        m.fire(m.wrapper('b-2'), 'dragover', 55);
        await tick();
        // Moving between children: the browser fires dragleave on the child, sometimes with no relatedTarget.
        m.fire(m.wrapper('b-2').querySelector('[data-part=inline]')!, 'dragleave');
        await tick();
        expect(m.root.querySelector('[data-part=drop-indicator]')).toBeTruthy();
        // Leaving the content itself clears it.
        m.fire(m.root.querySelector('[data-part=content]')!, 'dragleave');
        await tick();
        expect(m.root.querySelector('[data-part=drop-indicator]')).toBeNull();
    });

    it('the upper half of a block drops before it', async () => {
        const m = await mount('one\n\ntwo\n\nthree');
        m.fire(m.handle('b-2'), 'dragstart');
        m.fire(m.wrapper('b-0'), 'dragover', 5);
        m.fire(m.wrapper('b-0'), 'drop', 5);
        await tick();
        expect(m.source()).toBe('three\n\none\n\ntwo\n');
    });

    it('its own place is not a drop target, and nothing moves', async () => {
        const m = await mount('one\n\ntwo');
        m.fire(m.handle('b-0'), 'dragstart');
        const over = m.fire(m.wrapper('b-0'), 'dragover', 15);
        expect(over.defaultPrevented).toBe(false);
        m.fire(m.wrapper('b-0'), 'drop', 15);
        await tick();
        expect(m.source()).toBe('one\n\ntwo\n');
    });

    it('a drag that did not start on a handle is left alone', async () => {
        const m = await mount('one\n\ntwo');
        const over = m.fire(m.wrapper('b-1').querySelector('[data-part=inline]')!, 'dragover', 30);
        expect(over.defaultPrevented).toBe(true); // the text surface still refuses the drop itself
        expect(m.root.querySelector('[data-part=drop-indicator]')).toBeNull();
    });

    it('read-only refuses the drag', async () => {
        const m = await mount('one\n\ntwo', { readOnly: true });
        // No handles in read-only; a drag started programmatically is cancelled.
        expect(m.handle('b-0')).toBeNull();
    });
});
