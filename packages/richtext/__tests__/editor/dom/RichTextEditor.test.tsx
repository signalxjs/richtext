/**
 * `<RichTextEditor>` on happy-dom: mounting, models, typing through the
 * contenteditable surfaces, split/join across blocks, undo, block selection,
 * the toolbar, the block menu, slash commands and mentions.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsx, signal } from 'sigx';
import { render } from '@sigx/runtime-dom';
import { RichTextEditor, createDomMentionPlugin, type RichTextEditorController, type ContainerView } from '../../../src/editor/dom/index.js';
import { createSlashPlugin, blockSelection, ATOM_CHAR, type EditorPlugin } from '../../../src/editor/index.js';
import { markdownPreset } from '@sigx/richtext-markdown/editor';
import { type Root } from '../../../src/index.js';
import { markdownFormat, mentionMarkdown } from '@sigx/richtext-markdown';
import { insertText, keydown } from './dom-driver.js';

const containers: HTMLDivElement[] = [];
afterEach(() => {
    for (const c of containers.splice(0)) c.remove();
    vi.restoreAllMocks();
});

const tick = () => new Promise((r) => setTimeout(r, 0));

interface Mounted {
    container: HTMLDivElement;
    root: HTMLElement;
    controller: RichTextEditorController;
    /** The inline host of block `key`. */
    host(key: string): HTMLElement;
}

async function mount(props: Record<string, unknown>): Promise<Mounted> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    let controller!: RichTextEditorController;
    const plugins = [markdownPreset, ...((props.plugins as EditorPlugin[] | undefined) ?? [])];
    render(jsx(RichTextEditor, { format: markdownFormat, ...props, plugins, ref: (c: RichTextEditorController) => (controller = c) }) as never, container);
    await tick();
    const root = container.querySelector('[data-scope=richtext-editor][data-part=root]') as HTMLElement;
    return {
        container,
        root,
        controller,
        host: (key) => root.querySelector(`[data-part=inline][data-key="${key}"]`) as HTMLElement,
    };
}

describe('RichTextEditor', () => {
    it('renders the document as editable blocks with the editor anatomy', async () => {
        const m = await mount({ defaultSource: '# Title\n\nSome **bold** text.\n\n- one\n- [ ] two\n\n```ts\nlet x\n```\n\n---\n\n> quote' });
        expect(m.root.getAttribute('data-mode')).toBe('text');
        const h = m.host('b-0');
        expect(h.tagName).toBe('H1');
        expect(h.getAttribute('contenteditable')).toBe('true');
        expect(h.textContent).toBe('Title');
        expect(m.host('b-1').innerHTML).toBe('Some <strong>bold</strong> text.');
        expect(m.root.querySelector('ul[data-part=list]')).toBeTruthy();
        expect(m.root.querySelectorAll('li[data-part=list-item]')).toHaveLength(2);
        expect(m.root.querySelector('li[data-task] input[type=checkbox]')).toBeTruthy();
        const code = m.root.querySelector('[data-part=code]') as HTMLElement;
        expect(code.getAttribute('data-lang')).toBe('ts');
        expect((code.querySelector('textarea') as HTMLTextAreaElement).value).toBe('let x');
        expect(m.root.querySelector('[data-part=void][data-type=thematicBreak] hr')).toBeTruthy();
        expect(m.root.querySelector('blockquote[data-part=blockquote] [data-part=inline]')!.textContent).toBe('quote');
        expect(m.root.querySelector('[data-scope=richtext-toolbar][role=toolbar]')).toBeTruthy();
        expect(m.root.querySelectorAll('[data-part=handle]').length).toBeGreaterThan(0);
        expect(m.controller.getSource()).toBe('# Title\n\nSome **bold** text.\n\n- one\n- [ ] two\n\n```ts\nlet x\n```\n\n---\n\n> quote\n');
    });

    it('typing updates the models and onChange without re-rendering the host', async () => {
        const state = signal({ md: 'hello' });
        const onChange = vi.fn();
        const m = await mount({ 'model:source': [state, 'md'], onChange });
        const host = m.host('b-0');
        host.focus();
        const sel = document.getSelection()!;
        sel.collapse(host.firstChild, 5);
        insertText({ host } as never, '!');
        await tick();
        expect(state.md).toBe('hello!\n');
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0].source).toBe('hello!\n');
        expect(onChange.mock.calls[0][0].document.children[0].type).toBe('paragraph');
        // The same host element is still in place (no remount).
        expect(m.host('b-0')).toBe(host);
        expect(host.textContent).toBe('hello!');
    });

    it('applies an external model write and ignores its own echo', async () => {
        const state = signal({ md: 'one' });
        const m = await mount({ 'model:source': [state, 'md'] });
        state.md = '# two';
        await tick();
        expect(m.host('b-0').tagName).toBe('H1');
        expect(m.host('b-0').textContent).toBe('two');
        expect(m.controller.editor.history.canUndo()).toBe(false);
    });

    it('Enter splits a block into a new focused block and Backspace at the start joins back', async () => {
        const m = await mount({ defaultSource: 'hello' });
        const host = m.host('b-0');
        host.focus();
        document.getSelection()!.collapse(host.firstChild, 2);
        expect(keydown({ host } as never, 'Enter')).toBe(false);
        await tick();
        expect(m.controller.getSource()).toBe('he\n\nllo\n');
        const second = m.host('b-1');
        expect(second).toBeTruthy();
        expect(second.textContent).toBe('llo');
        expect(document.activeElement).toBe(second);
        expect(m.controller.editor.state.selection).toEqual({ mode: 'text', anchor: { key: 'b-1', offset: 0 }, head: { key: 'b-1', offset: 0 } });
        document.getSelection()!.collapse(second.firstChild, 0);
        expect(keydown({ host: second } as never, 'Backspace')).toBe(false);
        await tick();
        expect(m.controller.getSource()).toBe('hello\n');
        expect(m.host('b-1')).toBeNull();
        expect(document.activeElement).toBe(m.host('b-0'));
    });

    it('input rules convert "# " into a heading and the surface follows', async () => {
        const m = await mount({ defaultSource: '' });
        const host = m.host('b-0');
        host.focus();
        document.getSelection()!.collapse(host, 0);
        insertText({ host } as never, '#');
        insertText({ host: m.host('b-0') } as never, ' ');
        await tick();
        expect(m.controller.editor.state.doc.children[0].type).toBe('heading');
        const h = m.host('b-0');
        expect(h.tagName).toBe('H1');
        expect(h.textContent).toBe('');
        expect(document.activeElement).toBe(h);
    });

    it('undo restores the previous content in the surface', async () => {
        const m = await mount({ defaultSource: 'ab' });
        const host = m.host('b-0');
        host.focus();
        document.getSelection()!.collapse(host.firstChild, 2);
        insertText({ host } as never, 'c');
        await tick();
        expect(host.textContent).toBe('abc');
        expect(keydown({ host } as never, 'z', { metaKey: !m.controller.editor.platform.isMac ? false : true, ctrlKey: !m.controller.editor.platform.isMac })).toBe(false);
        await tick();
        expect(host.textContent).toBe('ab');
        expect(m.controller.getSource()).toBe('ab\n');
    });

    it('Escape selects the block, the root takes focus, Backspace deletes it', async () => {
        const m = await mount({ defaultSource: 'a\n\nb' });
        const host = m.host('b-1');
        host.focus();
        document.getSelection()!.collapse(host.firstChild, 1);
        keydown({ host } as never, 'Escape');
        await tick();
        expect(m.root.getAttribute('data-mode')).toBe('block');
        expect(m.root.querySelector('[data-part=block][data-key="b-1"]')!.hasAttribute('data-selected')).toBe(true);
        expect(document.activeElement).toBe(m.root);
        expect(m.root.querySelector('[data-part=live]')!.textContent).toBe('1 block selected');
        // A late selectionchange from the blurred surface must not turn the block selection back into text.
        document.getSelection()!.collapse(host.firstChild, 1);
        await tick();
        expect(m.root.getAttribute('data-mode')).toBe('block');
        m.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
        await tick();
        expect(m.controller.getSource()).toBe('a\n');
    });

    it('the toolbar reflects the selection and runs commands', async () => {
        const m = await mount({ defaultSource: 'text' });
        const host = m.host('b-0');
        host.focus();
        document.getSelection()!.collapse(host.firstChild, 0);
        await tick();
        // Roving tabindex: exactly one enabled button is in the tab order, and focusing another moves the stop.
        const stops = () => Array.from(m.root.querySelectorAll('[data-scope=richtext-toolbar] button[tabindex="0"]')).map((b) => b.getAttribute('data-item'));
        expect(stops()).toEqual(['bold']);
        const h1 = m.root.querySelector('[data-scope=richtext-toolbar] [data-item=h1]') as HTMLButtonElement;
        h1.focus();
        await tick();
        expect(stops()).toEqual(['h1']);
        host.focus();
        document.getSelection()!.collapse(host.firstChild, 0);
        await tick();
        expect(h1.getAttribute('data-state')).toBe('off');
        h1.click();
        await tick();
        expect(m.host('b-0').tagName).toBe('H1');
        expect((m.root.querySelector('[data-item=h1]') as HTMLButtonElement).getAttribute('data-state')).toBe('on');
        expect(m.controller.getSource()).toBe('# text\n');
    });

    it('the block handle opens a menu that turns, moves and deletes the block', async () => {
        const m = await mount({ defaultSource: 'a\n\nb' });
        const handle = m.root.querySelector('[data-part=block][data-key="b-1"] > [data-part=handle]') as HTMLButtonElement;
        handle.click();
        await tick();
        const menu = m.root.querySelector('[data-scope=richtext-block-menu][role=menu]') as HTMLElement;
        expect(menu).toBeTruthy();
        expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
        (menu.querySelector('[data-action=moveUp]') as HTMLButtonElement).click();
        await tick();
        expect(m.controller.getSource()).toBe('b\n\na\n');
        expect(m.root.querySelector('[data-scope=richtext-block-menu]')).toBeNull();
        (m.root.querySelector('[data-part=block][data-key="b-0"] > [data-part=handle]') as HTMLButtonElement).click();
        await tick();
        (m.root.querySelector('[data-action="turn:heading"]') as HTMLButtonElement).click();
        await tick();
        expect(m.controller.getSource()).toBe('# b\n\na\n');
        (m.root.querySelector('[data-part=block][data-key="b-0"] > [data-part=handle]') as HTMLButtonElement).click();
        await tick();
        (m.root.querySelector('[data-action=delete]') as HTMLButtonElement).click();
        await tick();
        expect(m.controller.getSource()).toBe('a\n');
    });

    it('slash commands open a popup, filter by query and turn the block on Enter', async () => {
        const m = await mount({ defaultSource: '', plugins: [createSlashPlugin()] });
        const host = m.host('b-0');
        host.focus();
        document.getSelection()!.collapse(host, 0);
        insertText({ host } as never, '/');
        await tick();
        let popup = m.root.querySelector('[data-scope=richtext-suggest][role=listbox]') as HTMLElement;
        expect(popup).toBeTruthy();
        expect(popup.querySelectorAll('[role=option]').length).toBeGreaterThan(3);
        insertText({ host } as never, 'quo');
        await tick();
        popup = m.root.querySelector('[data-scope=richtext-suggest][role=listbox]') as HTMLElement;
        const options = popup.querySelectorAll('[role=option]');
        expect(options).toHaveLength(1);
        expect(options[0].textContent).toBe('Quote');
        expect(options[0].getAttribute('aria-selected')).toBe('true');
        // Enter is intercepted by the editor root (capture) before the surface sees it.
        host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await tick();
        expect(m.root.querySelector('[data-scope=richtext-suggest]')).toBeNull();
        expect(m.controller.editor.state.doc.children[0].type).toBe('blockquote');
        expect(m.controller.getSource()).toBe('>\n');
    });

    it('mentions: @ opens suggestions and a pick inserts a chip that serializes', async () => {
        const plugin = createDomMentionPlugin({ onQuery: (q) => [{ id: 'u1', label: 'Andy' }, { id: 'u2', label: 'Bea' }].filter((u) => u.label.toLowerCase().startsWith(q.toLowerCase())), formats: { markdown: mentionMarkdown } });
        const m = await mount({ defaultSource: 'hi', plugins: [plugin] });
        const host = m.host('b-0');
        host.focus();
        document.getSelection()!.collapse(host.firstChild, 2);
        insertText({ host } as never, ' ');
        insertText({ host } as never, '@');
        insertText({ host } as never, 'b');
        await tick();
        const popup = m.root.querySelector('[data-scope=richtext-suggest][role=listbox]') as HTMLElement;
        expect(popup.querySelectorAll('[role=option]')).toHaveLength(1);
        (popup.querySelector('[role=option]') as HTMLElement).click();
        await tick();
        expect(m.controller.getSource()).toBe('hi @[Bea](u2)\n');
        const chip = m.host('b-0').querySelector('[data-atom=mention]') as HTMLElement;
        expect(chip.textContent).toBe('@Bea');
        expect(chip.getAttribute('contenteditable')).toBe('false');
        expect(m.controller.editor.flatOf('b-0')!.text).toBe(`hi ${ATOM_CHAR} `);
    });

    it('mentions: an @ inside inline code opens no suggestions (#17)', async () => {
        const onQuery = vi.fn(() => [{ id: 'u1', label: 'Andy' }]);
        const plugin = createDomMentionPlugin({ onQuery, formats: { markdown: mentionMarkdown } });
        const m = await mount({ defaultSource: 'see `@`', plugins: [plugin] });
        const host = m.host('b-0');
        host.focus();
        document.getSelection()!.collapse(host, host.childNodes.length);
        insertText({ host } as never, 'a');
        await tick();
        expect(m.controller.editor.flatOf('b-0')!.text).toBe('see @a');
        expect(m.root.querySelector('[data-scope=richtext-suggest]')).toBeNull();
        expect(onQuery).not.toHaveBeenCalled();
    });

    it('readOnly disables editing and hides handles', async () => {
        const m = await mount({ defaultSource: 'x', readOnly: true });
        expect(m.host('b-0').getAttribute('contenteditable')).toBe('false');
        expect(m.root.hasAttribute('data-readonly')).toBe(true);
        expect(m.root.querySelector('[data-part=handle]')).toBeNull();
        expect((m.root.querySelector('[data-item=bold]') as HTMLButtonElement).disabled).toBe(true);
    });

    it('exposes a controller that sets, reads and clears the document', async () => {
        const m = await mount({ defaultSource: 'x' });
        m.controller.setSource('a\n\nb');
        await tick();
        expect(m.host('b-1').textContent).toBe('b');
        const doc: Root = { type: 'root', children: [{ type: 'heading', depth: 2, children: [{ type: 'text', value: 'H' }] }] };
        m.controller.setDocument(doc);
        await tick();
        expect(m.host('b-0').tagName).toBe('H2');
        expect(doc.children[0].key).toBeUndefined();
        m.controller.clear();
        await tick();
        expect(m.controller.getSource()).toBe('');
        expect(m.host('b-0').hasAttribute('data-empty')).toBe(true);
    });

    it('reads and writes source in an installed format by id', async () => {
        const m = await mount({ defaultSource: '# a' });
        expect(m.controller.getSource('markdown')).toBe('# a\n');
        expect(() => m.controller.getSource('nope')).toThrow(/No format "nope"/);
        m.controller.setSource('**b**', 'markdown');
        await tick();
        expect(m.host('b-0').innerHTML).toBe('<strong>b</strong>');
    });

    it('copies a block selection as every flavour the presets write', async () => {
        const m = await mount({ defaultSource: 'a\n\nb' });
        m.controller.editor.dispatch({ steps: [], selection: blockSelection('b-0'), meta: { origin: 'command' } });
        await tick();
        const setData = vi.fn();
        const e = new Event('copy', { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'clipboardData', { value: { setData } });
        m.root.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(true);
        expect(setData.mock.calls).toEqual(expect.arrayContaining([['text/plain', 'a\n'], ['text/markdown', 'a\n']]));
    });

    it('copies a nested block selection with the parent it needs (#58)', async () => {
        const m = await mount({ defaultSource: '- a\n- b' });
        m.controller.editor.dispatch({ steps: [], selection: blockSelection('b-0.1'), meta: { origin: 'command' } });
        await tick();
        const setData = vi.fn();
        const e = new Event('copy', { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'clipboardData', { value: { setData } });
        m.root.dispatchEvent(e);
        expect(setData.mock.calls).toEqual(expect.arrayContaining([['text/plain', '- b\n']]));
    });

    it('pastes over a block selection (#58)', async () => {
        const m = await mount({ defaultSource: 'a\n\nb\n\nc' });
        m.controller.editor.dispatch({ steps: [], selection: blockSelection('b-1'), meta: { origin: 'command' } });
        await tick();
        const e = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'clipboardData', { value: { types: ['text/plain'], getData: (t: string) => (t === 'text/plain' ? '# x' : '') } });
        m.root.dispatchEvent(e);
        await tick();
        expect(e.defaultPrevented).toBe(true);
        expect(m.controller.getSource()).toBe('a\n\n# x\n\nc\n');
    });

    it('labels void blocks by their menu entry and falls back to the type', async () => {
        const m = await mount({ defaultSource: '---\n\n[x]: /u' });
        expect(m.root.querySelector('[data-part=void][data-type=thematicBreak]')!.getAttribute('aria-label')).toBe('Divider');
        expect(m.root.querySelector('[data-part=void][data-type=definition]')!.getAttribute('aria-label')).toBe('definition');
    });

    it('renders a plugin container through its container view, else as a plain container', async () => {
        const doc: Root = { type: 'root', children: [{ type: 'callout', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'hi' }] }] } as never] };
        const nodes = [{ type: 'callout', role: 'container', fillsWith: 'paragraph' } as const];
        const plain = await mount({ defaultDocument: doc, plugins: [{ name: 'callout', nodes }] });
        expect(plain.root.querySelector('[data-part=block][data-type=callout] > [data-part=container][data-type=callout] [data-part=inline]')!.textContent).toBe('hi');
        const callout: ContainerView = ({ children, wrapperAttrs, handle }) => jsx('aside', { ...wrapperAttrs, 'data-callout': '', children: [handle, ...children] }) as never;
        const custom = await mount({ defaultDocument: doc, plugins: [{ name: 'callout', nodes, editor: { dom: { containers: { callout } } } }] });
        const aside = custom.root.querySelector('aside[data-part=block][data-type=callout][data-callout]')!;
        expect(aside.querySelector('[data-part=handle]')).toBeTruthy();
        expect(aside.querySelector('[data-part=inline]')!.textContent).toBe('hi');
        // The `containers` prop wins over the plugin's view.
        const over = await mount({ defaultDocument: doc, plugins: [{ name: 'callout', nodes, editor: { dom: { containers: { callout } } } }], containers: { callout: (({ children, wrapperAttrs }) => jsx('section', { ...wrapperAttrs, children }) as never) as ContainerView } });
        expect(over.root.querySelector('section[data-part=block][data-type=callout]')).toBeTruthy();
    });
});
