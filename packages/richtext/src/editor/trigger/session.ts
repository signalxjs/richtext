/**
 * Trigger sessions — the state machine behind a suggestion popup (`@`
 * mentions, `::` commands, `/` block menus).
 *
 * The session is a pure function of two streams the view already has: the
 * text of the block the caret is in and the collapsed caret offset. On every
 * sync we look at the **run** — the non-whitespace text between the last
 * boundary and the caret. A run starting with a trigger (`@` / a pattern
 * match) means an active session whose query is the rest of the run;
 * anything else means no session. Whitespace, caret exits, a block change,
 * blur and a non-collapsed selection all close it for free, because they
 * all change the run. A trigger char inside a literal mark (inline code)
 * never opens a session: the host passes the block's spans with the text.
 *
 * `onQuery` may be async: results are tagged with an epoch and discarded when
 * a newer query (or a close) supersedes them. An optional per-trigger
 * `debounce` batches fast typing.
 */

import type { Command, Dispatch } from '../commands.js';
import type { commands } from '../registry.js';
import type { InlineFlat, InlineSpan } from '../inline-flat.js';
import type { EditorState } from '../state.js';

/** One entry in a trigger session's result list. */
export interface TriggerItem {
    id: string;
    label: string;
    [key: string]: unknown;
}

/** What `onSelect` receives to act on the editor. The view fills it in. */
export interface TriggerSelectApi {
    /**
     * Replace the whole trigger run (trigger char/prefix + query) with
     * `slice`, leaving the caret after it. Sessions are re-derived from
     * `(text, caret)`, so end the replacement with a boundary (usually a
     * trailing space) — otherwise text that still forms a trigger run at the
     * caret immediately re-opens the session.
     */
    replaceQuery(slice: InlineFlat): void;
    /** The block and `[from, to)` range of the trigger run. */
    range: { key: string; from: number; to: number };
    commands: typeof commands;
    dispatch: Dispatch;
    state: EditorState;
    /** Run a command (or a registered name) against the editor; its result. */
    run(command: Command | string): boolean;
}

interface TriggerSpecBase {
    /** Debounce between `onQuery` calls in ms. `0`/omitted = immediate. */
    debounce?: number;
    /**
     * Resolve suggestions for the current query (the text typed after the
     * trigger). May be async — stale results (a newer query has since been
     * issued, or the session closed) are discarded.
     */
    onQuery(query: string): TriggerItem[] | Promise<TriggerItem[]>;
    /** A suggestion was picked. Typically calls `api.replaceQuery(...)`. */
    onSelect(item: TriggerItem, api: TriggerSelectApi): void;
}

/** Exactly one of `char` / `pattern` — enforced by the union. */
export type TriggerSpec =
    | (TriggerSpecBase & {
          /** Single trigger character (`'@'`). */
          char: string;
          pattern?: undefined;
      })
    | (TriggerSpecBase & {
          char?: undefined;
          /**
           * Multi-char trigger: matched against the run of non-whitespace text
           * between the last boundary and the caret; must match at its start
           * (e.g. `/^::/`). The match length is the trigger length; what
           * follows is the query.
           */
          pattern: RegExp;
      });

export interface TriggerSession {
    /** Owning plugin's name. */
    plugin: string;
    /** The block the session lives in. */
    key: string;
    /** Offset of the trigger char (run start) in the block text. */
    anchor: number;
    /** Text typed after the trigger prefix. */
    query: string;
    /** Caret offset (exclusive end of the run). */
    caret: number;
    /** Latest resolved suggestions ([] while loading or empty). */
    items: TriggerItem[];
    /** True while an async `onQuery` for the current query is in flight. */
    loading: boolean;
}

export interface TriggerSessionManager {
    /**
     * Feed the latest text of block `key`, plus its mark spans when the host
     * has them (they keep a trigger inside inline code from opening). A
     * different key than the last sync closes any session.
     */
    syncText(key: string, text: string, spans?: readonly InlineSpan[]): void;
    /** Feed the collapsed caret offset in block `key`; `-1` = no collapsed caret. */
    syncCaret(key: string, caret: number): void;
    /** Close the active session (blur, selection made, escape). */
    close(): void;
    readonly session: TriggerSession | null;
}

export interface TriggerSessionManagerOptions {
    triggers: ReadonlyArray<{ plugin: string; spec: TriggerSpec }>;
    /**
     * Whether a mark type is literal (nothing is parsed inside it, e.g.
     * `inlineCode`); a trigger char covered by such a span opens no session.
     * The DOM host answers from the schema (`spec.inline.literal`).
     */
    isLiteral?(type: string): boolean;
    /** Fired whenever the session opens, updates (query/items), or closes. */
    onUpdate(session: TriggerSession | null): void;
}

/** Trigger-prefix length when `run` starts with this trigger, else `-1`. */
function matchTrigger(spec: TriggerSpec, run: string): number {
    if (spec.char !== undefined) {
        return run.startsWith(spec.char) ? spec.char.length : -1;
    }
    if (spec.pattern) {
        // Reset stateful lastIndex (g/y flags) so matching is deterministic.
        spec.pattern.lastIndex = 0;
        const m = spec.pattern.exec(run);
        return m && m.index === 0 ? m[0].length : -1;
    }
    return -1;
}

export function createTriggerSessionManager(opts: TriggerSessionManagerOptions): TriggerSessionManager {
    let key: string | null = null;
    let text = '';
    let spans: readonly InlineSpan[] = [];
    let caret = -1;
    let session: TriggerSession | null = null;
    /** Bumped on every query change/close; stale async results check it. */
    let epoch = 0;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = (): void => {
        if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
    };

    const emit = (): void => {
        opts.onUpdate(session ? { ...session, items: [...session.items] } : null);
    };

    const close = (): void => {
        if (!session) return;
        epoch++;
        clearTimer();
        session = null;
        emit();
    };

    const runQuery = (spec: TriggerSpec): void => {
        if (!session) return;
        const myEpoch = ++epoch;
        const query = session.query;
        const exec = (): void => {
            debounceTimer = null;
            if (epoch !== myEpoch || !session) return;
            let result: ReturnType<typeof spec.onQuery>;
            try {
                result = spec.onQuery(query);
            } catch {
                // A throwing onQuery behaves like a rejected async query.
                session.items = [];
                session.loading = false;
                emit();
                return;
            }
            if (Array.isArray(result)) {
                session.items = result;
                session.loading = false;
                emit();
                return;
            }
            // Guard non-thenable returns from misbehaving plugins — treat
            // them like an empty result instead of throwing on .then.
            if (!result || typeof result.then !== 'function') {
                session.items = [];
                session.loading = false;
                emit();
                return;
            }
            result.then(
                (items) => {
                    // Discard stale resolutions: a newer query or a close won.
                    if (epoch !== myEpoch || !session) return;
                    session.items = items;
                    session.loading = false;
                    emit();
                },
                () => {
                    if (epoch !== myEpoch || !session) return;
                    session.items = [];
                    session.loading = false;
                    emit();
                },
            );
        };
        clearTimer();
        if (spec.debounce && spec.debounce > 0) {
            debounceTimer = setTimeout(exec, spec.debounce);
        } else {
            exec();
        }
    };

    const evaluate = (): void => {
        if (key === null || caret < 0 || caret > text.length) {
            close();
            return;
        }
        // The run: non-whitespace text between the last boundary and the caret.
        let start = caret;
        while (start > 0 && !/\s/.test(text[start - 1])) start--;
        const run = text.slice(start, caret);
        const isLiteral = opts.isLiteral;
        if (isLiteral && start < caret && spans.some((s) => s.start <= start && start < s.end && isLiteral(s.type))) {
            close();
            return;
        }

        for (const { plugin, spec } of opts.triggers) {
            const prefixLen = matchTrigger(spec, run);
            if (prefixLen < 0) continue;
            const query = run.slice(prefixLen);
            if (session && session.plugin === plugin && session.key === key && session.anchor === start) {
                session.caret = caret;
                if (session.query !== query) {
                    session.query = query;
                    // Clear stale results: the popup must never offer the
                    // previous query's suggestions while the new one resolves.
                    session.items = [];
                    session.loading = true;
                    emit();
                    runQuery(spec);
                }
                return;
            }
            session = { plugin, key, anchor: start, query, caret, items: [], loading: true };
            emit();
            runQuery(spec);
            return;
        }
        close();
    };

    /** A sync for another block: the previous block's other stream is stale until it is synced too. */
    const switchTo = (next: string): void => {
        if (key === next) return;
        key = next;
        text = '';
        spans = [];
        caret = -1;
        close();
    };

    return {
        syncText: (k, t, s) => {
            switchTo(k);
            text = t ?? '';
            spans = s ?? [];
            evaluate();
        },
        syncCaret: (k, c) => {
            switchTo(k);
            caret = c;
            evaluate();
        },
        close,
        get session() {
            // Snapshot — mutating the returned object must not desync internal
            // state or bypass onUpdate (which also emits clones).
            return session ? { ...session, items: [...session.items] } : null;
        },
    };
}
