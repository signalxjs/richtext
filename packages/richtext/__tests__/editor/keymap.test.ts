import { describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '@sigx/richtext-markdown';
import { toMarkdown } from '@sigx/richtext-markdown';
import { markdownSchema } from '@sigx/richtext-markdown';
import { createState, textSelection } from '../../src/editor/state.js';
import type { EditorSelection } from '../../src/editor/state.js';
import { applyTransaction } from '../../src/editor/transaction.js';
import type { Transaction } from '../../src/editor/transaction.js';
import { commands } from '../../src/editor/registry.js';
import type { Command, CommandContext } from '../../src/editor/commands.js';
import { markdownFormat } from '@sigx/richtext-markdown';
import { baseKeymap, resolveKeymap, runKeymap } from '../../src/editor/keymap.js';
import type { Keymap } from '../../src/editor/keymap.js';

const schema = markdownSchema;
const ctx: CommandContext = { schema, formats: [markdownFormat] };

/** Run a key through a resolved keymap against a document + selection. */
function press(md: string, selection: EditorSelection, name: string, maps: readonly Keymap[] = [baseKeymap]) {
    const state = createState(parseMarkdown(md), selection, schema);
    let tr: Transaction | null = null;
    const result = runKeymap(resolveKeymap(maps), name, state, (t) => (tr = t), ctx);
    const next = tr ? applyTransaction(state, tr, ctx).state : state;
    return { result, md: toMarkdown(next.doc), state: next, tr: tr as Transaction | null };
}

describe('baseKeymap', () => {
    it('resolves every binding to a command or undo/redo', () => {
        const map = resolveKeymap([baseKeymap]);
        expect(map.size).toBe(Object.keys(baseKeymap).length);
        for (const [name, binding] of map) {
            expect(name).toBe(name.trim());
            expect(typeof binding === 'function' || binding === 'undo' || binding === 'redo').toBe(true);
        }
        expect(map.get('Enter')).toBe(commands.splitBlock);
        expect(map.get('Mod-b')).toBe(commands.toggleStrong);
        expect(map.get('Mod-z')).toBe('undo');
        expect(map.get('Mod-Shift-z')).toBe('redo');
        expect(map.get('Mod-y')).toBe('redo');
        expect(map.get('Mod-Alt-3')).toBe(commands.toggleHeading3);
        expect(map.get('Mod-Shift-.')).toBe(commands.wrapInBlockquote);
    });
});

describe('resolveKeymap', () => {
    it('normalises names so differently spelled bindings collide', () => {
        const map = resolveKeymap([{ 'shift-mod-Z': 'undo' }]);
        expect(map.get('Mod-Shift-z')).toBe('undo');
        expect(map.size).toBe(1);
    });

    it('later maps override earlier ones; functions pass through', () => {
        const custom: Command = () => true;
        const map = resolveKeymap([baseKeymap, { 'mod-B': 'toggleEmphasis' }, { 'Mod-b': custom, 'Mod-k': 'redo' }]);
        expect(map.get('Mod-b')).toBe(custom);
        expect(map.get('Mod-k')).toBe('redo');
        expect(map.get('Enter')).toBe(commands.splitBlock);
    });

    it('resolves names through a custom registry (plugin commands) and rejects unknown names', () => {
        const zap: Command = () => true;
        const map = resolveKeymap([{ 'Mod-Shift-m': 'zap' }], { ...commands, zap });
        expect(map.get('Mod-Shift-m')).toBe(zap);
        expect(() => resolveKeymap([{ 'Mod-q': 'nope' }])).toThrow(/Unknown command "nope"/);
    });
});

describe('runKeymap', () => {
    it('dispatches the bound command and reports its result', () => {
        const r = press('hello world', textSelection('b-0', 0, 5), 'Mod-b');
        expect(r.result).toBe(true);
        expect(r.md).toBe('**hello** world\n');
        expect(r.tr!.meta.origin).toBe('command');
    });

    it('accepts an unnormalised name', () => {
        const r = press('hello world', textSelection('b-0', 0, 5), 'ctrl-b', [{ 'Ctrl-b': 'toggleStrong' }]);
        expect(r.md).toBe('**hello** world\n');
    });

    it('returns false for unbound keys and when the command does not apply', () => {
        expect(press('hello', textSelection('b-0', 1), 'F5').result).toBe(false);
        // Leaving a code block when not in one.
        expect(press('hello', textSelection('b-0', 1), 'Mod-Enter').result).toBe(false);
        // Tab outside a list.
        expect(press('hello', textSelection('b-0', 1), 'Tab').result).toBe(false);
    });

    it('hands undo/redo back to the caller without dispatching', () => {
        const dispatch = vi.fn();
        const state = createState(parseMarkdown('x'), textSelection('b-0', 0), schema);
        const map = resolveKeymap([baseKeymap]);
        expect(runKeymap(map, 'Mod-z', state, dispatch, ctx)).toBe('undo');
        expect(runKeymap(map, 'Mod-Shift-z', state, dispatch, ctx)).toBe('redo');
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('runs the structural bindings', () => {
        expect(press('ab', textSelection('b-0', 1), 'Enter').md).toBe('a\n\nb\n');
        expect(press('ab', textSelection('b-0', 1), 'Shift-Enter').md).toBe('a\\\nb\n');
        expect(press('a\n\nb', textSelection('b-1', 0), 'Backspace').md).toBe('ab\n');
        expect(press('a\n\nb', textSelection('b-0', 1), 'Delete').md).toBe('ab\n');
        expect(press('- a\n- b', textSelection('b-0.1.0', 0), 'Tab').md).toBe('- a\n  - b\n');
        expect(press('- a\n  - b', textSelection('b-0.0.1.0.0', 0), 'Shift-Tab').md).toBe('- a\n- b\n');
        expect(press('x', textSelection('b-0', 0), 'Mod-Alt-2').md).toBe('## x\n');
        expect(press('## x', textSelection('b-0', 0), 'Mod-Alt-0').md).toBe('x\n');
        expect(press('x', textSelection('b-0', 0), 'Mod-Shift-8').md).toBe('- x\n');
        expect(press('x', textSelection('b-0', 0), 'Mod-Shift-7').md).toBe('1. x\n');
        expect(press('x', textSelection('b-0', 0), 'Mod-Shift-9').md).toBe('- [ ] x\n');
        expect(press('x', textSelection('b-0', 0), 'Mod-Shift-.').md).toBe('> x\n');
        expect(press('```\nx\n```', textSelection('b-0', 1), 'Mod-Enter').state.doc.children.map((c) => c.type)).toEqual(['code', 'paragraph']);
    });

    it('runs the selection bindings', () => {
        expect(press('a\n\nb', textSelection('b-0', 1), 'Escape').state.selection).toEqual({ mode: 'block', anchorKey: 'b-0', headKey: 'b-0' });
        expect(press('a\n\nb', textSelection('b-0', 1), 'Mod-a').state.selection).toEqual({ mode: 'block', anchorKey: 'b-0', headKey: 'b-1' });
        expect(press('a\n\nb', textSelection('b-0', 1), 'ArrowDown').state.selection).toEqual(textSelection('b-1', 0));
        expect(press('a\n\nb', textSelection('b-1', 0), 'ArrowUp').state.selection).toEqual(textSelection('b-0', 1));
        expect(press('a\n\nb', textSelection('b-0', 1), 'Shift-ArrowDown').state.selection).toEqual({ mode: 'block', anchorKey: 'b-0', headKey: 'b-0' });
    });
});
