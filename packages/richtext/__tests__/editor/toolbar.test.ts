import { describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '@sigx/richtext-markdown';
import { toMarkdown } from '@sigx/richtext-markdown';
import { markdownSchema } from '@sigx/richtext-markdown';
import { blockSelection, createState, textSelection } from '../../src/editor/state.js';
import type { EditorSelection, EditorState } from '../../src/editor/state.js';
import type { BlockContent, Root } from '../../src/ast/index.js';
import { applyTransaction } from '../../src/editor/transaction.js';
import type { Command, CommandContext } from '../../src/editor/commands.js';
import { markdownFormat } from '@sigx/richtext-markdown';
import { defaultToolbarItems, toolbarState } from '../../src/editor/toolbar.js';
import type { ToolbarContext, ToolbarItem, ToolbarState } from '../../src/editor/toolbar.js';

const schema = markdownSchema;
const ctx: CommandContext = { schema, formats: [markdownFormat] };
const doc = (...children: BlockContent[]): Root => ({ type: 'root', children });
const p = (text = ''): BlockContent => ({ type: 'paragraph', children: text ? [{ type: 'text', value: text }] : [] });
const at = (key: string, offset: number, to?: number) => textSelection(key, offset, to);

const history = (canUndo = false, canRedo = false) => ({ canUndo: () => canUndo, canRedo: () => canRedo });

function stateOf(md: string | Root, selection: EditorSelection): EditorState {
    return createState(typeof md === 'string' ? parseMarkdown(md) : md, selection, schema);
}

/** A toolbar context over a document: `run` applies the command and tracks undo/redo requests. */
function harness(md: string | Root, selection: EditorSelection) {
    let state = stateOf(md, selection);
    const historyCalls: string[] = [];
    const tc: ToolbarContext = {
        get state() {
            return state;
        },
        dispatch: (tr) => {
            state = applyTransaction(state, tr, ctx).state;
        },
        ctx,
        run: (command) => {
            if (typeof command === 'string') {
                historyCalls.push(command);
                return true;
            }
            return command(state, tc.dispatch, ctx);
        },
    };
    return { tc, historyCalls, md: () => toMarkdown(state.doc), state: () => state, tb: () => toolbarState(state, ctx, history()) };
}

const by = Object.fromEntries(defaultToolbarItems.map((i) => [i.id, i])) as Record<string, ToolbarItem>;

describe('toolbarState', () => {
    it('reports marks at the caret and around a selection', () => {
        expect(toolbarState(stateOf('a **bold** c', at('b-0', 4)), ctx, history()).activeMarks).toEqual(['strong']);
        expect(toolbarState(stateOf('a **bold** c', at('b-0', 2, 6)), ctx, history()).activeMarks).toEqual(['strong']);
        expect(toolbarState(stateOf('a **bold** c', at('b-0', 0, 6)), ctx, history()).activeMarks).toEqual([]);
        expect(toolbarState(stateOf('*a* [b](u)', at('b-0', 3)), ctx, history()).activeMarks).toEqual(['link']);
    });

    it('describes a plain paragraph, a heading and a code block', () => {
        expect(toolbarState(stateOf('hi', at('b-0', 1)), ctx, history())).toEqual({
            activeMarks: [],
            blockType: 'paragraph',
            attrs: {},
            ancestors: [],
            listKind: null,
            inBlockquote: false,
            canUndo: false,
            canRedo: false,
            mode: 'text',
            multiBlock: false,
        });
        expect(toolbarState(stateOf('## hi', at('b-0', 1)), ctx, history())).toMatchObject({ blockType: 'heading', attrs: { depth: 2 } });
        const code = toolbarState(stateOf('```ts\nx\n```', at('b-0', 1)), ctx, history(true));
        expect(code).toMatchObject({ blockType: 'code', attrs: { lang: 'ts' }, activeMarks: [], canUndo: true });
    });

    it('finds the enclosing list kind and blockquote', () => {
        expect(toolbarState(stateOf('- [ ] todo', at('b-0.0.0', 1)), ctx, history())).toMatchObject({ blockType: 'paragraph', listKind: 'task' });
        expect(toolbarState(stateOf('1. one', at('b-0.0.0', 1)), ctx, history()).listKind).toBe('ordered');
        expect(toolbarState(stateOf('- one', at('b-0.0.0', 1)), ctx, history()).listKind).toBe('bullet');
        expect(toolbarState(stateOf('> - one', at('b-0.0.0.0', 1)), ctx, history())).toMatchObject({ listKind: 'bullet', inBlockquote: true });
        expect(toolbarState(stateOf('> quote', at('b-0.0', 1)), ctx, history())).toMatchObject({ listKind: null, inBlockquote: true });
        // A nested list reports the innermost kind.
        expect(toolbarState(stateOf('1. a\n   - b', at('b-0.0.1.0.0', 0)), ctx, history()).listKind).toBe('bullet');
    });

    it('block selections are mode block, describing the anchor block', () => {
        const tb = toolbarState(stateOf('- a\n\n---', blockSelection('b-0', 'b-1')), ctx, history(false, true));
        expect(tb).toMatchObject({ mode: 'block', blockType: 'list', listKind: 'bullet', activeMarks: [], canRedo: true });
        expect(toolbarState(stateOf('---', blockSelection('b-0')), ctx, history()).blockType).toBe('thematicBreak');
    });

    it('no selection is mode none', () => {
        expect(toolbarState(stateOf('hi', null), ctx, history(true, true))).toEqual({
            activeMarks: [],
            blockType: null,
            attrs: {},
            ancestors: [],
            listKind: null,
            inBlockquote: false,
            canUndo: true,
            canRedo: true,
            mode: 'none',
            multiBlock: false,
        });
    });
});

describe('defaultToolbarItems', () => {
    it('is the documented item set, grouped', () => {
        expect(defaultToolbarItems.map((i) => i.id)).toEqual(['bold', 'italic', 'strike', 'code', 'link', 'h1', 'h2', 'h3', 'paragraph', 'bullet', 'ordered', 'task', 'quote', 'codeBlock', 'hr', 'table', 'undo', 'redo']);
        expect(new Set(defaultToolbarItems.map((i) => i.group))).toEqual(new Set(['inline', 'block', 'insert', 'history']));
        for (const item of defaultToolbarItems) expect(item.label).toBeTruthy();
    });

    it('derives active states from the toolbar state', () => {
        const tb = (overrides: Partial<ToolbarState>): ToolbarState => ({ activeMarks: [], blockType: 'paragraph', attrs: {}, ancestors: [], listKind: null, inBlockquote: false, canUndo: false, canRedo: false, mode: 'text', multiBlock: false, ...overrides });
        expect(by.bold.isActive!(tb({ activeMarks: ['strong'] }))).toBe(true);
        expect(by.bold.isActive!(tb({}))).toBe(false);
        expect(by.italic.isActive!(tb({ activeMarks: ['emphasis'] }))).toBe(true);
        expect(by.strike.isActive!(tb({ activeMarks: ['delete'] }))).toBe(true);
        expect(by.code.isActive!(tb({ activeMarks: ['inlineCode'] }))).toBe(true);
        expect(by.link.isActive!(tb({ activeMarks: ['link'] }))).toBe(true);
        expect(by.h2.isActive!(tb({ blockType: 'heading', attrs: { depth: 2 } }))).toBe(true);
        expect(by.h1.isActive!(tb({ blockType: 'heading', attrs: { depth: 2 } }))).toBe(false);
        expect(by.paragraph.isActive!(tb({}))).toBe(true);
        expect(by.paragraph.isActive!(tb({ blockType: 'heading' }))).toBe(false);
        expect(by.bullet.isActive!(tb({ listKind: 'bullet' }))).toBe(true);
        expect(by.ordered.isActive!(tb({ listKind: 'ordered' }))).toBe(true);
        expect(by.task.isActive!(tb({ listKind: 'task' }))).toBe(true);
        expect(by.task.isActive!(tb({ listKind: 'bullet' }))).toBe(false);
        expect(by.quote.isActive!(tb({ inBlockquote: true }))).toBe(true);
        expect(by.codeBlock.isActive!(tb({ blockType: 'code' }))).toBe(true);
        expect(by.hr.isActive).toBeUndefined();
    });

    it('enables inline items only in text, block items with any selection, history from the flags', () => {
        const none = toolbarState(stateOf('x', null), ctx, history());
        const block = toolbarState(stateOf('x', blockSelection('b-0')), ctx, history(true));
        const text = toolbarState(stateOf('x', at('b-0', 0)), ctx, history(false, true));
        expect(by.bold.isEnabled!(text)).toBe(true);
        expect(by.bold.isEnabled!(block)).toBe(false);
        expect(by.h1.isEnabled!(block)).toBe(true);
        expect(by.h1.isEnabled!(none)).toBe(false);
        expect(by.table.isEnabled!(none)).toBe(false);
        expect(by.undo.isEnabled!(block)).toBe(true);
        expect(by.undo.isEnabled!(text)).toBe(false);
        expect(by.redo.isEnabled!(text)).toBe(true);
    });

    it('inline items toggle marks over the selection', () => {
        const h = harness('hello world', at('b-0', 0, 5));
        by.bold.run(h.tc);
        expect(h.md()).toBe('**hello** world\n');
        expect(by.bold.isActive!(h.tb())).toBe(true);
        by.bold.run(h.tc);
        expect(h.md()).toBe('hello world\n');
        by.italic.run(h.tc);
        expect(h.md()).toBe('*hello* world\n');
        by.strike.run(h.tc);
        expect(h.md()).toBe('*~~hello~~* world\n');
        expect([...h.tb().activeMarks].sort()).toEqual(['delete', 'emphasis']);
        by.code.run(h.tc);
        expect(h.md()).toBe('`hello` world\n');
    });

    it('link: links the selection to a placeholder URL, inserts an autolink at a caret, unlinks when linked', () => {
        const linked = harness('see docs', at('b-0', 4, 8));
        by.link.run(linked.tc);
        expect(linked.md()).toBe('see [docs](https://)\n');
        expect(by.link.isActive!(linked.tb())).toBe(true);
        by.link.run(linked.tc);
        expect(linked.md()).toBe('see docs\n');
        const caret = harness('see', at('b-0', 3));
        by.link.run(caret.tc);
        expect(caret.state().doc.children[0]).toMatchObject({ children: [{ type: 'text', value: 'see' }, { type: 'link', url: 'https://', children: [{ type: 'text', value: 'https://' }] }] });
        expect(caret.state().selection).toEqual(at('b-0', 11));
    });

    it('heading and paragraph items set the block type', () => {
        const h = harness('title', at('b-0', 2));
        by.h1.run(h.tc);
        expect(h.md()).toBe('# title\n');
        expect(by.h1.isActive!(h.tb())).toBe(true);
        by.h3.run(h.tc);
        expect(h.md()).toBe('### title\n');
        expect(by.h3.isActive!(h.tb())).toBe(true);
        expect(by.h1.isActive!(h.tb())).toBe(false);
        by.paragraph.run(h.tc);
        expect(h.md()).toBe('title\n');
        expect(by.paragraph.isActive!(h.tb())).toBe(true);
    });

    it('list items wrap, switch kind, and unwrap when already that kind', () => {
        const h = harness('item', at('b-0', 1));
        by.bullet.run(h.tc);
        expect(h.md()).toBe('- item\n');
        expect(by.bullet.isActive!(h.tb())).toBe(true);
        by.task.run(h.tc);
        expect(h.md()).toBe('- [ ] item\n');
        expect(by.task.isActive!(h.tb())).toBe(true);
        by.ordered.run(h.tc);
        expect(h.md()).toBe('1. item\n');
        by.ordered.run(h.tc);
        expect(h.md()).toBe('item\n');
        expect(by.ordered.isActive!(h.tb())).toBe(false);
    });

    it('quote wraps and lifts; codeBlock toggles with paragraph', () => {
        const q = harness('quote', at('b-0', 1));
        by.quote.run(q.tc);
        expect(q.md()).toBe('> quote\n');
        expect(by.quote.isActive!(q.tb())).toBe(true);
        by.quote.run(q.tc);
        expect(q.md()).toBe('quote\n');

        const c = harness('code', at('b-0', 1));
        by.codeBlock.run(c.tc);
        expect(c.md()).toBe('```\ncode\n```\n');
        expect(by.codeBlock.isActive!(c.tb())).toBe(true);
        by.codeBlock.run(c.tc);
        expect(c.md()).toBe('code\n');
    });

    it('insert items add a rule and a table after the block', () => {
        const hr = harness('a', at('b-0', 1));
        by.hr.run(hr.tc);
        expect(hr.state().doc.children.map((c) => c.type)).toEqual(['paragraph', 'thematicBreak']);
        expect(hr.state().selection).toEqual(blockSelection('b-1'));
        const table = harness(doc(p('a')), at('b-0', 1));
        by.table.run(table.tc);
        expect(table.state().doc.children.map((c) => c.type)).toEqual(['paragraph', 'table']);
        expect(table.state().selection).toEqual(at('b-1.0.0', 0));
    });

    it('undo and redo go through tc.run by name', () => {
        const h = harness('a', at('b-0', 1));
        by.undo.run(h.tc);
        by.redo.run(h.tc);
        expect(h.historyCalls).toEqual(['undo', 'redo']);
    });

    it('every run calls tc.run exactly once with a command (or twice for the fall-through toggles)', () => {
        for (const item of defaultToolbarItems) {
            const run = vi.fn((c: Command | 'undo' | 'redo') => (typeof c === 'string' ? true : c(state, undefined, ctx)));
            const state = stateOf('x', at('b-0', 0, 1));
            item.run({ state, dispatch: () => {}, ctx, run });
            expect(run).toHaveBeenCalled();
            expect(run.mock.calls.length).toBeLessThanOrEqual(2);
            for (const [c] of run.mock.calls) expect(typeof c === 'function' || c === 'undo' || c === 'redo').toBe(true);
        }
    });
});
