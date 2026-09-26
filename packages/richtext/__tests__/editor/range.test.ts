import { describe, expect, it } from 'vitest';
import { markdownFormat, markdownSchema, parseMarkdown, toMarkdown } from '@sigx/richtext-markdown';
import { createState, blockSelection, comparePoints, isCrossBlock, textRange, textSelection } from '../../src/editor/state.js';
import type { EditorSelection, Point } from '../../src/editor/state.js';
import { normalizeTextRange, orderedRange, rangeBlocks, sliceDoc } from '../../src/editor/range.js';
import { createEditor } from '../../src/editor/editor.js';
import { markdownPreset } from '@sigx/richtext-markdown/editor';
import { applyTransaction, mapSelection } from '../../src/editor/transaction.js';
import type { Transaction } from '../../src/editor/transaction.js';
import * as C from '../../src/editor/registry.js';
import type { Command, CommandContext } from '../../src/editor/commands.js';

const schema = markdownSchema;
const ctx: CommandContext = { schema, formats: [markdownFormat] };
const state = (md: string, selection: EditorSelection = null) => createState(parseMarkdown(md), selection, schema);
const pt = (key: string, offset: number): Point => ({ key, offset });
const range = (a: Point, h: Point) => textRange(a, h);

function run(md: string, selection: EditorSelection, command: Command) {
    const s = state(md, selection);
    let tr: Transaction | null = null;
    const ok = command(s, (t) => (tr = t), ctx);
    if (!ok) return { ok, md: toMarkdown(s.doc), state: s, tr: null as Transaction | null };
    const next = applyTransaction(s, tr!, ctx).state;
    return { ok, md: toMarkdown(next.doc), state: next, tr: tr as Transaction | null };
}

// b-0 "a" · b-1 list (b-1.0.0 "b", b-1.1.0 "c") · b-2 hr · b-3 code "code" · b-4 "d"
const MIXED = 'a\n\n- b\n- c\n\n---\n\n```\ncode\n```\n\nde';
// b-0 "a" · b-1 table (b-1.0.0 "x", b-1.1.0 "y") · b-2 "b"
const TABLE = 'a\n\n| x |\n| - |\n| y |\n\nb';

describe('selection points', () => {
    it('isCrossBlock, textRange and document order', () => {
        const s = state(MIXED);
        expect(isCrossBlock(textSelection('b-0', 0, 1))).toBe(false);
        expect(isCrossBlock(range(pt('b-0', 0), pt('b-4', 1)))).toBe(true);
        expect(isCrossBlock(blockSelection('b-0', 'b-1'))).toBe(false);
        const index = s.index();
        expect(index.position('b-0')).toBe(0);
        expect(index.position('b-1.1.0')).toBeGreaterThan(index.position('b-1.0.0'));
        expect(index.position('nope')).toBe(Infinity);
        expect(comparePoints(index, pt('b-1.0.0', 1), pt('b-2', 0))).toBeLessThan(0);
        expect(comparePoints(index, pt('b-0', 1), pt('b-0', 0))).toBeGreaterThan(0);
        expect(comparePoints(index, pt('b-0', 1), pt('b-0', 1))).toBe(0);
    });

    it('orderedRange puts the ends in document order', () => {
        const s = state(MIXED);
        expect(orderedRange(s, range(pt('b-0', 1), pt('b-4', 1)))).toEqual({ from: pt('b-0', 1), to: pt('b-4', 1), forward: true });
        expect(orderedRange(s, range(pt('b-4', 1), pt('b-0', 1)))).toEqual({ from: pt('b-0', 1), to: pt('b-4', 1), forward: false });
    });
});

describe('rangeBlocks', () => {
    it('lists the covered leaves in document order: partial edges, voids and code whole, containers skipped', () => {
        const expected = [
            { key: 'b-0', role: 'textblock', from: 1, to: 1, whole: false },
            { key: 'b-1.0.0', role: 'textblock', from: 0, to: 1, whole: true },
            { key: 'b-1.1.0', role: 'textblock', from: 0, to: 1, whole: true },
            { key: 'b-2', role: 'void', from: 0, to: 0, whole: true },
            { key: 'b-3', role: 'code', from: 0, to: 4, whole: true },
            { key: 'b-4', role: 'textblock', from: 0, to: 1, whole: false },
        ];
        expect(rangeBlocks(state(MIXED), range(pt('b-0', 1), pt('b-4', 1)), ctx)).toEqual(expected);
        expect(rangeBlocks(state(MIXED), range(pt('b-4', 1), pt('b-0', 1)), ctx)).toEqual(expected);
    });

    it('reports a table as one whole unit', () => {
        expect(rangeBlocks(state(TABLE), range(pt('b-0', 0), pt('b-2', 1)), ctx)).toEqual([
            { key: 'b-0', role: 'textblock', from: 0, to: 1, whole: true },
            { key: 'b-1', role: 'table', from: 0, to: 0, whole: true },
            { key: 'b-2', role: 'textblock', from: 0, to: 1, whole: true },
        ]);
    });

    it('gives one block for a single-block selection', () => {
        expect(rangeBlocks(state(MIXED), textSelection('b-4', 2, 1), ctx)).toEqual([{ key: 'b-4', role: 'textblock', from: 1, to: 2, whole: false }]);
    });
});

describe('normalizeTextRange', () => {
    it('clamps a range that starts in a table cell to that cell', () => {
        const s = state(TABLE);
        expect(normalizeTextRange(s, range(pt('b-1.0.0', 0), pt('b-2', 1)), ctx)).toEqual(range(pt('b-1.0.0', 0), pt('b-1.0.0', 1)));
        expect(normalizeTextRange(s, range(pt('b-1.1.0', 1), pt('b-0', 0)), ctx)).toEqual(range(pt('b-1.1.0', 1), pt('b-1.1.0', 0)));
    });

    it('moves a head that enters a table past it, so the table is covered whole', () => {
        const s = state(TABLE);
        expect(normalizeTextRange(s, range(pt('b-0', 0), pt('b-1.1.0', 0)), ctx)).toEqual(range(pt('b-0', 0), pt('b-2', 0)));
        expect(normalizeTextRange(s, range(pt('b-2', 1), pt('b-1.0.0', 1)), ctx)).toEqual(range(pt('b-2', 1), pt('b-0', 1)));
    });

    it('stops on the near side when nothing editable lies beyond the table', () => {
        const s = state('a\n\n| x |\n| - |\n| y |');
        expect(normalizeTextRange(s, range(pt('b-0', 0), pt('b-1.1.0', 0)), ctx)).toEqual(range(pt('b-0', 0), pt('b-0', 1)));
    });

    it('leaves single-block and table-free ranges alone', () => {
        const s = state(MIXED);
        const single = textSelection('b-0', 0, 1);
        const cross = range(pt('b-0', 0), pt('b-4', 1));
        expect(normalizeTextRange(s, single, ctx)).toBe(single);
        expect(normalizeTextRange(s, cross, ctx)).toBe(cross);
    });
});

describe('mapSelection with two points', () => {
    it('maps each end through edits in its own block', () => {
        const s = state('ab\n\ncd');
        const sel = range(pt('b-0', 1), pt('b-1', 1));
        const steps = [{ type: 'replaceInline' as const, key: 'b-1', from: 0, to: 0, slice: { text: 'XY', spans: [] } }];
        const doc = applyTransaction(s, { steps, selection: sel, meta: { origin: 'command' } }, ctx).state.doc;
        expect(mapSelection(sel, steps, doc, schema)).toEqual(range(pt('b-0', 1), pt('b-1', 3)));
    });

    it('drops the selection when either end block disappears', () => {
        const s = state('ab\n\ncd\n\nef');
        const sel = range(pt('b-0', 1), pt('b-2', 1));
        const steps = [{ type: 'removeBlock' as const, parentKey: null, index: 2 }];
        const doc = applyTransaction(s, { steps, selection: null, meta: { origin: 'command' } }, ctx).state.doc;
        expect(mapSelection(sel, steps, doc, schema)).toBeNull();
    });
});

describe('sequence', () => {
    it('runs two commands as one transaction ending with the second selection', () => {
        const r = run('ab', textSelection('b-0', 1), C.sequence(C.insertText('X'), C.insertText('Y')));
        expect(r.md).toBe('aXYb\n');
        expect(r.tr!.steps).toHaveLength(2);
        expect(r.state.selection).toEqual(textSelection('b-0', 3));
    });

    it('applies only when both commands do', () => {
        const dispatched: Transaction[] = [];
        const s = state('ab', textSelection('b-0', 1));
        expect(C.sequence(C.insertText('X'), C.toggleMark('strong'))(s, (t) => dispatched.push(t), ctx)).toBe(false);
        expect(dispatched).toEqual([]);
    });
});

describe('commands over a cross-block range', () => {
    const cross = range(pt('b-0', 1), pt('b-1', 1));

    it('single-block commands refuse it', () => {
        for (const command of [C.toggleMark('strong'), C.joinTextBackward, C.setLink('u'), C.indentListItem, C.toggleList('bullet'), C.wrapInBlockquote, C.addRowAfter]) {
            expect(run('ab\n\ncd', cross, command).ok).toBe(false);
        }
    });

    it('selectedBlockKeys lifts it to the sibling run at the lowest common parent', () => {
        expect(C.selectedBlockKeys(state('a\n\n- b\n- c\n\nd', range(pt('b-1.1.0', 0), pt('b-0', 1))))).toEqual(['b-0', 'b-1']);
        expect(C.selectedBlockKeys(state('- b\n- c', range(pt('b-0.0.0', 0), pt('b-0.1.0', 1))))).toEqual(['b-0.0', 'b-0.1']);
    });

    it('Escape and Shift-arrows turn it into the block selection of that run, keeping direction', () => {
        expect(run('a\n\n- b\n- c', range(pt('b-0', 0), pt('b-1.1.0', 1)), C.escapeToBlockSelection).state.selection).toEqual(blockSelection('b-0', 'b-1'));
        expect(run('a\n\n- b\n- c', range(pt('b-1.1.0', 1), pt('b-0', 0)), C.extendBlockSelection('down')).state.selection).toEqual(blockSelection('b-1', 'b-0'));
    });

    it('focusNeighbour collapses from the head', () => {
        expect(run('ab\n\ncd\n\nef', range(pt('b-0', 1), pt('b-1', 1)), C.focusNeighbour('down')).state.selection).toEqual(textSelection('b-2', 0));
    });

    it('setBlockType converts every text block of the run and clamps each end in its own block', () => {
        const r = run('ab\n\ncd', range(pt('b-0', 1), pt('b-1', 2)), C.setBlockType('heading', { depth: 2 }));
        expect(r.md).toBe('## ab\n\n## cd\n');
        expect(r.state.selection).toEqual(range(pt('b-0', 1), pt('b-1', 2)));
    });
});

describe('deleteRange (#62)', () => {
    const del = (md: string, a: Point, h: Point) => run(md, range(a, h), C.deleteRange);

    it('joins the two edge text blocks and removes everything between, in either direction', () => {
        const r = del('hello\n\nmid\n\nworld', pt('b-0', 2), pt('b-2', 3));
        expect(r.md).toBe('held\n');
        expect(r.state.selection).toEqual(textSelection('b-0', 2));
        expect(del('hello\n\nmid\n\nworld', pt('b-2', 3), pt('b-0', 2)).md).toBe('held\n');
    });

    it('keeps the marks on both sides of the join', () => {
        expect(del('**bold** x\n\ny *it*', pt('b-0', 2), pt('b-1', 2)).md).toBe('**bo**_it_\n');
    });

    it('removes a fully covered list as one block', () => {
        const r = del('a\n\n- b\n- c\n\nd', pt('b-0', 1), pt('b-2', 0));
        expect(r.md).toBe('ad\n');
        expect(r.state.doc.children).toHaveLength(1);
    });

    it('joins into and out of a list, collapsing the items it empties', () => {
        expect(del('a\n\n- b\n- c', pt('b-0', 1), pt('b-1.0.0', 0)).md).toBe('ab\n\n- c\n');
        expect(del('- a\n- b\n\nc', pt('b-0.0.0', 1), pt('b-1', 0)).md).toBe('- ac\n');
        expect(del('- a\n- b\n- c', pt('b-0.0.0', 1), pt('b-0.1.0', 1)).md).toBe('- a\n- c\n');
    });

    it('trims a code block at an edge instead of joining it', () => {
        const r = del('ab\n\n```\ncode\n```', pt('b-0', 1), pt('b-1', 2));
        expect(r.md).toBe('a\n\n```\nde\n```\n');
        expect(r.state.selection).toEqual(textSelection('b-0', 1));
    });

    it('takes void blocks and whole tables in between', () => {
        expect(del('a\n\n---\n\nb', pt('b-0', 1), pt('b-2', 0)).md).toBe('ab\n');
        expect(del(TABLE, pt('b-0', 1), pt('b-2', 0)).md).toBe('ab\n');
    });

    it('can empty the document down to one empty block', () => {
        const r = del('a\n\nb', pt('b-0', 0), pt('b-1', 1));
        expect(r.state.doc.children).toHaveLength(1);
        expect(r.state.doc.children[0]).toMatchObject({ type: 'paragraph', key: 'b-0', children: [] });
        expect(r.state.selection).toEqual(textSelection('b-0', 0));
    });

    it('is what Backspace, Delete and cut do over a range; refuses a single-block selection', () => {
        const sel = range(pt('b-0', 2), pt('b-1', 3));
        for (const command of [C.joinBackward, C.joinForward, C.cutSelection]) expect(run('hello\n\nworld', sel, command).md).toBe('held\n');
        expect(run('hello', textSelection('b-0', 1, 3), C.deleteRange).ok).toBe(false);
        expect(run('hello', textSelection('b-0', 1, 3), C.cutSelection).md).toBe('hlo\n');
    });
});

describe('editing over a range (#62)', () => {
    const sel = range(pt('b-0', 2), pt('b-1', 3));

    it('typing replaces the range in one transaction, inheriting the marks at its start', () => {
        const r = run('hello\n\nworld', sel, C.insertText('X'));
        expect(r.md).toBe('heXld\n');
        expect(r.state.selection).toEqual(textSelection('b-0', 3));
        expect(r.tr!.meta.group).toBe('typing');
        expect(run('**hello**\n\nworld', sel, C.insertText('X')).md).toBe('**heX**ld\n');
    });

    it('Enter, hard break and atoms act at the collapsed caret', () => {
        const enter = run('hello\n\nworld', sel, C.splitBlock);
        expect(enter.md).toBe('he\n\nld\n');
        expect(enter.state.selection).toEqual(textSelection('b-1', 0));
        expect(run('- ab\n- cd', range(pt('b-0.0.0', 1), pt('b-0.1.0', 1)), C.splitBlock).md).toBe('- a\n- d\n');
        expect(run('ab\n\ncd', range(pt('b-0', 1), pt('b-1', 1)), C.insertHardBreak).md).toBe('a\\\nd\n');
        expect(run('ab\n\ncd', range(pt('b-0', 1), pt('b-1', 1)), C.insertImage('u', 'i')).md).toBe('a![i](u)d\n');
    });

    it('paste replaces the range', () => {
        const r = run('hello\n\nworld', sel, C.paste({ text: 'x\n\ny' }));
        expect(r.md).toBe('hex\n\nyld\n');
        expect(r.tr!.meta.origin).toBe('paste');
    });

    it('one undo restores the range and the text typed over it', () => {
        const e = createEditor({ doc: parseMarkdown('hello\n\nworld'), format: markdownFormat, plugins: [markdownPreset] });
        e.setSelection(sel);
        e.run(C.insertText('X'));
        e.run(C.insertText('Y'));
        expect(toMarkdown(e.state.doc)).toBe('heXYld\n');
        e.undo();
        expect(toMarkdown(e.state.doc)).toBe('hello\n\nworld\n');
        expect(e.state.selection).toEqual(sel);
    });
});

describe('copying a range (#62)', () => {
    const copy = (md: string, sel: EditorSelection) => {
        const root = C.copySelection(state(md, sel), ctx);
        return root && toMarkdown(root);
    };

    it('slices the edge blocks and keeps everything between', () => {
        expect(copy('hello\n\nmid\n\nworld', range(pt('b-0', 2), pt('b-2', 3)))).toBe('llo\n\nmid\n\nwor\n');
        expect(copy('**bold** x\n\nyz', range(pt('b-1', 1), pt('b-0', 2)))).toBe('**ld** x\n\ny\n');
    });

    it('prunes an edge container to its covered children and keeps what a list needs', () => {
        expect(copy('a\n\n- b\n- c\n\nd', range(pt('b-0', 0), pt('b-1.0.0', 1)))).toBe('a\n\n- b\n');
        expect(copy('1. a\n2. b\n3. c', range(pt('b-0.0.0', 0), pt('b-0.1.0', 1)))).toBe('1. a\n2. b\n');
    });

    it('copies code partially and tables whole', () => {
        expect(copy('ab\n\n```\ncode\n```', range(pt('b-0', 1), pt('b-1', 2)))).toBe('b\n\n```\nco\n```\n');
        expect(copy(TABLE, range(pt('b-0', 0), pt('b-2', 1)))).toBe('a\n\n| x |\n| --- |\n| y |\n\nb\n');
    });

    it('covers a single-block selection and a block selection; nothing for a caret', () => {
        expect(copy('hello', textSelection('b-0', 1, 3))).toBe('el\n');
        expect(copy('- a\n- b', blockSelection('b-0.1'))).toBe('- b\n');
        expect(copy('hello', textSelection('b-0', 1))).toBeNull();
        expect(sliceDoc(state('ab\n\ncd'), range(pt('b-0', 1), pt('b-1', 1)), ctx).children.every((c) => !('key' in c))).toBe(true);
    });
});

describe('extendSelectionToNeighbour (#62)', () => {
    it('moves the head into the next / previous editable block, over voids', () => {
        const down = run('ab\n\n---\n\ncd', textSelection('b-0', 1), C.extendSelectionToNeighbour('down'));
        expect(down.state.selection).toEqual(range(pt('b-0', 1), pt('b-2', 0)));
        const up = run('ab\n\ncd', range(pt('b-1', 1), pt('b-1', 1)), C.extendSelectionToNeighbour('up'));
        expect(up.state.selection).toEqual(range(pt('b-1', 1), pt('b-0', 2)));
        expect(run('ab\n\ncd', textSelection('b-0', 1), C.extendSelectionToNeighbour('down', () => 1)).state.selection).toEqual(range(pt('b-0', 1), pt('b-1', 1)));
    });

    it('jumps past a table and stops at the document edge', () => {
        expect(run(TABLE, textSelection('b-0', 0), C.extendSelectionToNeighbour('down')).state.selection).toEqual(range(pt('b-0', 0), pt('b-2', 0)));
        const edge = run('ab\n\ncd', range(pt('b-0', 0), pt('b-1', 0)), C.extendSelectionToNeighbour('down'));
        expect(edge.state.selection).toEqual(range(pt('b-0', 0), pt('b-1', 2)));
        expect(run('ab\n\ncd', range(pt('b-0', 0), pt('b-1', 2)), C.extendSelectionToNeighbour('down')).ok).toBe(false);
    });
});
