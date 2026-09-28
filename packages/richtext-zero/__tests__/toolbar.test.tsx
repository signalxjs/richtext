/**
 * The zero toolbar on happy-dom: items render as zero parts (Toggle for
 * stateful items, Button for actions, Select for the block type) inside the
 * core's toolbar root, keep the core's roving tab stop and the caret, and
 * follow the editor's state.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { jsx } from 'sigx';
import { render } from '@sigx/runtime-dom';
import { RichTextEditor, type RichTextEditorController } from '@sigx/richtext/editor/dom';
import { defaultToolbarItems, textSelection } from '@sigx/richtext/editor';
import { markdownPreset } from '@sigx/richtext-markdown/editor';
import { markdownFormat } from '@sigx/richtext-markdown';
import { hasIcon, renderZeroToolbarGroup, renderZeroToolbarItem, zeroToolbarItems } from '../src/index.js';

const containers: HTMLDivElement[] = [];
afterEach(() => {
    for (const c of containers.splice(0)) c.remove();
});
const tick = () => new Promise((r) => setTimeout(r, 0));

async function mount(source: string, props: Record<string, unknown> = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    let controller!: RichTextEditorController;
    render(
        jsx(RichTextEditor, {
            format: markdownFormat,
            defaultSource: source,
            plugins: [markdownPreset],
            toolbarItems: zeroToolbarItems(),
            renderToolbarItem: renderZeroToolbarItem,
            renderToolbarGroup: renderZeroToolbarGroup,
            ...props,
            ref: (c: RichTextEditorController) => (controller = c),
        }) as never,
        container,
    );
    await tick();
    const root = container.querySelector('[data-scope=richtext-editor][data-part=root]') as HTMLElement;
    const host = (key: string) => root.querySelector(`[data-part=inline][data-key="${key}"]`) as HTMLElement;
    const bar = () => root.querySelector('[data-scope=richtext-toolbar][role=toolbar]') as HTMLElement;
    return {
        root,
        controller,
        bar,
        async select(from: number, to = from) {
            host('b-0').focus();
            controller.editor.setSelection(textSelection('b-0', from, to));
            await tick();
        },
        item: (id: string) => bar().querySelector(`[data-item="${id}"]`) as HTMLButtonElement,
    };
}

describe('zeroToolbarItems', () => {
    it('is the design order: history, block type, marks, lists, blocks', () => {
        const items = zeroToolbarItems();
        expect(items.map((i) => i.id)).toEqual(['undo', 'redo', 'blockType', 'bold', 'italic', 'strike', 'code', 'link', 'bullet', 'ordered', 'task', 'quote', 'hr', 'table']);
        expect([...new Set(items.map((i) => i.group))]).toEqual(['history', 'type', 'inline', 'lists', 'blocks']);
    });

    it('has a glyph for every default item and schema menu icon', () => {
        for (const item of defaultToolbarItems) expect(hasIcon(item.icon), item.id).toBe(true);
        for (const name of ['heading', 'pilcrow', 'quote', 'list', 'code', 'minus', 'table', 'arrow-up', 'arrow-down', 'copy', 'trash', 'mention', 'more']) expect(hasIcon(name), name).toBe(true);
    });
});

describe('renderZeroToolbarItem', () => {
    it('draws stateful items as zero Toggles, actions as Buttons, the block type as a Select', async () => {
        const m = await mount('hello world');
        await m.select(0, 5);
        const bold = m.item('bold');
        expect(bold.tagName).toBe('BUTTON');
        expect(bold.getAttribute('data-scope')).toBe('toggle');
        expect(bold.getAttribute('data-part')).toBe('root');
        expect(bold.getAttribute('aria-label')).toBe('Bold');
        expect(bold.hasAttribute('role')).toBe(false);
        expect(bold.querySelector('svg[data-icon=bold]')).toBeTruthy();
        expect(m.item('undo').getAttribute('data-scope')).toBe('button');
        expect(m.item('hr').getAttribute('data-scope')).toBe('button');
        const type = m.item('blockType');
        expect(type.getAttribute('data-scope')).toBe('select');
        expect(type.getAttribute('data-part')).toBe('trigger');
        expect(type.textContent).toContain('Text');
    });

    it('aria-pressed follows isActive; a press keeps the caret and runs on the selection', async () => {
        const m = await mount('hello world');
        await m.select(0, 5);
        expect(m.item('bold').getAttribute('aria-pressed')).toBe('false');
        const down = new Event('pointerdown', { bubbles: true, cancelable: true });
        m.item('bold').dispatchEvent(down);
        expect(down.defaultPrevented).toBe(true);
        m.item('bold').click();
        await tick();
        expect(m.controller.getSource()).toBe('**hello** world\n');
        expect(m.item('bold').getAttribute('aria-pressed')).toBe('true');
        expect(m.item('bold').getAttribute('data-state')).toBe('on');
        const sel = m.controller.editor.state.selection;
        expect(sel?.mode === 'text' && [sel.anchor.offset, sel.head.offset]).toEqual([0, 5]);
        m.item('bold').click();
        await tick();
        expect(m.controller.getSource()).toBe('hello world\n');
        expect(m.item('bold').getAttribute('aria-pressed')).toBe('false');
    });

    it('disabled items are disabled; action buttons run', async () => {
        const m = await mount('hello');
        await m.select(0, 5);
        expect(m.item('redo').disabled).toBe(true);
        expect(m.item('undo').disabled).toBe(true);
        m.item('italic').click();
        await tick();
        expect(m.item('undo').disabled).toBe(false);
        m.item('undo').click();
        await tick();
        expect(m.controller.getSource()).toBe('hello\n');
    });

    it('keeps one roving tab stop and the arrow keys move across the zero buttons', async () => {
        const m = await mount('hello');
        await m.select(0, 5);
        const stops = Array.from(m.bar().querySelectorAll<HTMLButtonElement>('button[data-item]')).filter((b) => b.getAttribute('tabindex') === '0');
        // Undo and redo are disabled: the block-type select is the first enabled item.
        expect(stops.map((b) => b.getAttribute('data-item'))).toEqual(['blockType']);
        stops[0].focus();
        stops[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        expect(document.activeElement?.getAttribute('data-item')).toBe('bold');
        (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        expect(document.activeElement?.getAttribute('data-item')).toBe('italic');
        await tick();
        expect(m.item('italic').getAttribute('tabindex')).toBe('0');
        expect(m.item('blockType').getAttribute('tabindex')).toBe('-1');
    });

    it('names the shortcut in a tooltip with Kbd keys', async () => {
        const m = await mount('hello');
        await m.select(0, 5);
        const tip = m.bar().querySelector('[data-scope=tooltip][data-part=popup]') as HTMLElement;
        expect(tip).toBeTruthy();
        const tips = Array.from(m.bar().querySelectorAll('[data-scope=tooltip][data-part=popup]')).map((t) => t.textContent);
        expect(tips).toContain(m.controller.editor.platform.isMac ? 'Bold ⌘B' : 'Bold CtrlB');
        expect(m.bar().querySelectorAll('[data-scope=kbd]').length).toBeGreaterThan(5);
        expect(m.item('bold').getAttribute('aria-keyshortcuts')).toMatch(/B$/);
    });

    it('the block-type select sets the block type', async () => {
        const m = await mount('hello');
        await m.select(0, 2);
        const option = m.bar().querySelector('[data-scope=select][data-part=item][id$="option-h2"]') as HTMLElement;
        expect(option).toBeTruthy();
        option.click();
        await tick();
        expect(m.controller.getSource()).toBe('## hello\n');
        expect(m.item('blockType').textContent).toContain('Heading 2');
    });
});

describe('renderZeroToolbarGroup', () => {
    it('labels each group and separates them', async () => {
        const m = await mount('hello');
        const groups = Array.from(m.bar().querySelectorAll('[data-scope=richtext-toolbar][data-part=group]'));
        expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['History', 'Block type', 'Text formatting', 'Lists', 'Insert']);
        expect(m.bar().querySelectorAll('[data-scope=richtext-zero][data-part=separator]').length).toBe(4);
    });
});
