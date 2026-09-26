import { describe, expect, it, vi } from 'vitest';
import { createTriggerSessionManager } from '../../../src/editor/trigger/session.js';
import type { TriggerItem, TriggerSession } from '../../../src/editor/trigger/session.js';

const USERS: TriggerItem[] = [
    { id: 'u1', label: 'Andy' },
    { id: 'u2', label: 'Bea' },
];

function makeManager(overrides: Partial<Parameters<typeof createTriggerSessionManager>[0]> = {}) {
    const updates: Array<TriggerSession | null> = [];
    const onQuery = vi.fn((q: string) => USERS.filter((u) => u.label.toLowerCase().startsWith(q.toLowerCase())));
    const manager = createTriggerSessionManager({
        triggers: [{ plugin: 'mention', spec: { char: '@', onQuery, onSelect: () => {} } }],
        onUpdate: (s) => updates.push(s),
        ...overrides,
    });
    return { manager, updates, onQuery };
}

describe('trigger session manager', () => {
    it('opens on a trigger char at a boundary and tracks the query', () => {
        const { manager, onQuery } = makeManager();
        manager.syncText('b-0', 'hi @');
        manager.syncCaret('b-0', 4);
        expect(manager.session).toMatchObject({ plugin: 'mention', key: 'b-0', anchor: 3, query: '' });

        manager.syncText('b-0', 'hi @an');
        manager.syncCaret('b-0', 6);
        expect(manager.session).toMatchObject({ query: 'an', caret: 6 });
        expect(onQuery).toHaveBeenLastCalledWith('an');
        expect(manager.session!.items).toEqual([{ id: 'u1', label: 'Andy' }]);
    });

    describe('literal marks (#17)', () => {
        const isLiteral = (type: string): boolean => type === 'inlineCode';
        // Flat text of `` `@` `` followed by typed text: the code span covers [0, 1).
        const code = [{ start: 0, end: 1, type: 'inlineCode' }];

        it('does not open when the trigger char sits inside a literal span', () => {
            const { manager, onQuery } = makeManager({ isLiteral });
            manager.syncText('b-0', '@an', code);
            manager.syncCaret('b-0', 3);
            expect(manager.session).toBeNull();
            expect(onQuery).not.toHaveBeenCalled();
        });

        it('closes an open session when the trigger char becomes literal', () => {
            const { manager } = makeManager({ isLiteral });
            manager.syncText('b-0', '@an', []);
            manager.syncCaret('b-0', 3);
            expect(manager.session).not.toBeNull();
            manager.syncText('b-0', '@an', [{ start: 0, end: 3, type: 'inlineCode' }]);
            expect(manager.session).toBeNull();
        });

        it('opens on a trigger char just outside the literal span', () => {
            const { manager } = makeManager({ isLiteral });
            manager.syncText('b-0', 'x @an', [{ start: 0, end: 1, type: 'inlineCode' }]);
            manager.syncCaret('b-0', 5);
            expect(manager.session).toMatchObject({ anchor: 2, query: 'an' });
        });

        it('ignores non-literal marks over the trigger char', () => {
            const { manager } = makeManager({ isLiteral });
            manager.syncText('b-0', '@an', [{ start: 0, end: 3, type: 'strong' }]);
            manager.syncCaret('b-0', 3);
            expect(manager.session).not.toBeNull();
        });

        it('behaves as before without spans or without an isLiteral predicate', () => {
            const a = makeManager({ isLiteral });
            a.manager.syncText('b-0', '@an');
            a.manager.syncCaret('b-0', 3);
            expect(a.manager.session).not.toBeNull();
            const b = makeManager();
            b.manager.syncText('b-0', '@an', code);
            b.manager.syncCaret('b-0', 3);
            expect(b.manager.session).not.toBeNull();
        });
    });

    it('does not open mid-word (no boundary before the trigger)', () => {
        const { manager } = makeManager();
        manager.syncText('b-0', 'email@');
        manager.syncCaret('b-0', 6);
        expect(manager.session).toBeNull();
    });

    it('closes when whitespace breaks the run', () => {
        const { manager } = makeManager();
        manager.syncText('b-0', '@an');
        manager.syncCaret('b-0', 3);
        expect(manager.session).not.toBeNull();

        manager.syncText('b-0', '@an ');
        manager.syncCaret('b-0', 4);
        expect(manager.session).toBeNull();
    });

    it('closes when the caret leaves the run (or is not collapsed)', () => {
        const { manager } = makeManager();
        manager.syncText('b-0', '@an tail');
        manager.syncCaret('b-0', 3);
        expect(manager.session).not.toBeNull();

        manager.syncCaret('b-0', 8); // caret after ' tail' — run no longer matches
        expect(manager.session).toBeNull();

        manager.syncCaret('b-0', 3);
        expect(manager.session).not.toBeNull();
        manager.syncCaret('b-0', -1); // selection expanded
        expect(manager.session).toBeNull();
    });

    it('closes when the caret moves to another block, whichever stream reports it first', () => {
        const { manager, updates } = makeManager();
        manager.syncText('b-0', '@an');
        manager.syncCaret('b-0', 3);
        expect(manager.session).not.toBeNull();

        // The caret lands in another block before its text is synced: the
        // stale text of b-0 must not keep (or re-open) the session.
        manager.syncCaret('b-1', 3);
        expect(manager.session).toBeNull();
        expect(updates[updates.length - 1]).toBeNull();
        manager.syncText('b-1', 'x y');
        expect(manager.session).toBeNull();

        // A trigger in the new block opens a fresh session keyed to it.
        manager.syncText('b-1', 'x @b');
        manager.syncCaret('b-1', 4);
        expect(manager.session).toMatchObject({ key: 'b-1', anchor: 2, query: 'b' });

        // Text for another block arriving first: the old caret is not reused.
        manager.syncText('b-0', 'hi @');
        expect(manager.session).toBeNull();
        manager.syncCaret('b-0', 4);
        expect(manager.session).toMatchObject({ key: 'b-0', anchor: 3 });
    });

    it('returns session snapshots — external mutation cannot desync state', () => {
        const { manager } = makeManager();
        manager.syncText('b-0', '@a');
        manager.syncCaret('b-0', 2);
        const snapshot = manager.session!;
        snapshot.items.push({ id: 'rogue', label: 'Rogue' });
        snapshot.query = 'mutated';
        expect(manager.session).toMatchObject({ query: 'a' });
        expect(manager.session!.items).toEqual([{ id: 'u1', label: 'Andy' }]);
    });

    it('closes on close() (blur / selection made)', () => {
        const { manager, updates } = makeManager();
        manager.syncText('b-0', '@a');
        manager.syncCaret('b-0', 2);
        manager.close();
        expect(manager.session).toBeNull();
        expect(updates[updates.length - 1]).toBeNull();
    });

    it('supports pattern triggers (multi-char prefix)', () => {
        const onQuery = vi.fn(() => [] as TriggerItem[]);
        const manager = createTriggerSessionManager({
            triggers: [{ plugin: 'cmd', spec: { pattern: /^::/, onQuery, onSelect: () => {} } }],
            onUpdate: () => {},
        });
        manager.syncText('b-0', ':x');
        manager.syncCaret('b-0', 2);
        expect(manager.session).toBeNull(); // single ':' is not the trigger

        manager.syncText('b-0', '::sm');
        manager.syncCaret('b-0', 4);
        expect(manager.session).toMatchObject({ plugin: 'cmd', anchor: 0, query: 'sm' });
    });

    it('matches g-flag patterns deterministically (lastIndex reset)', () => {
        const manager = createTriggerSessionManager({
            triggers: [{ plugin: 'cmd', spec: { pattern: /^::/g, onQuery: () => [], onSelect: () => {} } }],
            onUpdate: () => {},
        });
        // Without a lastIndex reset, the second exec on a g-flag regex would
        // start past the prefix and fail every other evaluation.
        for (let i = 0; i < 3; i++) {
            manager.syncText('b-0', '::a');
            manager.syncCaret('b-0', 3);
            expect(manager.session).not.toBeNull();
            manager.close();
        }
    });

    it('treats a non-thenable onQuery return like an empty result', () => {
        const { manager } = makeManager({
            triggers: [{
                plugin: 'mention',
                // Misbehaving plugin: returns neither an array nor a Promise.
                spec: { char: '@', onQuery: () => ({} as unknown as TriggerItem[]), onSelect: () => {} },
            }],
        });
        manager.syncText('b-0', '@a');
        manager.syncCaret('b-0', 2);
        expect(manager.session).toMatchObject({ items: [], loading: false });
    });

    it('treats a throwing onQuery like a rejected query (loading cleared)', () => {
        const { manager } = makeManager({
            triggers: [{
                plugin: 'mention',
                spec: {
                    char: '@',
                    onQuery: () => {
                        throw new Error('plugin bug');
                    },
                    onSelect: () => {},
                },
            }],
        });
        manager.syncText('b-0', '@a');
        manager.syncCaret('b-0', 2);
        expect(manager.session).toMatchObject({ items: [], loading: false });
    });

    it('clears previous results when the query changes (no stale suggestions)', () => {
        const { manager } = makeManager();
        manager.syncText('b-0', '@a');
        manager.syncCaret('b-0', 2);
        expect(manager.session!.items).toHaveLength(1); // Andy

        manager.syncText('b-0', '@az');
        manager.syncCaret('b-0', 3);
        expect(manager.session!.items).toEqual([]);
    });

    it('discards stale async results when a newer query supersedes them', async () => {
        const resolvers: Array<(items: TriggerItem[]) => void> = [];
        const onQuery = vi.fn(() => new Promise<TriggerItem[]>((resolve) => resolvers.push(resolve)));
        const { manager } = makeManager({
            triggers: [{ plugin: 'mention', spec: { char: '@', onQuery, onSelect: () => {} } }],
        });

        manager.syncText('b-0', '@a');
        manager.syncCaret('b-0', 2);
        manager.syncText('b-0', '@an');
        manager.syncCaret('b-0', 3);
        expect(resolvers).toHaveLength(2);
        expect(manager.session).toMatchObject({ loading: true });

        // The OLD query resolves last — its result must be discarded.
        resolvers[1]([{ id: 'u1', label: 'Andy' }]);
        resolvers[0]([{ id: 'zzz', label: 'Stale' }]);
        await Promise.resolve();

        expect(manager.session!.items).toEqual([{ id: 'u1', label: 'Andy' }]);
        expect(manager.session!.loading).toBe(false);
    });

    it('a rejected async query clears loading with no items', async () => {
        const { manager } = makeManager({
            triggers: [{ plugin: 'mention', spec: { char: '@', onQuery: () => Promise.reject(new Error('offline')), onSelect: () => {} } }],
        });
        manager.syncText('b-0', '@a');
        manager.syncCaret('b-0', 2);
        await Promise.resolve();
        await Promise.resolve();
        expect(manager.session).toMatchObject({ items: [], loading: false });
    });

    it('discards async results that resolve after the session closed', async () => {
        let resolveQuery!: (items: TriggerItem[]) => void;
        const onQuery = vi.fn(() => new Promise<TriggerItem[]>((r) => { resolveQuery = r; }));
        const { manager, updates } = makeManager({
            triggers: [{ plugin: 'mention', spec: { char: '@', onQuery, onSelect: () => {} } }],
        });

        manager.syncText('b-0', '@a');
        manager.syncCaret('b-0', 2);
        manager.close();
        resolveQuery([{ id: 'u1', label: 'Andy' }]);
        await Promise.resolve();

        expect(manager.session).toBeNull();
        expect(updates[updates.length - 1]).toBeNull();
    });

    it('debounces onQuery while typing fast', () => {
        vi.useFakeTimers();
        try {
            const onQuery = vi.fn(() => [] as TriggerItem[]);
            const { manager } = makeManager({
                triggers: [{ plugin: 'mention', spec: { char: '@', debounce: 50, onQuery, onSelect: () => {} } }],
            });
            manager.syncText('b-0', '@a');
            manager.syncCaret('b-0', 2);
            manager.syncText('b-0', '@an');
            manager.syncCaret('b-0', 3);
            expect(onQuery).not.toHaveBeenCalled();

            vi.advanceTimersByTime(60);
            expect(onQuery).toHaveBeenCalledTimes(1);
            expect(onQuery).toHaveBeenCalledWith('an');
        } finally {
            vi.useRealTimers();
        }
    });

    it('a close cancels a pending debounced query', () => {
        vi.useFakeTimers();
        try {
            const onQuery = vi.fn(() => [] as TriggerItem[]);
            const { manager } = makeManager({
                triggers: [{ plugin: 'mention', spec: { char: '@', debounce: 50, onQuery, onSelect: () => {} } }],
            });
            manager.syncText('b-0', '@a');
            manager.syncCaret('b-0', 2);
            manager.close();
            vi.advanceTimersByTime(60);
            expect(onQuery).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('the first matching trigger wins', () => {
        const a = vi.fn(() => [] as TriggerItem[]);
        const b = vi.fn(() => [] as TriggerItem[]);
        const manager = createTriggerSessionManager({
            triggers: [
                { plugin: 'a', spec: { char: '@', onQuery: a, onSelect: () => {} } },
                { plugin: 'b', spec: { pattern: /^@@/, onQuery: b, onSelect: () => {} } },
            ],
            onUpdate: () => {},
        });
        manager.syncText('b-0', '@@x');
        manager.syncCaret('b-0', 3);
        expect(manager.session).toMatchObject({ plugin: 'a', query: '@x' });
        expect(b).not.toHaveBeenCalled();
    });
});
