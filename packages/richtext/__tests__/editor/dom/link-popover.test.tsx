/**
 * The link popover on happy-dom: Mod-k and the toolbar open the URL form,
 * Enter applies and focus returns to the text, the caret in a link shows
 * the view bubble (URL, Edit, Remove), unsafe URLs never become an href.
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

async function mount(source: string) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    let controller!: RichTextEditorController;
    render(jsx(RichTextEditor, { format: markdownFormat, defaultSource: source, plugins: [markdownPreset], ref: (c: RichTextEditorController) => (controller = c) }) as never, container);
    await tick();
    const root = container.querySelector('[data-scope=richtext-editor][data-part=root]') as HTMLElement;
    const host = (key: string) => root.querySelector(`[data-part=inline][data-key="${key}"]`) as HTMLElement;
    /** Focus block b-0 and select [from, to) in it. */
    const select = async (from: number, to = from) => {
        const h = host('b-0');
        h.focus();
        const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
        const point = (offset: number): [Node, number] => {
            let left = offset;
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                const len = n.textContent!.length;
                if (left <= len) return [n, left];
                left -= len;
            }
            return [h, h.childNodes.length];
        };
        const a = point(from);
        walker.currentNode = h;
        const b = point(to);
        document.getSelection()!.setBaseAndExtent(a[0], a[1], b[0], b[1]);
        document.dispatchEvent(new Event('selectionchange'));
        await tick();
    };
    const mod = (key: string) => {
        const mac = controller.editor.platform.isMac;
        host('b-0').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...(mac ? { metaKey: true } : { ctrlKey: true }) }));
    };
    const popover = (mode: 'edit' | 'view') => root.querySelector(`[data-scope=richtext-link][data-mode=${mode}]`) as HTMLElement | null;
    return { root, host, controller, select, mod, popover, source: () => controller.getSource() };
}

describe('link popover', () => {
    it('Mod-k opens the form on the selection; Enter links it and focus returns to the text', async () => {
        const m = await mount('see docs');
        await m.select(4, 8);
        m.mod('k');
        await tick();
        const form = m.popover('edit')!;
        expect(form).toBeTruthy();
        const input = form.querySelector('[data-part=input]') as HTMLInputElement;
        expect(document.activeElement).toBe(input);
        expect(input.value).toBe('');
        input.value = 'https://x.dev';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await tick();
        expect(m.source()).toBe('see [docs](https://x.dev)\n');
        expect(m.popover('edit')).toBeNull();
        expect(document.activeElement).toBe(m.host('b-0'));
    });

    it('the caret in a link shows the view bubble; Edit opens the form prefilled and Escape cancels', async () => {
        const m = await mount('see [docs](https://x.dev "T") now');
        await m.select(6);
        const bubble = m.popover('view')!;
        expect(bubble).toBeTruthy();
        const a = bubble.querySelector('a[data-part=url]') as HTMLAnchorElement;
        expect(a.getAttribute('href')).toBe('https://x.dev');
        expect(a.getAttribute('target')).toBe('_blank');
        expect(a.getAttribute('rel')).toBe('noopener noreferrer');
        (bubble.querySelector('[data-part=edit]') as HTMLButtonElement).click();
        await tick();
        const input = m.popover('edit')!.querySelector('[data-part=input]') as HTMLInputElement;
        expect(input.value).toBe('https://x.dev');
        // Retarget keeps the title.
        input.value = 'https://y.dev';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await tick();
        expect(m.source()).toBe('see [docs](https://y.dev "T") now\n');
        await m.select(6);
        (m.popover('view')!.querySelector('[data-part=edit]') as HTMLButtonElement).click();
        await tick();
        (m.popover('edit')!.querySelector('[data-part=input]') as HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await tick();
        expect(m.popover('edit')).toBeNull();
        expect(m.source()).toBe('see [docs](https://y.dev "T") now\n');
        expect(document.activeElement).toBe(m.host('b-0'));
    });

    it('Remove, and an empty URL, unlink', async () => {
        const m = await mount('see [docs](https://x.dev) now');
        await m.select(6);
        (m.popover('view')!.querySelector('[data-part=remove]') as HTMLButtonElement).click();
        await tick();
        expect(m.source()).toBe('see docs now\n');
        const n = await mount('see [docs](https://x.dev) now');
        await n.select(6);
        n.mod('k');
        await tick();
        const input = n.popover('edit')!.querySelector('[data-part=input]') as HTMLInputElement;
        input.value = '  ';
        (n.popover('edit')!.querySelector('[data-part=apply]') as HTMLButtonElement).click();
        await tick();
        expect(n.source()).toBe('see docs now\n');
    });

    it('never turns an unsafe URL into an href', async () => {
        const m = await mount('a [x](javascript:alert(1)) b');
        await m.select(3);
        const a = m.popover('view')!.querySelector('a[data-part=url]') as HTMLAnchorElement;
        expect(a.hasAttribute('href')).toBe(false);
        expect(a.textContent).toBe('javascript:alert(1)');
    });

    it('the toolbar link item opens the form instead of inserting a placeholder', async () => {
        const m = await mount('see docs');
        await m.select(4, 8);
        (m.root.querySelector('[data-scope=richtext-toolbar] [data-item=link]') as HTMLButtonElement).click();
        await tick();
        expect(m.popover('edit')).toBeTruthy();
        expect(m.source()).toBe('see docs\n');
    });
});
