/**
 * Multi-block mode on happy-dom: a text range across blocks makes the content
 * element the editing host, paints the range into the DOM, reads DOM ranges
 * back, and routes keys, paste, copy and cut to the core's range commands.
 * Real drags and native Shift+Arrow extension are covered by the playground e2e.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { component, jsx, signal } from 'sigx';
import { render } from '@sigx/runtime-dom';
import { RichTextEditor, type RichTextEditorController } from '../../../src/editor/dom/index.js';
import { domPointToModel } from '../../../src/editor/dom/multi-selection.js';
import type { EditorView } from '../../../src/editor/dom/context.js';
import { textRange, textSelection, type EditorSelection, type Point } from '../../../src/editor/index.js';
import { markdownPreset } from '@sigx/richtext-markdown/editor';
import { markdownFormat } from '@sigx/richtext-markdown';

const containers: HTMLDivElement[] = [];
afterEach(() => {
    for (const c of containers.splice(0)) c.remove();
    vi.restoreAllMocks();
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const pt = (key: string, offset: number): Point => ({ key, offset });

interface Mounted {
    root: HTMLElement;
    content: HTMLElement;
    controller: RichTextEditorController;
    host(key: string): HTMLElement;
    source(): string;
    select(sel: EditorSelection): Promise<void>;
    key(key: string, init?: KeyboardEventInit): KeyboardEvent;
}

async function mount(source: string, props: Record<string, unknown> = {}): Promise<Mounted> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    let controller!: RichTextEditorController;
    render(jsx(RichTextEditor, { format: markdownFormat, defaultSource: source, plugins: [markdownPreset], ...props, ref: (c: RichTextEditorController) => (controller = c) }) as never, container);
    await tick();
    const root = container.querySelector('[data-scope=richtext-editor][data-part=root]') as HTMLElement;
    const content = root.querySelector('[data-part=content]') as HTMLElement;
    const host = (key: string) => root.querySelector(`[data-part=inline][data-key="${key}"]`) as HTMLElement;
    return {
        root,
        content,
        controller,
        host,
        source: () => controller.getSource(),
        async select(sel) {
            host('b-0').focus();
            controller.editor.setSelection(sel);
            await tick();
        },
        key(key, init = {}) {
            const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
            (document.activeElement ?? content).dispatchEvent(e);
            return e;
        },
    };
}

const range = (a: Point, h: Point) => textRange(a, h);
const HW = range(pt('b-0', 2), pt('b-1', 3));

describe('multi-block mode', () => {
    it('makes the content the editing host for a cross-block range and paints it', async () => {
        const m = await mount('hello\n\nworld');
        expect(m.content.hasAttribute('contenteditable')).toBe(false);
        await m.select(HW);
        expect(m.content.getAttribute('contenteditable')).toBe('true');
        expect(m.content.hasAttribute('data-multi')).toBe(true);
        const dom = document.getSelection()!;
        expect(m.host('b-0').contains(dom.anchorNode)).toBe(true);
        expect(dom.anchorOffset).toBe(2);
        expect(m.host('b-1').contains(dom.focusNode)).toBe(true);
        expect(dom.focusOffset).toBe(3);
    });

    it('Backspace deletes the range and leaves the mode with the caret at its start', async () => {
        const m = await mount('hello\n\nworld');
        await m.select(HW);
        const e = m.key('Backspace');
        await tick();
        expect(e.defaultPrevented).toBe(true);
        expect(m.source()).toBe('held\n');
        expect(m.content.hasAttribute('contenteditable')).toBe(false);
        expect(m.controller.editor.state.selection).toEqual(textSelection('b-0', 2));
        expect(document.activeElement).toBe(m.host('b-0'));
    });

    it('a printable key types over the range; one undo restores it', async () => {
        const m = await mount('hello\n\nworld');
        await m.select(HW);
        m.key('X');
        await tick();
        expect(m.source()).toBe('heXld\n');
        m.controller.undo();
        await tick();
        expect(m.source()).toBe('hello\n\nworld\n');
    });

    it('Enter splits over the range', async () => {
        const m = await mount('hello\n\nworld');
        await m.select(HW);
        m.key('Enter');
        await tick();
        expect(m.source()).toBe('he\n\nld\n');
    });

    it('chords reach the keymap: Mod-b bolds every segment and the mode stays', async () => {
        const m = await mount('hello\n\nworld');
        await m.select(HW);
        const mac = m.controller.editor.platform.isMac;
        m.key('b', mac ? { metaKey: true } : { ctrlKey: true });
        await tick();
        expect(m.source()).toBe('he**llo**\n\n**wor**ld\n');
        expect(m.content.getAttribute('contenteditable')).toBe('true');
        // Copy is left to the browser's copy event.
        expect(m.key('c', mac ? { metaKey: true } : { ctrlKey: true }).defaultPrevented).toBe(false);
    });

    it('plain arrows collapse the range to an end; Shift+arrows are left to the browser', async () => {
        const m = await mount('hello\n\nworld');
        await m.select(HW);
        expect(m.key('ArrowDown', { shiftKey: true }).defaultPrevented).toBe(false);
        m.key('ArrowRight');
        await tick();
        expect(m.controller.editor.state.selection).toEqual(textSelection('b-1', 3));
        expect(m.content.hasAttribute('contenteditable')).toBe(false);
    });

    it('paste replaces the range', async () => {
        const m = await mount('hello\n\nworld');
        await m.select(HW);
        const e = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'clipboardData', { value: { types: ['text/plain'], getData: (t: string) => (t === 'text/plain' ? 'x\n\ny' : '') } });
        m.host('b-0').dispatchEvent(e);
        await tick();
        expect(e.defaultPrevented).toBe(true);
        expect(m.source()).toBe('hex\n\nyld\n');
    });

    it('copy writes every flavour of the range; cut also removes it', async () => {
        const m = await mount('hello\n\nworld');
        await m.select(HW);
        const clip = (type: string) => {
            const setData = vi.fn();
            const e = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperty(e, 'clipboardData', { value: { setData } });
            m.host('b-0').dispatchEvent(e);
            return { e, setData };
        };
        const copy = clip('copy');
        expect(copy.e.defaultPrevented).toBe(true);
        expect(copy.setData.mock.calls).toEqual(expect.arrayContaining([['text/plain', 'llo\n\nwor\n'], ['text/markdown', 'llo\n\nwor\n']]));
        const cut = clip('cut');
        await tick();
        expect(cut.setData).toHaveBeenCalled();
        expect(m.source()).toBe('held\n');
    });

    it('cut never deletes what it could not copy (#67 review)', async () => {
        const m = await mount('hello\n\nworld');
        await m.select(HW);
        m.host('b-0').dispatchEvent(new Event('cut', { bubbles: true, cancelable: true }));
        await tick();
        expect(m.source()).toBe('hello\n\nworld\n');
    });

    it('a virtual keyboard paste (beforeinput insertFromPaste) replaces the range (#67 review)', async () => {
        const m = await mount('hello\n\nworld');
        await m.select(HW);
        const e = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertFromPaste' });
        Object.defineProperty(e, 'dataTransfer', { value: { types: ['text/plain'], getData: (t: string) => (t === 'text/plain' ? 'x' : '') } });
        m.host('b-0').dispatchEvent(e);
        await tick();
        expect(e.defaultPrevented).toBe(true);
        expect(m.source()).toBe('hexld\n');
    });

    it('turning read-only on leaves the mode (#67 review)', async () => {
        const ro = signal({ on: false });
        const container = document.createElement('div');
        document.body.appendChild(container);
        containers.push(container);
        let controller!: RichTextEditorController;
        const Host = component(() => () => jsx(RichTextEditor, { format: markdownFormat, defaultSource: 'hello\n\nworld', plugins: [markdownPreset], readOnly: ro.on, ref: (c: RichTextEditorController) => (controller = c) }));
        render(jsx(Host, {}) as never, container);
        await tick();
        const content = container.querySelector('[data-part=content]') as HTMLElement;
        (container.querySelector('[data-part=inline][data-key="b-0"]') as HTMLElement).focus();
        controller.editor.setSelection(HW);
        await tick();
        expect(content.getAttribute('contenteditable')).toBe('true');
        ro.on = true;
        await tick();
        expect(content.hasAttribute('contenteditable')).toBe(false);
    });

    it('marks code, void and table blocks inside the range', async () => {
        const m = await mount('a\n\n---\n\n```\nx\n```\n\n| t |\n| - |\n| u |\n\nb');
        await m.select(range(pt('b-0', 0), pt('b-4', 1)));
        const inRange = Array.from(m.root.querySelectorAll('[data-part=block][data-in-range]')).map((el) => el.getAttribute('data-key'));
        expect(inRange).toEqual(['b-1', 'b-2', 'b-3']);
        m.key('ArrowLeft');
        await tick();
        expect(m.root.querySelectorAll('[data-in-range]')).toHaveLength(0);
    });

    it('reads a DOM range across two blocks back into the model', async () => {
        const m = await mount('hello\n\nworld');
        m.host('b-0').focus();
        // (happy-dom keeps selections forward; real browsers' backward drags are covered by the e2e.)
        document.getSelection()!.setBaseAndExtent(m.host('b-0').firstChild!, 1, m.host('b-1').firstChild!, 2);
        document.dispatchEvent(new Event('selectionchange'));
        await tick();
        expect(m.controller.editor.state.selection).toEqual(range(pt('b-0', 1), pt('b-1', 2)));
        expect(m.content.getAttribute('contenteditable')).toBe('true');
    });

    it('Shift+ArrowDown at the end of a block extends the selection into the next one', async () => {
        const m = await mount('hello\n\nworld');
        const host = m.host('b-0');
        host.focus();
        document.getSelection()!.collapse(host.firstChild, 5);
        const e = m.key('ArrowDown', { shiftKey: true });
        await tick();
        expect(e.defaultPrevented).toBe(true);
        expect(m.controller.editor.state.selection).toEqual(range(pt('b-0', 5), pt('b-1', 0)));
        expect(m.content.getAttribute('contenteditable')).toBe('true');
        // Shift+ArrowLeft at the start of a block reaches back to the end of the previous one.
        const back = await mount('ab\n\ncd');
        back.host('b-1').focus();
        document.getSelection()!.collapse(back.host('b-1').firstChild, 0);
        back.key('ArrowLeft', { shiftKey: true });
        await tick();
        expect(back.controller.editor.state.selection).toEqual(range(pt('b-1', 0), pt('b-0', 2)));
    });

    it('a plain click leaves the mode', async () => {
        const m = await mount('hello\n\nworld');
        await m.select(HW);
        m.host('b-1').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
        expect(m.content.hasAttribute('contenteditable')).toBe(false);
    });

    it('read-only: a DOM range across blocks reaches the model (for copy) but never the editing mode', async () => {
        const m = await mount('hello\n\nworld', { readOnly: true });
        document.getSelection()!.setBaseAndExtent(m.host('b-0').firstChild!, 2, m.host('b-1').firstChild!, 3);
        document.dispatchEvent(new Event('selectionchange'));
        await tick();
        expect(m.controller.editor.state.selection).toEqual(HW);
        expect(m.content.hasAttribute('contenteditable')).toBe(false);
        const setData = vi.fn();
        const e = new Event('copy', { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'clipboardData', { value: { setData } });
        m.root.dispatchEvent(e);
        expect(setData).toHaveBeenCalledWith('text/plain', 'llo\n\nwor\n');
    });

    it('keeps block chrome out of the editing host', async () => {
        const m = await mount('a\n\n---\n\n```\nx\n```');
        expect(m.root.querySelector('[data-part=handle]')!.getAttribute('contenteditable')).toBe('false');
        expect(m.root.querySelector('[data-part=void]')!.getAttribute('contenteditable')).toBe('false');
        expect(m.root.querySelector('[data-part=code]')!.getAttribute('contenteditable')).toBe('false');
    });
});

describe('domPointToModel', () => {
    /** Resolve points against a mounted editor (the view part `domPointToModel` reads is the editor). */
    async function probe(source: string) {
        const m = await mount(source);
        const view = { editor: m.controller.editor } as unknown as EditorView;
        return { m, at: (node: Node, offset: number, side: 'start' | 'end') => domPointToModel(view, m.content, node, offset, side) };
    }

    it('maps a point in a text host to its offset', async () => {
        const { m, at } = await probe('hello\n\n**bold** x');
        expect(at(m.host('b-0').firstChild!, 3, 'start')).toEqual(pt('b-0', 3));
        expect(at(m.host('b-1').querySelector('strong')!.firstChild!, 2, 'end')).toEqual(pt('b-1', 2));
    });

    it('takes a code block whole and resolves a void block to its neighbours', async () => {
        const { m, at } = await probe('a\n\n```\ncode\n```\n\n---\n\nb');
        const code = m.root.querySelector('[data-part=code]')!;
        expect(at(code, 0, 'start')).toEqual(pt('b-1', 0));
        expect(at(code, 0, 'end')).toEqual(pt('b-1', 4));
        const hr = m.root.querySelector('[data-part=void]')!;
        expect(at(hr, 0, 'start')).toEqual(pt('b-3', 0));
        expect(at(hr, 0, 'end')).toEqual(pt('b-1', 4));
    });

    it('resolves a point between blocks to the nearest editable block', async () => {
        const { m, at } = await probe('ab\n\ncd');
        // The content's children include the renderer's anchors: address the second block's wrapper by index.
        const second = Array.prototype.indexOf.call(m.content.childNodes, m.content.querySelector('[data-part=block][data-key="b-1"]'));
        expect(at(m.content, second, 'start')).toEqual(pt('b-1', 0));
        expect(at(m.content, second, 'end')).toEqual(pt('b-0', 2));
        expect(at(m.content, 0, 'start')).toEqual(pt('b-0', 0));
        expect(at(m.content, m.content.childNodes.length, 'end')).toEqual(pt('b-1', 2));
    });
});
