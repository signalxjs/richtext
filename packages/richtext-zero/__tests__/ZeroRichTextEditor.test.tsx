/**
 * `<ZeroRichTextEditor>` on happy-dom: the view and format switches, the
 * source pane mirroring the document, the two-way `source` model, the
 * status bar, and the zero-drawn link popover, block menu and slash menu.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { jsx, signal } from 'sigx';
import { render } from '@sigx/runtime-dom';
import type { RichTextEditorController } from '@sigx/richtext/editor/dom';
import { createSlashPlugin, textSelection } from '@sigx/richtext/editor';
import { markdownPreset } from '@sigx/richtext-markdown/editor';
import { markdownFormat } from '@sigx/richtext-markdown';
import { htmlFormat } from '@sigx/richtext-html';
import { htmlPreset } from '@sigx/richtext-html/editor';
import { ZeroRichTextEditor } from '../src/index.js';

const containers: HTMLDivElement[] = [];
afterEach(() => {
    for (const c of containers.splice(0)) c.remove();
});
const tick = () => new Promise((r) => setTimeout(r, 0));

/** What a browser does for a keystroke in a contenteditable: `beforeinput`, the DOM edit, `input`. */
function typeIn(host: HTMLElement, text: string): void {
    const init = { bubbles: true, inputType: 'insertText', data: text };
    if (!host.dispatchEvent(new InputEvent('beforeinput', { ...init, cancelable: true }))) return;
    const sel = document.getSelection()!;
    const r = sel.getRangeAt(0);
    r.deleteContents();
    const node = document.createTextNode(text);
    r.insertNode(node);
    sel.collapse(node, text.length);
    host.dispatchEvent(new InputEvent('input', init));
}

async function mount(props: Record<string, unknown>) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    let controller!: RichTextEditorController;
    render(
        jsx(ZeroRichTextEditor, {
            format: markdownFormat,
            formats: [markdownFormat, htmlFormat],
            plugins: [markdownPreset, htmlPreset, createSlashPlugin()],
            onReady: (c: RichTextEditorController) => (controller = c),
            ...props,
        }) as never,
        container,
    );
    await tick();
    // `ready` fires on mount; the status bar renders on the next pass.
    await tick();
    const root = container.querySelector('[data-scope=richtext-zero][data-part=root]') as HTMLElement;
    const host = (key: string) => root.querySelector(`[data-part=inline][data-key="${key}"]`) as HTMLElement;
    const toggle = (group: string, value: string) => root.querySelector(`[data-scope=toggle-group][aria-label="${group}"] [data-value="${value}"], [data-scope=toggle-group][aria-label="${group}"] [value="${value}"]`) as HTMLElement | null;
    return {
        root,
        get controller() {
            return controller;
        },
        host,
        async pick(group: 'View' | 'Source format', label: string) {
            const items = Array.from(root.querySelectorAll(`[aria-label="${group}"] [data-scope=toggle-group][data-part=item]`)) as HTMLElement[];
            const item = items.find((el) => el.textContent?.trim() === label) ?? toggle(group, label);
            expect(item, `${group} ${label}`).toBeTruthy();
            item!.click();
            await tick();
        },
        source: () => root.querySelector('[data-scope=richtext-zero][data-part=source]') as HTMLElement | null,
        rich: () => root.querySelector('[data-scope=richtext-zero][data-part=rich]') as HTMLElement,
        status: () => root.querySelector('[data-scope=richtext-zero][data-part=status]') as HTMLElement,
    };
}

/** The source pane's text without the line-number gutter. */
function paneText(pane: HTMLElement): string {
    return Array.from(pane.querySelectorAll('[data-part=line]'))
        .map((line) => Array.from(line.querySelectorAll('[data-part=token]')).map((t) => t.textContent).join(''))
        .join('\n');
}

describe('ZeroRichTextEditor', () => {
    it('renders the editor with zero chrome: the view and format switches, the toolbar, the status bar', async () => {
        const m = await mount({ defaultSource: '# Hi\n\nSome **text** here.' });
        expect(m.root.getAttribute('data-view')).toBe('rich');
        expect(m.root.querySelectorAll('[data-scope=toggle-group][data-part=root]').length).toBe(2);
        expect(m.root.querySelector('[data-scope=richtext-toolbar] [data-scope=toggle]')).toBeTruthy();
        expect(m.source()).toBeNull();
        expect(m.status().querySelector('[data-status=words]')!.textContent).toBe('4 words');
        expect(m.status().querySelector('[data-status=format]')!.textContent).toBe('Markdown');
    });

    it('passes id, class and data attributes to its root', async () => {
        const m = await mount({ id: 'doc', class: 'wide', 'data-testid': 'zero' });
        expect(m.root.id).toBe('doc');
        expect(m.root.classList.contains('wide')).toBe(true);
        expect(m.root.getAttribute('data-testid')).toBe('zero');
        expect(m.root.getAttribute('data-scope')).toBe('richtext-zero');
    });

    it('split shows the markdown source beside the rich text; it round-trips the document', async () => {
        const source = '# Hi\n\n- one\n- two\n\n```ts\nconst a = 1;\n```\n';
        const m = await mount({ defaultSource: source });
        await m.pick('View', 'Split');
        expect(m.root.getAttribute('data-view')).toBe('split');
        const pane = m.source()!;
        expect(pane).toBeTruthy();
        expect(m.rich().hidden).toBe(false);
        expect(pane.getAttribute('data-format')).toBe('markdown');
        const shown = paneText(pane);
        expect(shown + '\n').toBe(m.controller.getSource());
        expect(markdownFormat.serialize(markdownFormat.parse(shown))).toBe(m.controller.getSource());
        expect(pane.querySelectorAll('[data-part=line-number]').length).toBe(shown.split('\n').length);
        expect(pane.querySelector('[data-kind=heading]')!.textContent).toBe('Hi');
    });

    it('the format switch shows HTML; source view hides the rich text', async () => {
        const m = await mount({ defaultSource: '# Hi\n\nA [link](https://x.dev).' });
        await m.pick('View', 'Source');
        expect(m.rich().hidden).toBe(true);
        await m.pick('Source format', 'HTML');
        const pane = m.source()!;
        expect(pane.getAttribute('data-format')).toBe('html');
        expect(paneText(pane)).toBe(m.controller.getSource('html').replace(/\n$/, ''));
        expect(pane.querySelector('[data-kind=tag]')!.textContent).toBe('<h1>');
        expect(m.status().querySelector('[data-status=format]')!.textContent).toBe('HTML');
    });

    it('the source pane follows edits', async () => {
        const m = await mount({ defaultSource: 'hello', defaultView: 'split' });
        m.host('b-0').focus();
        m.controller.editor.setSelection(textSelection('b-0', 0, 5));
        m.controller.run('toggleStrong');
        await tick();
        expect(paneText(m.source()!)).toBe('**hello**');
    });

    it('binds the source two-way', async () => {
        const note = signal({ md: 'first' });
        const m = await mount({ 'model:source': [note, 'md'] });
        expect(m.controller.getSource()).toBe('first\n');
        m.host('b-0').focus();
        m.controller.editor.setSelection(textSelection('b-0', 0, 5));
        m.controller.run('toggleEmphasis');
        await tick();
        expect(note.md).toBe('*first*\n');
        note.md = 'second';
        await tick();
        expect(m.controller.getSource()).toBe('second\n');
    });

    it('the status bar names the block type under the caret', async () => {
        const m = await mount({ defaultSource: '## Title\n\ntext' });
        m.host('b-0').focus();
        m.controller.editor.setSelection(textSelection('b-0', 1));
        await tick();
        expect(m.status().querySelector('[data-status=block]')!.textContent).toBe('Heading 2');
    });

    it('draws the link popover with a zero Input and Buttons', async () => {
        const m = await mount({ defaultSource: 'hello' });
        m.host('b-0').focus();
        m.controller.editor.setSelection(textSelection('b-0', 0, 5));
        await tick();
        (m.root.querySelector('[data-scope=richtext-toolbar] [data-item=link]') as HTMLButtonElement).click();
        await tick();
        await tick();
        const form = m.root.querySelector('[data-scope=richtext-link][data-mode=edit]') as HTMLElement;
        expect(form.querySelector('[data-scope=input][data-part=input]')).toBeTruthy();
        expect(form.querySelector('[data-scope=button]')!.textContent).toBe('Apply');
        const input = form.querySelector('input') as HTMLInputElement;
        expect(document.activeElement).toBe(input);
        input.value = 'https://example.com';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await tick();
        expect(m.controller.getSource()).toBe('[hello](https://example.com)\n');
    });

    it('draws the block menu items and the slash menu rows with icons', async () => {
        const m = await mount({ defaultSource: 'a\n\nb' });
        (m.root.querySelector('[data-part=block][data-key="b-1"] > [data-part=handle]') as HTMLButtonElement).click();
        await tick();
        const menu = m.root.querySelector('[data-scope=richtext-block-menu][role=menu]') as HTMLElement;
        const heading = menu.querySelector('[data-action="turn:heading"]') as HTMLElement;
        expect(heading.querySelector('svg[data-icon=heading]')).toBeTruthy();
        expect(heading.getAttribute('data-group')).toBe('turn');
        heading.click();
        await tick();
        expect(m.controller.getSource()).toBe('a\n\n# b\n');

    });

    it('draws the slash menu rows: an icon tile, the label, a description and the input rule as a Kbd', async () => {
        const m = await mount({ defaultSource: '' });
        const host = m.host('b-0');
        host.focus();
        document.getSelection()!.collapse(host, 0);
        typeIn(host, '/');
        await tick();
        const popup = m.root.querySelector('[data-scope=richtext-suggest][role=listbox]') as HTMLElement;
        expect(popup).toBeTruthy();
        const heading = Array.from(popup.querySelectorAll('[role=option]')).find((o) => o.querySelector('[data-part=item-label]')?.textContent === 'Heading') as HTMLElement;
        expect(heading.querySelector('svg[data-icon=heading]')).toBeTruthy();
        expect(heading.querySelector('[data-part=item-description]')!.textContent).toBe('Section heading');
        expect(heading.querySelector('[data-scope=kbd]')!.textContent).toBe('#');
    });
});
