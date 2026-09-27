/**
 * The floating toolbar on happy-dom: it shows over a non-collapsed text
 * selection (one block or across blocks) while the editor has focus, runs
 * its items against the selection, and stays away for a caret, a code
 * block, read-only, the link popover and when the prop is off.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsx } from 'sigx';
import { render } from '@sigx/runtime-dom';
import { RichTextEditor, type RichTextEditorController } from '../../../src/editor/dom/index.js';
import { textRange, textSelection, type EditorSelection } from '../../../src/editor/index.js';
import { markdownPreset } from '@sigx/richtext-markdown/editor';
import { markdownFormat } from '@sigx/richtext-markdown';

const containers: HTMLDivElement[] = [];
afterEach(() => {
    for (const c of containers.splice(0)) c.remove();
    vi.restoreAllMocks();
});

const tick = () => new Promise((r) => setTimeout(r, 0));

async function mount(source: string, props: Record<string, unknown> = { floatingToolbar: true }) {
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
        async select(sel: EditorSelection) {
            host('b-0').focus();
            controller.editor.setSelection(sel);
            await tick();
        },
        bubble: () => root.querySelector('[data-scope=richtext-editor][data-part=bubble]') as HTMLElement | null,
        source: () => controller.getSource(),
    };
}

describe('floating toolbar', () => {
    it('shows the inline items over a selection and runs them on it', async () => {
        const m = await mount('hello world');
        await m.select(textSelection('b-0', 0, 5));
        const bubble = m.bubble()!;
        expect(bubble).toBeTruthy();
        const bar = bubble.querySelector('[data-scope=richtext-toolbar][role=toolbar]')!;
        expect(bar.getAttribute('aria-label')).toBe('Selection formatting');
        expect(Array.from(bar.querySelectorAll('[data-item]')).map((b) => b.getAttribute('data-item'))).toEqual(['bold', 'italic', 'strike', 'code', 'link']);
        (bar.querySelector('[data-item=bold]') as HTMLButtonElement).click();
        await tick();
        expect(m.source()).toBe('**hello** world\n');
        expect(m.bubble()!.querySelector('[data-item=bold]')!.getAttribute('data-state')).toBe('on');
    });

    it('shows over a range across blocks too', async () => {
        const m = await mount('hello\n\nworld');
        await m.select(textRange({ key: 'b-0', offset: 2 }, { key: 'b-1', offset: 3 }));
        (m.bubble()!.querySelector('[data-item=italic]') as HTMLButtonElement).click();
        await tick();
        expect(m.source()).toBe('he*llo*\n\n*wor*ld\n');
    });

    it('stays away for a caret, a code block, read-only, and when off', async () => {
        const m = await mount('hello');
        await m.select(textSelection('b-0', 2));
        expect(m.bubble()).toBeNull();
        const code = await mount('```\ncode\n```\n\ntext');
        code.controller.editor.setSelection(textSelection('b-0', 0, 2));
        await tick();
        expect(code.bubble()).toBeNull();
        const ro = await mount('hello', { floatingToolbar: true, readOnly: true });
        await ro.select(textSelection('b-0', 0, 5));
        expect(ro.bubble()).toBeNull();
        const off = await mount('hello', {});
        await off.select(textSelection('b-0', 0, 5));
        expect(off.bubble()).toBeNull();
    });

    it('the link item opens the link popover, which replaces the bubble', async () => {
        const m = await mount('hello world');
        await m.select(textSelection('b-0', 0, 5));
        (m.bubble()!.querySelector('[data-item=link]') as HTMLButtonElement).click();
        await tick();
        expect(m.root.querySelector('[data-scope=richtext-link][data-mode=edit]')).toBeTruthy();
        expect(m.bubble()).toBeNull();
    });

    it('takes custom items', async () => {
        const m = await mount('hello', { floatingToolbar: [{ id: 'shout', label: '!', run: (tc: { run(c: unknown): boolean }) => void tc }] });
        await m.select(textSelection('b-0', 0, 5));
        expect(Array.from(m.bubble()!.querySelectorAll('[data-item]')).map((b) => b.getAttribute('data-item'))).toEqual(['shout']);
    });
});
