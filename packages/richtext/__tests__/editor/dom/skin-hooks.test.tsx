/**
 * The skin hooks on happy-dom: `renderToolbarItem` / `renderToolbarGroup`
 * draw both toolbars while the core keeps the roving tab stop and the
 * caret; `renderLinkPopover` draws the popover's body while the core keeps
 * Enter / Escape and `sanitizeUrl`; `renderBlockMenuItem` draws menu items.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsx } from 'sigx';
import { render } from '@sigx/runtime-dom';
import { RichTextEditor, type BlockMenuRenderItem, type LinkPopoverInfo, type LinkPopoverRender, type RichTextEditorController, type ToolbarItemInfo, type ToolbarRenderGroup, type ToolbarRenderItem } from '../../../src/editor/dom/index.js';
import { textSelection } from '../../../src/editor/index.js';
import { markdownPreset } from '@sigx/richtext-markdown/editor';
import { markdownFormat } from '@sigx/richtext-markdown';

const containers: HTMLDivElement[] = [];
afterEach(() => {
    for (const c of containers.splice(0)) c.remove();
    vi.restoreAllMocks();
});

const tick = () => new Promise((r) => setTimeout(r, 0));

async function mount(source: string, props: Record<string, unknown>) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    let controller!: RichTextEditorController;
    render(jsx(RichTextEditor, { format: markdownFormat, defaultSource: source, plugins: [markdownPreset], ...props, ref: (c: RichTextEditorController) => (controller = c) }) as never, container);
    await tick();
    const root = container.querySelector('[data-scope=richtext-editor][data-part=root]') as HTMLElement;
    const host = (key: string) => root.querySelector(`[data-part=inline][data-key="${key}"]`) as HTMLElement;
    return {
        root,
        controller,
        host,
        async select(from: number, to = from) {
            host('b-0').focus();
            controller.editor.setSelection(textSelection('b-0', from, to));
            await tick();
        },
        mod(key: string) {
            const mac = controller.editor.platform.isMac;
            host('b-0').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...(mac ? { metaKey: true } : { ctrlKey: true }) }));
        },
        bar: () => root.querySelector('[data-scope=richtext-toolbar][role=toolbar]') as HTMLElement,
    };
}

/** A skin item: an icon-only button that spreads the core's attrs. */
const seen: Record<string, ToolbarItemInfo> = {};
const skinItem: ToolbarRenderItem = (item, info) => {
    seen[item.id] = info;
    return jsx('button', { ...info.attrs, type: 'button', 'data-skin': '', 'aria-label': item.label, 'aria-pressed': item.isActive ? String(info.active) : undefined, onClick: info.run, children: jsx('i', { 'data-glyph': item.icon }) }) as never;
};

describe('renderToolbarItem', () => {
    it('hands the item its enabled / active state and the attrs, and runs on the selection', async () => {
        const m = await mount('hello world', { renderToolbarItem: skinItem });
        await m.select(0, 5);
        const bold = m.bar().querySelector('[data-item=bold]') as HTMLButtonElement;
        expect(bold.hasAttribute('data-skin')).toBe(true);
        expect(bold.querySelector('[data-glyph=bold]')).toBeTruthy();
        expect(bold.getAttribute('data-scope')).toBe('richtext-toolbar');
        expect(bold.getAttribute('data-part')).toBe('item');
        expect(seen.bold.enabled).toBe(true);
        expect(seen.bold.active).toBe(false);
        expect(seen.redo.enabled).toBe(false);
        expect((m.bar().querySelector('[data-item=redo]') as HTMLButtonElement).disabled).toBe(true);
        const down = new Event('pointerdown', { bubbles: true, cancelable: true });
        bold.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(true);
        bold.click();
        await tick();
        expect(m.controller.getSource()).toBe('**hello** world\n');
        expect(seen.bold.active).toBe(true);
        expect(m.bar().querySelector('[data-item=bold]')!.getAttribute('aria-pressed')).toBe('true');
        expect(m.bar().querySelector('[data-item=bold]')!.getAttribute('data-state')).toBe('on');
    });

    it('keeps one roving tab stop, and the arrow keys move across skin buttons', async () => {
        const m = await mount('hello', { renderToolbarItem: skinItem });
        await m.select(0, 5);
        const stops = Array.from(m.bar().querySelectorAll<HTMLButtonElement>('[data-item]')).filter((b) => b.tabIndex === 0);
        expect(stops.map((b) => b.getAttribute('data-item'))).toEqual(['bold']);
        stops[0].focus();
        stops[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        expect(document.activeElement?.getAttribute('data-item')).toBe('italic');
        await tick();
        expect((m.bar().querySelector('[data-item=italic]') as HTMLButtonElement).tabIndex).toBe(0);
        expect((m.bar().querySelector('[data-item=bold]') as HTMLButtonElement).tabIndex).toBe(-1);
    });

    it('draws the floating toolbar too', async () => {
        const m = await mount('hello', { renderToolbarItem: skinItem, floatingToolbar: true, toolbar: false });
        await m.select(0, 5);
        const bubble = m.root.querySelector('[data-scope=richtext-editor][data-part=bubble]')!;
        expect(bubble.querySelectorAll('[data-skin]').length).toBe(5);
    });
});

describe('renderToolbarGroup', () => {
    it('wraps each group; the skin can add separators between them', async () => {
        const groups: string[] = [];
        const renderGroup: ToolbarRenderGroup = (group, children) => {
            groups.push(`${group.index}/${group.count}:${group.name}`);
            return jsx('span', {
                ...group.attrs,
                'data-skin-group': '',
                children: [...children, group.index < group.count - 1 ? jsx('hr', { 'data-sep': '' }) : null],
            }) as never;
        };
        const m = await mount('hello', { renderToolbarGroup: renderGroup, toolbarLabel: 'Format text' });
        await m.select(0, 5);
        const bar = m.bar();
        expect(bar.getAttribute('aria-label')).toBe('Format text');
        const wrappers = Array.from(bar.querySelectorAll('[data-skin-group]'));
        expect(wrappers.map((w) => w.getAttribute('data-group'))).toEqual(['inline', 'block', 'insert', 'history']);
        expect(wrappers.every((w) => w.getAttribute('data-part') === 'group')).toBe(true);
        expect(bar.querySelectorAll('[data-sep]').length).toBe(3);
        expect(groups.slice(-4)).toEqual(['0/4:inline', '1/4:block', '2/4:insert', '3/4:history']);
        // The default items still render inside the skin's groups.
        (bar.querySelector('[data-item=italic]') as HTMLButtonElement).click();
        await tick();
        expect(m.controller.getSource()).toBe('*hello*\n');
    });
});

describe('renderLinkPopover', () => {
    let last: LinkPopoverInfo | null = null;
    // The field drops `ref` — as a design-system input might — so the popover must find it itself.
    const skinLink: LinkPopoverRender = (info) => {
        last = info;
        const { ref: _ref, ...input } = info.inputAttrs;
        if (info.mode === 'edit') {
            return jsx('div', {
                'data-skin-form': '',
                children: [jsx('input', { ...input }), jsx('button', { type: 'button', 'data-skin-apply': '', onClick: () => info.apply() })],
            }) as never;
        }
        return jsx('div', {
            'data-skin-view': '',
            children: [jsx('a', { href: info.href, children: info.link?.url }), jsx('button', { type: 'button', ...info.buttonAttrs, 'data-skin-remove': '', onClick: info.remove })],
        }) as never;
    };

    it('draws the form; Enter in the field applies through the core, the input is focused', async () => {
        const m = await mount('hello', { renderLinkPopover: skinLink });
        await m.select(0, 5);
        m.mod('k');
        await tick();
        await tick();
        const form = m.root.querySelector('[data-scope=richtext-link][data-mode=edit] [data-skin-form]')!;
        expect(form).toBeTruthy();
        const input = form.querySelector('input') as HTMLInputElement;
        expect(document.activeElement).toBe(input);
        input.value = 'https://example.com';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await tick();
        expect(m.controller.getSource()).toBe('[hello](https://example.com)\n');
    });

    it('apply(url) goes through the core, and the view never links an unsafe URL', async () => {
        const m = await mount('hello', { renderLinkPopover: skinLink });
        await m.select(0, 5);
        m.mod('k');
        await tick();
        last!.apply('javascript:alert(1)');
        await tick();
        await m.select(2);
        const view = m.root.querySelector('[data-scope=richtext-link][data-mode=view] [data-skin-view]')!;
        expect(view).toBeTruthy();
        expect(last!.mode).toBe('view');
        expect(last!.href).toBeUndefined();
        expect(view.querySelector('a')!.hasAttribute('href')).toBe(false);
        const remove = view.querySelector('[data-skin-remove]') as HTMLButtonElement;
        const down = new Event('pointerdown', { bubbles: true, cancelable: true });
        remove.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(true);
        remove.click();
        await tick();
        expect(m.controller.getSource()).toBe('hello\n');
    });
});

describe('renderBlockMenuItem', () => {
    it('draws the items; the menu keeps focus and runs them', async () => {
        const groups = new Set<string>();
        const renderItem: BlockMenuRenderItem = (item, info) => {
            groups.add(item.group);
            return jsx('button', { ...info.attrs, 'data-skin-item': '', children: [jsx('i', { 'data-glyph': item.icon }), item.label] }) as never;
        };
        const m = await mount('a\n\nb', { renderBlockMenuItem: renderItem });
        (m.root.querySelector('[data-part=block][data-key="b-1"] > [data-part=handle]') as HTMLButtonElement).click();
        await tick();
        const menu = m.root.querySelector('[data-scope=richtext-block-menu][role=menu]') as HTMLElement;
        expect(menu.querySelectorAll('[data-skin-item][role=menuitem]').length).toBeGreaterThan(4);
        expect(groups).toEqual(new Set(['turn', 'block']));
        expect(document.activeElement?.hasAttribute('data-skin-item')).toBe(true);
        (menu.querySelector('[data-action=moveUp]') as HTMLButtonElement).click();
        await tick();
        expect(m.controller.getSource()).toBe('b\n\na\n');
    });
});
