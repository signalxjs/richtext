import { describe, expect, it } from 'vitest';
import { markdownFormat, markdownSchema, parseMarkdown, toMarkdown } from '@sigx/richtext-markdown';
import { createState, blockSelection, comparePoints, isCrossBlock, textRange, textSelection } from '../../src/editor/state.js';
import type { EditorSelection, Point } from '../../src/editor/state.js';
import { normalizeTextRange, orderedRange, rangeBlocks } from '../../src/editor/range.js';
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
        for (const command of [C.insertText('X'), C.toggleMark('strong'), C.splitTextBlock, C.joinTextBackward, C.insertHardBreak, C.setLink('u'), C.indentListItem, C.toggleList('bullet'), C.wrapInBlockquote, C.addRowAfter]) {
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
