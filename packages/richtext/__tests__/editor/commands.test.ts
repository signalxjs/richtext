import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@sigx/richtext-markdown';
import { toMarkdown } from '@sigx/richtext-markdown';
import { markdownSchema } from '@sigx/richtext-markdown';
import { createState, textSelection, blockSelection } from '../../src/editor/state.js';
import type { EditorSelection, EditorState } from '../../src/editor/state.js';
import type { BlockContent, Root } from '../../src/ast/index.js';

const doc = (...children: BlockContent[]): Root => ({ type: 'root', children });
const p = (text = ''): BlockContent => ({ type: 'paragraph', children: text ? [{ type: 'text', value: text }] : [] });
import { applyTransaction } from '../../src/editor/transaction.js';
import type { Transaction } from '../../src/editor/transaction.js';
import * as C from '../../src/editor/registry.js';
import type { Command, CommandContext } from '../../src/editor/commands.js';
import { blocksToRoot, selectedBlockKeys } from '../../src/editor/commands.js';
import { markdownFormat } from '@sigx/richtext-markdown';
import { plainTextFormat } from '../../src/document/index.js';

const schema = markdownSchema;
const ctx: CommandContext = { schema, formats: [markdownFormat] };

/** Run a command against a document (markdown or a hand-built root) + selection; returns the resulting markdown, state and transaction. */
function run(md: string | Root, selection: EditorSelection, command: Command) {
    const state = createState(typeof md === 'string' ? parseMarkdown(md) : md, selection, schema);
    let tr: Transaction | null = null;
    const ok = command(state, (t) => (tr = t), ctx);
    if (!ok) return { ok, md: toMarkdown(state.doc), state, tr: null as Transaction | null };
    const next = applyTransaction(state, tr!, ctx).state;
    return { ok, md: toMarkdown(next.doc), state: next, tr: tr as Transaction | null };
}

const at = (key: string, offset: number, to?: number) => textSelection(key, offset, to);

describe('inline commands', () => {
    it('insertText inherits the marks at the caret and replaces a selection', () => {
        expect(run('**bold**', at('b-0', 4), C.insertText('X')).md).toBe('**boldX**\n');
        expect(run('**bold** x', at('b-0', 5, 6), C.insertText('Y')).md).toBe('**bold** Y\n');
        expect(run('**bold**', at('b-0', 0, 4), C.insertText('new')).md).toBe('**new**\n');
        expect(run('plain', at('b-0', 5), C.insertText('!')).state.selection).toEqual(at('b-0', 6));
    });

    it('insertText in a code block edits the value', () => {
        const r = run('```js\nab\n```', at('b-0', 1), C.insertText('X'));
        expect(r.md).toBe('```js\naXb\n```\n');
        expect(r.state.selection).toEqual(at('b-0', 2));
    });

    it('toggleMark on a range adds then removes; collapsed is refused', () => {
        const on = run('hello world', at('b-0', 0, 5), C.toggleMark('strong'));
        expect(on.md).toBe('**hello** world\n');
        expect(run('**hello** world', at('b-0', 0, 5), C.toggleMark('strong')).md).toBe('hello world\n');
        expect(run('hello', at('b-0', 2), C.toggleMark('strong')).ok).toBe(false);
    });

    it('setLink and unsetLink', () => {
        expect(run('see docs', at('b-0', 4, 8), C.setLink('https://x', 'T')).md).toBe('see [docs](https://x "T")\n');
        expect(run('see', at('b-0', 3), C.setLink('https://x')).md).toBe('see<https://x>\n');
        expect(run('see [docs](u)', at('b-0', 6), C.unsetLink).md).toBe('see docs\n');
        expect(run('plain', at('b-0', 2), C.unsetLink).ok).toBe(false);
    });

    it('insertAtom inserts an image / mention atom', () => {
        const r = run('a b', at('b-0', 1), C.insertImage('u', 'alt'));
        expect(r.md).toBe('a![alt](u) b\n');
        expect(r.state.selection).toEqual(at('b-0', 2));
    });

    it('insertHardBreak only in paragraphs', () => {
        expect(run('ab', at('b-0', 1), C.insertHardBreak).md).toBe('a\\\nb\n');
        expect(run('# ab', at('b-0', 1), C.insertHardBreak).ok).toBe(false);
    });
});

describe('splitBlock', () => {
    it('splits a paragraph at the caret, keeping marks on both sides', () => {
        const r = run('ab **cd** ef', at('b-0', 4), C.splitBlock);
        expect(r.md).toBe('ab **c**\n\n**d** ef\n');
        expect(r.state.selection).toEqual(at('b-1', 0));
    });

    it('replaces a selection while splitting', () => {
        expect(run('abcdef', at('b-0', 2, 4), C.splitBlock).md).toBe('ab\n\nef\n');
    });

    it('a heading splits into a paragraph at its end, and into a heading in the middle', () => {
        const end = run('# Title', at('b-0', 5), C.splitBlock);
        expect(end.md).toBe('# Title\n');
        expect(end.state.doc.children[1]).toMatchObject({ type: 'paragraph', children: [] });
        expect(run('# Title', at('b-0', 3), C.splitBlock).md).toBe('# Tit\n\n# le\n');
    });

    it('splits a list item into a new item carrying the rest of the item', () => {
        const r = run('- ab\n- cd', at('b-0.0.0', 1), C.splitBlock);
        expect(r.md).toBe('- a\n- b\n- cd\n');
        expect(r.state.selection).toEqual(at('b-0.1.0', 0));
        const task = run('- [ ] ab', at('b-0.0.0', 2), C.splitBlock);
        expect(task.md).toBe('- [ ] ab\n- [ ]\n');
        const nested = run('- a\n  - b\n  - c', at('b-0.0.0', 1), C.splitBlock);
        expect(nested.md).toBe('- a\n-\n  - b\n  - c\n');
    });

    it('an empty list item outdents or lifts to a paragraph', () => {
        const lifted = run('- a\n-', at('b-0.1.0', 0), C.splitBlock);
        expect(lifted.state.doc.children.map((c) => c.type)).toEqual(['list', 'paragraph']);
        expect(lifted.md).toBe('- a\n');
        // `- a\n  -` would parse as a setext heading, so build the nested empty item by hand.
        const nestedEmpty = doc({ type: 'list', ordered: false, children: [{ type: 'listItem', children: [p('a'), { type: 'list', ordered: false, children: [{ type: 'listItem', children: [p()] }] }] }] });
        expect(run(nestedEmpty, at('b-0.0.1.0.0', 0), C.splitBlock).md).toBe('- a\n-\n');
        const mid = run('- a\n-\n- c', at('b-0.1.0', 0), C.splitBlock);
        expect(mid.state.doc.children.map((c) => c.type)).toEqual(['list', 'paragraph', 'list']);
        expect(mid.state.selection).toEqual(at('b-1', 0));
    });

    it('an empty trailing paragraph lifts out of a blockquote', () => {
        const r = run(doc({ type: 'blockquote', children: [p('a'), p()] }), at('b-0.1', 0), C.splitBlock);
        expect(r.state.doc.children.map((c) => c.type)).toEqual(['blockquote', 'paragraph']);
        expect(r.md).toBe('> a\n');
        expect(r.state.selection).toEqual(at('b-1', 0));
    });

    it('a code block inserts a newline and table cells never split', () => {
        expect(run('```\nab\n```', at('b-0', 1), C.splitBlock).md).toBe('```\na\nb\n```\n');
        expect(run('| a |\n| - |\n| b |', at('b-0.1.0', 0), C.splitBlock).ok).toBe(false);
    });
});

describe('joinBackward / joinForward', () => {
    it('merges into the previous paragraph and keeps the caret at the seam', () => {
        const r = run('ab\n\ncd', at('b-1', 0), C.joinBackward);
        expect(r.md).toBe('abcd\n');
        expect(r.state.selection).toEqual(at('b-0', 2));
    });

    it('turns a heading into a paragraph first', () => {
        expect(run('a\n\n# b', at('b-1', 0), C.joinBackward).md).toBe('a\n\nb\n');
    });

    it('lifts a list item out, and outdents a nested one', () => {
        expect(run('- a\n- b', at('b-0.1.0', 0), C.joinBackward).md).toBe('- a\n\nb\n');
        expect(run('- a\n  - b', at('b-0.0.1.0.0', 0), C.joinBackward).md).toBe('- a\n- b\n');
        expect(run('- a', at('b-0.0.0', 0), C.joinBackward).md).toBe('a\n');
    });

    it('lifts the first paragraph out of a quote', () => {
        expect(run('> a\n>\n> b', at('b-0.0', 0), C.joinBackward).md).toBe('a\n\n> b\n');
    });

    it('selects a preceding void block instead of merging, and moves into a preceding code block', () => {
        const hr = run('---\n\nb', at('b-1', 0), C.joinBackward);
        expect(hr.md).toBe('---\n\nb\n');
        expect(hr.state.selection).toEqual(blockSelection('b-0'));
        const code = run('```\nx\n```\n\nb', at('b-1', 0), C.joinBackward);
        expect(code.state.selection).toEqual(at('b-0', 1));
    });

    it('is a no-op at the start of the document and off-boundary', () => {
        expect(run('ab', at('b-0', 0), C.joinBackward).ok).toBe(false);
        expect(run('ab\n\ncd', at('b-1', 1), C.joinBackward).ok).toBe(false);
    });

    it('joinForward merges the next paragraph', () => {
        const r = run('ab\n\ncd', at('b-0', 2), C.joinForward);
        expect(r.md).toBe('abcd\n');
        expect(r.state.selection).toEqual(at('b-0', 2));
        expect(run('ab\n\n- c', at('b-0', 2), C.joinForward).md).toBe('abc\n');
    });
});

describe('block type and lists', () => {
    it('setBlockType converts paragraph ↔ heading ↔ code', () => {
        expect(run('ab', at('b-0', 1), C.setBlockType('heading', { depth: 2 })).md).toBe('## ab\n');
        expect(run('## ab', at('b-0', 1), C.setBlockType('heading', { depth: 3 })).md).toBe('### ab\n');
        expect(run('## ab', at('b-0', 1), C.setBlockType('paragraph')).md).toBe('ab\n');
        expect(run('a **b**', at('b-0', 1), C.setBlockType('code', { lang: 'js' })).md).toBe('```js\na b\n```\n');
        expect(run('```js\nx\n```', at('b-0', 1), C.setBlockType('paragraph')).md).toBe('x\n');
    });

    it('setBlockType clamps a heading depth to 1..6 and defaults a missing or invalid one to 1', () => {
        const depthOf = (attrs?: Record<string, unknown>) => {
            const r = run('ab', at('b-0', 1), C.setBlockType('heading', attrs));
            return { md: r.md, depth: (r.state.doc.children[0] as { depth: number }).depth };
        };
        expect(depthOf({ depth: 9 })).toEqual({ md: '###### ab\n', depth: 6 });
        expect(depthOf({ depth: 0 })).toEqual({ md: '# ab\n', depth: 1 });
        expect(depthOf({ depth: 'x' })).toEqual({ md: '# ab\n', depth: 1 });
        expect(depthOf({ depth: 2.7 })).toEqual({ md: '## ab\n', depth: 2 });
        expect(depthOf()).toEqual({ md: '# ab\n', depth: 1 });
    });

    it('setBlockType refuses tableCell as a target: a cell is never a conversion result', () => {
        const r = run('## ab', at('b-0', 1), C.setBlockType('tableCell'));
        expect(r.ok).toBe(false);
        expect(r.md).toBe('## ab\n');
        expect(schema.get('tableCell')?.fromInline).toBeUndefined();
    });

    it('setBlockType applies to every block of a block selection', () => {
        expect(run('a\n\nb\n\nc', blockSelection('b-0', 'b-1'), C.setBlockType('heading', { depth: 1 })).md).toBe('# a\n\n# b\n\nc\n');
    });

    it('toggleList wraps, changes kind, and unwraps', () => {
        expect(run('a', at('b-0', 1), C.toggleList('bullet')).md).toBe('- a\n');
        expect(run('a', at('b-0', 1), C.toggleList('ordered')).md).toBe('1. a\n');
        expect(run('a', at('b-0', 1), C.toggleList('task')).md).toBe('- [ ] a\n');
        expect(run('- a\n- b', at('b-0.0.0', 1), C.toggleList('ordered')).md).toBe('1. a\n2. b\n');
        expect(run('- a\n- b', at('b-0.0.0', 1), C.toggleList('task')).md).toBe('- [ ] a\n- [ ] b\n');
        expect(run('- [x] a', at('b-0.0.0', 1), C.toggleList('bullet')).md).toBe('- a\n');
        expect(run('- a\n- b', at('b-0.1.0', 1), C.toggleList('bullet')).md).toBe('- a\n\nb\n');
        const wrapped = run('a\n\nb', blockSelection('b-0', 'b-1'), C.toggleList('bullet'));
        expect(wrapped.md).toBe('- a\n- b\n');
        const sel = run('a', at('b-0', 1), C.toggleList('bullet')).state.selection;
        expect(sel).toEqual(at('b-0.0.0', 1));
    });

    it('indentListItem nests under the previous item (creating or extending its sub-list)', () => {
        const r = run('- a\n- b', at('b-0.1.0', 1), C.indentListItem);
        expect(r.md).toBe('- a\n  - b\n');
        expect(r.state.selection).toEqual(at('b-0.0.1.0.0', 1));
        expect(run('- a\n  - b\n- c', at('b-0.1.0', 0), C.indentListItem).md).toBe('- a\n  - b\n  - c\n');
        expect(run('- a', at('b-0.0.0', 0), C.indentListItem).ok).toBe(false);
    });

    it('outdentListItem lifts a nested item after its parent, taking later siblings along', () => {
        const r = run('- a\n  - b\n  - c\n- d', at('b-0.0.1.0.0', 1), C.outdentListItem);
        expect(r.md).toBe('- a\n- b\n  - c\n- d\n');
        expect(r.state.selection).toEqual(at('b-0.1.0', 1));
        expect(run('- a\n  - b', at('b-0.0.1.0.0', 0), C.outdentListItem).md).toBe('- a\n- b\n');
        expect(run('- a', at('b-0.0.0', 0), C.outdentListItem).ok).toBe(false);
    });

    it('toggleTaskChecked flips a task item', () => {
        expect(run('- [ ] a', at('b-0.0.0', 0), C.toggleTaskChecked()).md).toBe('- [x] a\n');
        expect(run('- [x] a', undefined as never, C.toggleTaskChecked('b-0.0')).md).toBe('- [ ] a\n');
        expect(run('- a', at('b-0.0.0', 0), C.toggleTaskChecked()).ok).toBe(false);
    });

    it('wrapInBlockquote and liftOutOfBlockquote', () => {
        const w = run('a\n\nb', at('b-0', 1), C.wrapInBlockquote);
        expect(w.md).toBe('> a\n\nb\n');
        expect(w.state.selection).toEqual(at('b-0.0', 1));
        expect(run('a\n\nb', blockSelection('b-0', 'b-1'), C.wrapInBlockquote).md).toBe('> a\n>\n> b\n');
        expect(run('> a\n>\n> b\n>\n> c', at('b-0.1', 0), C.liftOutOfBlockquote).md).toBe('> a\n\nb\n\n> c\n');
        expect(run('a', at('b-0', 0), C.liftOutOfBlockquote).ok).toBe(false);
    });
});

describe('block insertion, tables and movement', () => {
    it('insertBlockAfter replaces an empty paragraph, else inserts after', () => {
        const hr = run(doc(p('a'), p()), at('b-1', 0), C.insertThematicBreak);
        expect(hr.md).toBe('a\n\n---\n');
        expect(hr.state.selection).toEqual(blockSelection('b-1'));
        expect(run('a', at('b-0', 1), C.insertThematicBreak).md).toBe('a\n\n---\n');
        const table = run('a', at('b-0', 1), C.insertTable(2, 2));
        expect(table.md).toBe('a\n\n|  |  |\n| --- | --- |\n|  |  |\n');
        expect(table.state.selection).toEqual(at('b-1.0.0', 0));
    });

    it('exitCode leaves a code block into a fresh paragraph', () => {
        const r = run('```\nx\n```', at('b-0', 1), C.exitCode);
        expect(r.state.doc.children.map((c) => c.type)).toEqual(['code', 'paragraph']);
        expect(r.state.selection).toEqual(at('b-1', 0));
        expect(run('x', at('b-0', 1), C.exitCode).ok).toBe(false);
    });

    it('table row and column operations', () => {
        const t = '| a | b |\n| - | - |\n| c | d |';
        expect(run(t, at('b-0.1.0', 0), C.addRowAfter).md).toBe('| a | b |\n| --- | --- |\n| c | d |\n|  |  |\n');
        expect(run(t, at('b-0.1.0', 0), C.addRowBefore).md).toBe('| a | b |\n| --- | --- |\n|  |  |\n| c | d |\n');
        expect(run(t, at('b-0.0.0', 0), C.addRowBefore).ok).toBe(false);
        expect(run(t, at('b-0.1.0', 0), C.deleteRow).ok).toBe(false);
        expect(run(t + '\n| e | f |', at('b-0.1.0', 0), C.deleteRow).md).toBe('| a | b |\n| --- | --- |\n| e | f |\n');
        expect(run(t, at('b-0.0.0', 0), C.addColumnAfter).md).toBe('| a |  | b |\n| --- | --- | --- |\n| c |  | d |\n');
        expect(run(t, at('b-0.0.1', 0), C.addColumnBefore).md).toBe('| a |  | b |\n| --- | --- | --- |\n| c |  | d |\n');
        expect(run(t, at('b-0.0.1', 0), C.deleteColumn).md).toBe('| a |\n| --- |\n| c |\n');
        expect(run(t, at('b-0.0.1', 0), C.setColumnAlign('right')).md).toBe('| a | b |\n| --- | --: |\n| c | d |\n');
        expect(run('x', at('b-0', 0), C.addRowAfter).ok).toBe(false);
    });

    it('deleteBlock removes blocks (and empty containers) and focuses a neighbour', () => {
        const r = run('a\n\nb\n\nc', blockSelection('b-1'), C.deleteBlock);
        expect(r.md).toBe('a\n\nc\n');
        expect(r.state.selection).toEqual(at('b-0', 1));
        expect(run('- a', blockSelection('b-0.0.0'), C.deleteBlock).state.doc.children).toEqual([{ type: 'paragraph', key: 'b-0', children: [] }]);
        const all = run('a', blockSelection('b-0'), C.deleteBlock);
        expect(all.state.doc.children).toHaveLength(1);
        expect(all.state.selection).toEqual(at('b-0', 0));
    });

    it('duplicateBlock and moveBlockUp/Down', () => {
        expect(run('a\n\nb', blockSelection('b-0'), C.duplicateBlock).md).toBe('a\n\na\n\nb\n');
        const up = run('a\n\nb', at('b-1', 1), C.moveBlockUp);
        expect(up.md).toBe('b\n\na\n');
        expect(up.state.selection).toEqual(at('b-0', 1));
        expect(run('a\n\nb', at('b-0', 0), C.moveBlockUp).ok).toBe(false);
        expect(run('- a\n- b', at('b-0.0.0', 0), C.moveBlockDown).md).toBe('- b\n- a\n');
    });
});

describe('selection and document commands', () => {
    it('escapes between text and block selection', () => {
        const esc = run('- a', at('b-0.0.0', 1), C.escapeToBlockSelection);
        expect(esc.state.selection).toEqual(blockSelection('b-0'));
        expect(run('- a', blockSelection('b-0'), C.escapeToText).state.selection).toEqual(at('b-0.0.0', 0));
        expect(run('a\n\nb\n\nc', at('b-0', 0), C.extendBlockSelection('down')).state.selection).toEqual(blockSelection('b-0'));
        expect(run('a\n\nb\n\nc', blockSelection('b-0'), C.extendBlockSelection('down')).state.selection).toEqual(blockSelection('b-0', 'b-1'));
        expect(run('a\n\nb', blockSelection('b-0', 'b-1'), C.extendBlockSelection('down')).ok).toBe(false);
        expect(run('a\n\nb', null, C.selectAll).state.selection).toEqual(blockSelection('b-0', 'b-1'));
    });

    it('focusNeighbour moves between editable blocks, through nesting, and onto void blocks', () => {
        expect(run('ab\n\ncd', at('b-0', 1), C.focusNeighbour('down')).state.selection).toEqual(at('b-1', 0));
        expect(run('ab\n\ncd', at('b-1', 1), C.focusNeighbour('up')).state.selection).toEqual(at('b-0', 2));
        expect(run('ab\n\ncd', at('b-0', 1), C.focusNeighbour('down', () => 1)).state.selection).toEqual(at('b-1', 1));
        expect(run('ab\n\n- cd', at('b-0', 1), C.focusNeighbour('down')).state.selection).toEqual(at('b-1.0.0', 0));
        expect(run('ab\n\n---\n\ncd', at('b-0', 1), C.focusNeighbour('down')).state.selection).toEqual(blockSelection('b-1'));
        expect(run('ab\n\n---\n\ncd', blockSelection('b-1'), C.focusNeighbour('down')).state.selection).toEqual(at('b-2', 0));
        expect(run('ab\n\n---\n\ncd', blockSelection('b-1'), C.focusNeighbour('up')).state.selection).toEqual(at('b-0', 2));
        expect(run('ab', at('b-0', 1), C.focusNeighbour('down')).ok).toBe(false);
        expect(run('ab\n\n---', at('b-0', 1), C.focusNeighbour('down')).state.selection).toEqual(blockSelection('b-1'));
    });

    it('focusStart / focusEnd', () => {
        expect(run('- ab\n\ncd', null, C.focusStart).state.selection).toEqual(at('b-0.0.0', 0));
        expect(run('- ab\n\ncd', null, C.focusEnd).state.selection).toEqual(at('b-1', 2));
    });

    it('setDocument, setSource and clear', () => {
        const r = run('old', at('b-0', 1), C.setSource('# new\n\ntext'));
        expect(run('old', at('b-0', 1), C.setSource('x', 'nope')).ok).toBe(false);
        expect(r.md).toBe('# new\n\ntext\n');
        expect(r.state.selection).toEqual(at('b-0', 0));
        expect(r.tr!.meta.addToHistory).toBe(false);
        const c = run('old', at('b-0', 1), C.clear);
        expect(c.state.doc.children).toEqual([{ type: 'paragraph', key: 'b-0', children: [] }]);
        expect(c.tr!.meta.addToHistory).toBe(true);
    });
});

describe('setBlockType selection', () => {
    it('clamps the caret when the conversion drops hard breaks, so the next edit never throws', () => {
        const para: BlockContent = { type: 'paragraph', children: [{ type: 'text', value: 'a' }, { type: 'break' }, { type: 'text', value: 'b' }] };
        const r = run(doc(para), at('b-0', 3), C.setBlockType('heading', { depth: 1 }));
        expect(r.md).toBe('# ab\n');
        expect(r.state.selection).toEqual(at('b-0', 2));
        let next = r.state;
        expect(C.insertText('!')(r.state, (t) => void (next = applyTransaction(r.state, t, ctx).state), ctx)).toBe(true);
        expect(toMarkdown(next.doc)).toBe('# ab!\n');
        const code = run(doc(para), at('b-0', 3), C.setBlockType('code'));
        expect(code.state.selection).toEqual(at('b-0', 3));
    });
});

describe('paste', () => {
    it('pastes a single line inline with its marks', () => {
        const r = run('ab', at('b-0', 1), C.paste({ text: '**x**' }));
        expect(r.md).toBe('a**x**b\n');
        expect(r.state.selection).toEqual(at('b-0', 2));
        expect(r.tr!.meta.origin).toBe('paste');
    });

    it('pastes multi-block markdown by splitting the paragraph and merging the edges', () => {
        const r = run('ab', at('b-0', 1), C.paste({ text: 'one\n\n- two\n\nthree' }));
        expect(r.md).toBe('aone\n\n- two\n\nthreeb\n');
        expect(r.state.selection).toEqual(at('b-2', 5));
        const endsWithBlock = run('ab', at('b-0', 1), C.paste({ text: 'one\n\n```\ncode\n```' }));
        expect(endsWithBlock.md).toBe('aone\n\n```\ncode\n```\n\nb\n');
        expect(endsWithBlock.state.selection).toEqual(at('b-2', 0));
    });

    it('pastes only paragraphs into the edges; a heading or list stays its own block', () => {
        const r = run('ab', at('b-0', 2), C.paste({ text: '## H\n\n- x\n- y' }));
        expect(r.md).toBe('ab\n\n## H\n\n- x\n- y\n');
        expect(r.state.selection).toEqual(at('b-2.1.0', 1));
        // At the start of an empty paragraph the first block replaces it instead of leaving an empty paragraph behind.
        const empty = run('', at('b-0', 0), C.paste({ text: '## H\n\ntext' }));
        expect(empty.md).toBe('## H\n\ntext\n');
        expect(empty.state.selection).toEqual(at('b-1', 4));
    });

    it('pastes blocks after a code block', () => {
        const r = run('```\nx\n```', at('b-0', 1), C.paste({ text: 'a\n\nb' }));
        expect(r.md).toBe('```\nx\n```\n\na\n\nb\n');
        expect(r.state.selection).toEqual(blockSelection('b-1', 'b-2'));
    });
});

describe('paste by flavour', () => {
    it('takes the first flavour a format reads: text/markdown over text/plain, and plain text as markdown', () => {
        const r = run('ab', at('b-0', 1), C.paste({ text: 'plain', 'text/markdown': '**md**' }));
        expect(r.md).toBe('a**md**b\n');
        expect(run('ab', at('b-0', 1), C.paste({ text: '*em*' })).md).toBe('a*em*b\n');
    });

    it('falls back to plain text when no format reads a flavour present', () => {
        const text = run('ab', at('b-0', 1), (s, d) => C.paste({ text: '*em*' })(s, d, { schema, formats: [] }));
        expect(text.md).toBe('a\\*em\\*b\n');
        const plain = run('ab', at('b-0', 1), (s, d) => C.paste({ text: 'one\n\ntwo' })(s, d, { schema, formats: [plainTextFormat] }));
        expect(plain.md).toBe('aone\n\ntwob\n');
        expect(run('ab', at('b-0', 1), C.paste({ text: '' })).ok).toBe(false);
    });
});

describe('Enter and Backspace chains', () => {
    it('splitBlock tries the list item, then the quote edge, then the plain split', () => {
        expect(run('- a', at('b-0.0.0', 1), C.splitBlock).md).toBe('- a\n-\n');
        // the plain split alone stays inside the item: a second paragraph, not a second item
        const plain = run('- a', at('b-0.0.0', 1), C.splitTextBlock).state.doc.children[0] as { children: { children: { type: string }[] }[] };
        expect(plain.children).toHaveLength(1);
        expect(plain.children[0].children.map((c) => c.type)).toEqual(['paragraph', 'paragraph']);
        // an empty paragraph ending a quote lifts out
        expect(run(doc({ type: 'blockquote', children: [p('a'), p()] }), at('b-0.1', 0), C.splitBlock).state.doc.children.map((c) => c.type)).toEqual(['blockquote', 'paragraph']);
        expect(run('ab', at('b-0', 1), C.splitBlock).md).toBe('a\n\nb\n');
    });

    it('joinBackward converts a non-default block first, then handles lists and quotes, then joins', () => {
        expect(run('- # h', at('b-0.0.0', 0), C.joinBackward).md).toBe('- h\n');
        expect(run('- h', at('b-0.0.0', 0), C.joinBackward).md).toBe('h\n');
        expect(run('> h', at('b-0.0', 0), C.joinBackward).md).toBe('h\n');
        expect(run('a\n\nb', at('b-1', 0), C.joinBackward).md).toBe('ab\n');
        expect(run('a\n\nb', at('b-1', 0), C.joinBackwardInList).ok).toBe(false);
    });
});

describe('block selections (#58)', () => {
    const sel = (md: string, anchor: string, head: string) => selectedBlockKeys(createState(parseMarkdown(md), blockSelection(anchor, head), schema));

    it('selectedBlockKeys lifts both ends to their lowest common parent', () => {
        const md = 'a\n\n- b\n- c\n\nd';
        expect(sel(md, 'b-0', 'b-1.1')).toEqual(['b-0', 'b-1']);
        expect(sel(md, 'b-1.1.0', 'b-0')).toEqual(['b-0', 'b-1']);
        expect(sel(md, 'b-1.0.0', 'b-1.1.0')).toEqual(['b-1.0', 'b-1.1']);
        expect(sel(md, 'b-1.1', 'b-2')).toEqual(['b-1', 'b-2']);
        // One end inside the other: the outer block.
        expect(sel(md, 'b-1', 'b-1.0.0')).toEqual(['b-1']);
    });

    it('toggleList keeps the order of a mixed selection: non-text blocks split the runs', () => {
        const r = run('a\n\n---\n\nb\n\nc', blockSelection('b-0', 'b-3'), C.toggleList('bullet'));
        expect(r.md).toBe('- a\n\n---\n\n- b\n- c\n');
        expect(r.state.selection).toEqual(blockSelection('b-0', 'b-2'));
    });

    it('toggleList splices the items of a selected list into the new one', () => {
        const r = run('a\n\n1. b\n2. c\n\nd', blockSelection('b-0', 'b-2'), C.toggleList('bullet'));
        expect(r.md).toBe('- a\n- b\n- c\n- d\n');
        expect(r.state.selection).toEqual(blockSelection('b-0'));
        // Already a list of that kind: nothing to do.
        expect(run('- a\n- b', blockSelection('b-0'), C.toggleList('bullet')).ok).toBe(false);
    });

    it('blocksToRoot wraps a nested selection in the parents it cannot live without', () => {
        const root = (md: string, keys: string[]) => toMarkdown(blocksToRoot(createState(parseMarkdown(md), null, schema), keys, ctx));
        expect(root('- a\n- b\n- c', ['b-0.1', 'b-0.2'])).toBe('- b\n- c\n');
        expect(root('> a\n>\n> b', ['b-0.1'])).toBe('b\n');
        expect(root('a\n\nb', ['b-0', 'b-1'])).toBe('a\n\nb\n');
        expect(root('| a | b |\n| - | - |\n| c | d |', ['b-0.1'])).toBe('| c | d |\n| --- | --- |\n');
    });

    it('paste replaces the selected blocks', () => {
        const r = run('a\n\nb\n\nc', blockSelection('b-1'), C.paste({ text: 'x\n\ny' }));
        expect(r.md).toBe('a\n\nx\n\ny\n\nc\n');
        expect(r.state.selection).toEqual(at('b-2', 1));
        expect(r.tr!.meta.origin).toBe('paste');
        const all = run('a\n\nb', blockSelection('b-0', 'b-1'), C.paste({ text: '# h' }));
        expect(all.md).toBe('# h\n');
        expect(all.state.selection).toEqual(at('b-0', 1));
    });

    it('paste over list items splices a pasted list and wraps other blocks in items', () => {
        expect(run('- a\n- b\n- c', blockSelection('b-0.1'), C.paste({ text: '- x\n- y' })).md).toBe('- a\n- x\n- y\n- c\n');
        expect(run('- a\n- b\n- c', blockSelection('b-0.1'), C.paste({ text: 'x' })).md).toBe('- a\n- x\n- c\n');
        // Rows of a table are isolating: refused.
        expect(run('| a |\n| - |\n| b |', blockSelection('b-0.1'), C.paste({ text: 'x' })).ok).toBe(false);
    });

    it('moveBlockUp/Down move a multi-block run and keep its direction', () => {
        const up = run('a\n\nb\n\nc\n\nd', blockSelection('b-1', 'b-2'), C.moveBlockUp);
        expect(up.md).toBe('b\n\nc\n\na\n\nd\n');
        expect(up.state.selection).toEqual(blockSelection('b-0', 'b-1'));
        const down = run('a\n\nb\n\nc\n\nd', blockSelection('b-2', 'b-1'), C.moveBlockDown);
        expect(down.md).toBe('a\n\nd\n\nb\n\nc\n');
        expect(down.state.selection).toEqual(blockSelection('b-3', 'b-2'));
        // A lifted selection keeps its direction too: the ends' own indexes are in different sibling lists.
        const lifted = run('a\n\nb\n\n- c\n- d\n\ne', blockSelection('b-2.1', 'b-1'), C.moveBlockUp);
        expect(lifted.md).toBe('b\n\n- c\n- d\n\na\n\ne\n');
        expect(lifted.state.selection).toEqual(blockSelection('b-1', 'b-0'));
        expect(run('a\n\nb\n\nc', blockSelection('b-0', 'b-1'), C.moveBlockUp).ok).toBe(false);
        expect(run('a\n\nb\n\nc', blockSelection('b-1', 'b-2'), C.moveBlockDown).ok).toBe(false);
    });
});

describe('commands registry', () => {
    it('exposes every named command as a Command', () => {
        for (const [name, cmd] of Object.entries(C.commands)) {
            expect(typeof cmd, name).toBe('function');
        }
        const state: EditorState = createState(parseMarkdown('x'), at('b-0', 1), schema);
        expect(C.commands.toggleStrong(state, undefined, ctx)).toBe(false);
        expect(C.commands.setHeading2(state, undefined, ctx)).toBe(true);
    });
});
