/**
 * Input rules — shortcuts that fire as you type. A rule matches the text
 * before the caret after a typing transaction ends in one of its trigger
 * characters and answers with a follow-up transaction tagged
 * `origin: 'inputRule'`, which the history keeps as its own entry so
 * Backspace right after can undo just the rule (see `isInputRuleEntry`).
 * Enter never reaches a rule as text, so `EnterRule`s match the whole block
 * and the editor consults them before `splitBlock`.
 *
 * The core ships no rules: a format's editor preset does (`markdownPreset`
 * turns `# `, `**x**`, a fence line … into structure).
 */

import type { CommandContext } from './commands.js';
import type { InlineFlat } from './inline-flat.js';
import { marksAt } from './inline-flat.js';
import type { EditorState } from './state.js';
import { flatOf } from './steps.js';
import type { Transaction } from './transaction.js';

export interface InputRuleContext {
    state: EditorState;
    /** The block the caret is in. */
    key: string;
    /** The block's flat model, after the typed text. */
    flat: InlineFlat;
    /** Where the match starts (`m.index`). */
    from: number;
    /** The caret (exclusive end of the match). */
    to: number;
    ctx: CommandContext;
}

export interface InputRule {
    name: string;
    /** `blockStart` rules match the whole text from the block start to the caret; `inline` rules match a suffix of it. */
    scope: 'blockStart' | 'inline';
    /** The characters that, typed last, make the editor try this rule. */
    triggers: readonly string[];
    match: RegExp;
    /** Block types the rule applies in (default: the schema's default block for `blockStart`, any text block for `inline`). */
    blockTypes?: string[];
    handler(rc: InputRuleContext, m: RegExpMatchArray): Transaction | null;
}

/** A rule the editor consults on Enter: it matches the whole text of the block. */
export interface EnterRule {
    name: string;
    match: RegExp;
    /** Default: the schema's default block. */
    blockTypes?: string[];
    handler(rc: InputRuleContext, m: RegExpMatchArray): Transaction | null;
}

const triggerCache = new WeakMap<readonly InputRule[], ReadonlySet<string>>();

/** The union of the rules' trigger characters (memoised per rule array). */
export function triggerChars(rules: readonly InputRule[]): ReadonlySet<string> {
    let set = triggerCache.get(rules);
    if (!set) {
        set = new Set(rules.flatMap((r) => r.triggers));
        triggerCache.set(rules, set);
    }
    return set;
}

function appliesTo(rule: { scope?: 'blockStart' | 'inline'; blockTypes?: string[] }, type: string, ctx: CommandContext): boolean {
    if (rule.blockTypes) return rule.blockTypes.includes(type);
    if (rule.scope === 'inline') return ctx.schema.role(type) === 'textblock';
    return type === ctx.schema.defaultBlock;
}

/**
 * Try the rules against the state a typing transaction produced. `tr` must
 * be a single `replaceInline` step from a surface or a command whose text
 * ends in a trigger character, with the caret right after it. Returns the
 * follow-up transaction of the first rule that fires, or `null`.
 */
export function applyInputRules(rules: readonly InputRule[], tr: Transaction, state: EditorState, ctx: CommandContext): Transaction | null {
    if (!rules.length || tr.steps.length !== 1) return null;
    const step = tr.steps[0];
    if (step.type !== 'replaceInline') return null;
    if (tr.meta.origin !== 'surface' && tr.meta.origin !== 'command') return null;
    const typed = step.slice.text;
    if (!typed || !triggerChars(rules).has(typed[typed.length - 1])) return null;
    const caret = step.from + typed.length;
    const sel = state.selection;
    if (!sel || sel.mode !== 'text' || sel.anchor.key !== step.key || sel.head.key !== step.key || sel.anchor.offset !== caret || sel.head.offset !== caret) return null;
    const entry = state.index().get(step.key);
    if (!entry || ctx.schema.role(entry.node.type) !== 'textblock') return null;
    const flat = flatOf(entry.node, ctx);
    if (caret > flat.text.length) return null;
    // Never inside a literal mark (inline code).
    if (marksAt(flat, caret, caret, ctx.schema).some((m) => ctx.schema.get(m)?.inline?.literal)) return null;
    const text = flat.text.slice(0, caret);

    for (const rule of rules) {
        if (!appliesTo(rule, entry.node.type, ctx)) continue;
        rule.match.lastIndex = 0;
        const m = rule.match.exec(text);
        if (!m) continue;
        const end = m.index + m[0].length;
        if (rule.scope === 'blockStart' ? m.index !== 0 || end !== text.length : end !== text.length) continue;
        const out = rule.handler({ state, key: step.key, flat, from: m.index, to: caret, ctx }, m);
        if (out) return out;
    }
    return null;
}

/** Try the Enter rules: a collapsed caret at the end of a default block whose whole text matches. */
export function applyEnterRules(state: EditorState, ctx: CommandContext, rules: readonly EnterRule[]): Transaction | null {
    if (!rules.length) return null;
    const sel = state.selection;
    if (!sel || sel.mode !== 'text' || sel.anchor.key !== sel.head.key || sel.anchor.offset !== sel.head.offset) return null;
    const key = sel.anchor.key;
    const entry = state.index().get(key);
    if (!entry || ctx.schema.role(entry.node.type) !== 'textblock') return null;
    const flat = flatOf(entry.node, ctx);
    if (sel.anchor.offset !== flat.text.length) return null;
    const text = flat.text;
    for (const rule of rules) {
        if (!appliesTo(rule, entry.node.type, ctx)) continue;
        rule.match.lastIndex = 0;
        const m = rule.match.exec(text);
        if (!m || m.index !== 0 || m[0].length !== text.length) continue;
        const out = rule.handler({ state, key, flat, from: 0, to: text.length, ctx }, m);
        if (out) return out;
    }
    return null;
}

/** Whether a history entry was produced by an input rule (Backspace right after undoes just that entry). */
export function isInputRuleEntry(entry: { inputRule?: string } | null | undefined): boolean {
    return !!entry?.inputRule;
}
