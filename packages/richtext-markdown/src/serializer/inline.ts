/**
 * Inline (phrasing) serialization, plus the pieces every level shares: the
 * serializer state, the plugin-rule runner and the unknown-node fallback.
 *
 * Emphasis delimiters: the option (`*` by default) is used unless the
 * emphasis would touch the same character — its content starts/ends with it
 * (`*` around `**strong**`), it is the first/last child of a strong made of
 * it, or a sibling's output ends/starts with it — in which case the other
 * character is used so no ambiguous `***` run is ever produced. One
 * exception: `_` cannot open or close inside a word, so when the switch
 * would land a `_` against a letter or digit the `*` is kept (`foo***bar***baz`
 * is unambiguous to CommonMark: em > strong).
 */

import type { Delete, Emphasis, Image, ImageReference, InlineCode, Link, LinkReference, Literal, Node, Parent, Strong, Text } from '@sigx/richtext';
import { isUnicodeWhitespace } from '@sigx/richtext';
import type { SerializeContext, SerializeRule } from '../plugin/markdown.js';
import { escapeLabel, escapeLinkDest, escapeText, longestRun, quoteTitle } from './escape.js';
import type { ToMarkdownOptions } from './to-markdown.js';

export type SerializerOptions = Required<Omit<ToMarkdownOptions, 'plugins'>>;

/** Per-call serializer state; the cross-level functions are wired by `toMarkdown`. */
export interface State {
    readonly options: SerializerOptions;
    /** The options object `toMarkdown` was called with, handed to plugin rules. */
    readonly raw: Readonly<Record<string, unknown>>;
    readonly rules: ReadonlyMap<string, SerializeRule>;
    /** Prefix the enclosing containers apply to continuation lines (informational for plugin rules). */
    indent: string;
    /** Serialize any node (built-in, plugin rule or fallback). */
    serialize(node: Node): string;
    /** Serialize block siblings joined by blank lines. */
    serializeBlocks(nodes: readonly Node[]): string;
}

/** The built-in phrasing types. */
export const PHRASING_TYPES: ReadonlySet<string> = new Set([
    'text',
    'emphasis',
    'strong',
    'delete',
    'inlineCode',
    'break',
    'link',
    'image',
    'linkReference',
    'imageReference',
]);

/** The built-in block types that force block joining for a parent's children. */
export const BLOCK_TYPES: ReadonlySet<string> = new Set([
    'paragraph',
    'heading',
    'thematicBreak',
    'blockquote',
    'list',
    'listItem',
    'code',
    'definition',
    'table',
    'tableRow',
    'tableCell',
]);

const ALNUM = /[\p{L}\p{N}]/u;

function isAlnum(ch: string | undefined): boolean {
    return ch !== undefined && ALNUM.test(ch);
}

function otherEmphasis(ch: string): string {
    return ch === '*' ? '_' : '*';
}

/** Last character of the nearest non-empty part before `i`, else `fallback`. */
function edgeBefore(parts: readonly string[], i: number, fallback: string | undefined): string | undefined {
    for (let j = i - 1; j >= 0; j--) if (parts[j] !== '') return parts[j][parts[j].length - 1];
    return fallback;
}

/** First character of the nearest non-empty part after `i`, else `fallback`. */
function edgeAfter(parts: readonly string[], i: number, fallback: string | undefined): string | undefined {
    for (let j = i + 1; j < parts.length; j++) if (parts[j] !== '') return parts[j][0];
    return fallback;
}

/** The marks whose delimiters must not touch whitespace on the inside. */
const FLANKED: ReadonlySet<string> = new Set(['emphasis', 'strong', 'delete']);

/** Leading / trailing CommonMark Unicode whitespace (the parser's flanking definition). */
function leadingWhitespace(value: string): string {
    let i = 0;
    while (i < value.length && isUnicodeWhitespace(value[i])) i++;
    return value.slice(0, i);
}

function trailingWhitespace(value: string): string {
    let i = value.length;
    while (i > 0 && isUnicodeWhitespace(value[i - 1])) i--;
    return value.slice(i);
}

/**
 * Move whitespace at the inner edges of emphasis / strong / delete out to
 * sibling text: a delimiter run preceded (closing) or followed (opening) by
 * whitespace is not right/left-flanking, so `**world **` would not re-parse
 * as strong. A mark left holding nothing is dropped. Nested marks are hoisted
 * first, so their whitespace moves out through the enclosing mark. Returns
 * `children` itself when nothing changes; the input is never mutated.
 */
function hoistMarkWhitespace(children: readonly Node[], state: State): readonly Node[] {
    let out: Node[] | null = null;
    for (let i = 0; i < children.length; i++) {
        const node = children[i];
        const hoisted = FLANKED.has(node.type) && !state.rules.has(node.type) ? hoistMark(node as Parent, state) : null;
        if (hoisted === null) {
            out?.push(node);
            continue;
        }
        out ??= children.slice(0, i) as Node[];
        out.push(...hoisted);
    }
    return out ?? children;
}

/** The replacement for one mark, or null when it needs no change. */
function hoistMark(mark: Parent, state: State): Node[] | null {
    const inner = hoistMarkWhitespace(mark.children, state);
    const kids = inner.slice() as Node[];
    let lead = '';
    let trail = '';
    const first = kids[0];
    if (first?.type === 'text') {
        const value = (first as Text).value ?? '';
        lead = leadingWhitespace(value);
        if (lead) kids[0] = { ...first, value: value.slice(lead.length) } as Text;
    }
    const lastIndex = kids.length - 1;
    const last = kids[lastIndex];
    if (last?.type === 'text') {
        const value = (last as Text).value ?? '';
        trail = trailingWhitespace(value);
        if (trail) kids[lastIndex] = { ...last, value: value.slice(0, value.length - trail.length) } as Text;
    }
    if (!lead && !trail && inner === mark.children) return null;
    const content = kids.filter((k) => k.type !== 'text' || ((k as Text).value ?? '') !== '');
    const out: Node[] = [];
    if (lead) out.push({ type: 'text', value: lead } as Text);
    if (content.length > 0) out.push({ ...mark, children: content } as Parent);
    if (trail) out.push({ type: 'text', value: trail } as Text);
    return out;
}

/**
 * Serialize a run of phrasing children. `atLineStart` says whether the first
 * character lands at the start of a source line; `outer` is the delimiter
 * character of an enclosing emphasis/strong, if any.
 */
export function serializeInline(
    input: readonly Node[] | undefined,
    state: State,
    atLineStart: boolean,
    outer?: string,
): string {
    if (!input || input.length === 0) return '';
    const children = hoistMarkWhitespace(input, state);
    const n = children.length;
    const parts: string[] = [];
    // Emphasis content is kept aside so the delimiter can be chosen once the
    // neighbours are known (second pass).
    const emphasisContent: (string | undefined)[] = [];
    const ch = state.options.emphasis;
    let lineStart = atLineStart;
    for (let i = 0; i < n; i++) {
        const node = children[i];
        let s: string;
        let content: string | undefined;
        if (node.type === 'emphasis' && !state.rules.has('emphasis')) {
            content = serializeInline((node as Emphasis).children, state, false, ch);
            s = content === '' ? '' : ch + content + ch;
        } else {
            s = serializePhrasing(node, state, lineStart);
        }
        parts.push(s);
        emphasisContent.push(content);
        if (s !== '') lineStart = s.endsWith('\n');
    }
    for (let i = 0; i < n; i++) {
        const content = emphasisContent[i];
        if (content !== undefined) {
            if (content === '') continue;
            const before = edgeBefore(parts, i, outer);
            const after = edgeAfter(parts, i, outer);
            parts[i] = wrapEmphasis(content, ch, before, after);
        } else if (children[i].type === 'text' && parts[i].endsWith('\\!') && !parts[i].endsWith('\\\\!') && edgeAfter(parts, i, outer) !== '[') {
            // `escapeText` escapes a run-final "!" defensively (the next node
            // might supply the "["); with the neighbour known, keep it bare.
            parts[i] = parts[i].slice(0, -2) + '!';
        } else if (i > 0 && parts[i][0] === '(' && isShortcutReference(children[i - 1]) && parts[i - 1].endsWith(']')) {
            // `[ref]` followed by `(`… would become an inline link.
            parts[i] = '\\' + parts[i];
        } else if (children[i].type === 'link' && isBareAutolink(parts[i])) {
            // A bare autolink literal only re-parses at a word boundary: glued
            // to a preceding word (`see` + `https://x`) or followed by one it
            // needs the angle form (or, for `www.`, a real link).
            const before = i > 0 ? parts[i - 1].slice(-1) : undefined;
            const after = i < n - 1 ? parts[i + 1][0] : undefined;
            const boundaryBefore = before === undefined || /[\s(*_~]/.test(before);
            const boundaryAfter = after === undefined || /[\s<)*_~]/.test(after);
            if (!boundaryBefore || !boundaryAfter) {
                const link = children[i] as Link;
                parts[i] = /^https?:\/\//i.test(parts[i])
                    ? '<' + parts[i] + '>'
                    : '[' + escapeText(parts[i], false) + '](' + destination(link.url, link.title) + ')';
            }
        }
    }
    return parts.join('');
}

function isBareAutolink(part: string): boolean {
    return /^(?:https?:\/\/|www\.)[^\s<>]+$/i.test(part);
}

function isShortcutReference(node: Node): boolean {
    return (
        (node.type === 'linkReference' || node.type === 'imageReference') &&
        (node as LinkReference).referenceType === 'shortcut'
    );
}

/** Pick the emphasis delimiter for already-serialized content (see the module doc). */
function wrapEmphasis(content: string, ch: string, before: string | undefined, after: string | undefined): string {
    let d = ch;
    if (content[0] === ch || content[content.length - 1] === ch || before === ch || after === ch) {
        d = otherEmphasis(ch);
    }
    if (d === '_' && (isAlnum(before) || isAlnum(after))) d = '*';
    return d + content + d;
}

/** Serialize one phrasing node. Plugin rules win over the built-ins. */
export function serializePhrasing(node: Node, state: State, lineStart: boolean): string {
    const rule = state.rules.get(node.type);
    if (rule) return runRule(rule, node, state);
    switch (node.type) {
        case 'text':
            return escapeText((node as Text).value ?? '', lineStart);
        case 'emphasis': {
            const content = serializeInline((node as Emphasis).children, state, false, state.options.emphasis);
            return content === '' ? '' : wrapEmphasis(content, state.options.emphasis, undefined, undefined);
        }
        case 'strong': {
            const d = state.options.strong;
            const content = serializeInline((node as Strong).children, state, false, d[0]);
            return content === '' ? '' : d + content + d;
        }
        case 'delete': {
            const content = serializeInline((node as Delete).children, state, false, '~');
            return content === '' ? '' : '~~' + content + '~~';
        }
        case 'inlineCode':
            return serializeInlineCode((node as InlineCode).value ?? '');
        case 'break':
            return '\\\n';
        case 'link':
            return serializeLink(node as Link, state);
        case 'image': {
            const img = node as Image;
            return '![' + escapeText(img.alt ?? '') + '](' + destination(img.url, img.title) + ')';
        }
        case 'linkReference': {
            const ref = node as LinkReference;
            return '[' + serializeInline(ref.children, state, false) + ']' + referenceSuffix(ref);
        }
        case 'imageReference': {
            const ref = node as ImageReference;
            return '![' + escapeText(ref.alt ?? '') + ']' + referenceSuffix(ref);
        }
        case 'html':
            return (node as Literal).value ?? '';
        default:
            return serializeUnknown(node, state);
    }
}

function serializeInlineCode(raw: string): string {
    // Line endings become spaces in a code span anyway.
    const value = raw.replace(/\r?\n/g, ' ');
    if (value === '') return '';
    const fence = '`'.repeat(longestRun(value, '`') + 1);
    // The parser strips one space from each side when both are present (and
    // the span is not all spaces); a leading/trailing backtick must not touch
    // the fence.
    const pad =
        value[0] === '`' ||
        value[value.length - 1] === '`' ||
        (value[0] === ' ' && value[value.length - 1] === ' ' && /[^ ]/.test(value))
            ? ' '
            : '';
    return fence + pad + value + pad + fence;
}

/** `url "title"` for an inline link / image / definition. */
export function destination(url: string, title: string | null | undefined): string {
    const dest = escapeLinkDest(url ?? '');
    return title == null ? dest : dest + ' ' + quoteTitle(title);
}

function referenceSuffix(ref: LinkReference | ImageReference): string {
    switch (ref.referenceType) {
        case 'full':
            return '[' + escapeLabel(ref.label ?? ref.identifier) + ']';
        case 'collapsed':
            return '[]';
        default:
            return '';
    }
}

const URI_AUTOLINK = /^[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*$/;
const EMAIL_AUTOLINK =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
/** GFM drops trailing punctuation from a bare URL, so such a URL needs the `<…>` form. */
const TRAILING_PUNCT = /[?!.,:*_~'"]$/;

function serializeLink(link: Link, state: State): string {
    const children = link.children ?? [];
    if (link.data?.autolink && children.length === 1 && children[0].type === 'text') {
        const text = (children[0] as Text).value;
        const url = link.url;
        if (link.title == null && text !== '' && !/[\s<>]/.test(text)) {
            const bare =
                (text === url && /^https?:\/\//i.test(text)) ||
                (/^www\./i.test(text) && url === 'http://' + text);
            if (bare && !TRAILING_PUNCT.test(text) && !/[()]/.test(text)) return text;
            if (text === url && URI_AUTOLINK.test(text)) return '<' + text + '>';
            if (url === 'mailto:' + text && EMAIL_AUTOLINK.test(text)) return '<' + text + '>';
        }
    }
    return '[' + serializeInline(children, state, false) + '](' + destination(link.url, link.title) + ')';
}

// ---------------------------------------------------------------------------
// Plugin rules and the fallback
// ---------------------------------------------------------------------------

/** `true` when a parent's children should be joined as inline content. */
export function hasInlineChildren(children: readonly Node[]): boolean {
    for (const child of children) if (BLOCK_TYPES.has(child.type)) return false;
    return true;
}

function makeContext(state: State): SerializeContext {
    return {
        serializeChildren: (node: Parent) => {
            const children = node.children ?? [];
            return hasInlineChildren(children)
                ? serializeInline(children, state, false)
                : state.serializeBlocks(children);
        },
        escapeText: (text: string, atLineStart?: boolean) => escapeText(text, atLineStart ?? false),
        serialize: (node: Node) => state.serialize(node),
        indent: state.indent,
        options: state.raw,
    };
}

/** Run a plugin rule; a throw or a non-string result yields '' (dev-warned). */
export function runRule(rule: SerializeRule, node: Node, state: State): string {
    try {
        const out = rule(node, makeContext(state));
        if (typeof out === 'string') return out;
        if (__DEV__) console.warn(`[@sigx/richtext-markdown] Serialize rule for "${node.type}" returned a non-string; ignored.`);
    } catch (error) {
        if (__DEV__) console.warn(`[@sigx/richtext-markdown] Serialize rule for "${node.type}" threw; node skipped.`, error);
    }
    return '';
}

/** A node without a rule: its children (inline or block), else nothing. */
export function serializeUnknown(node: Node, state: State): string {
    if (__DEV__) console.warn(`[@sigx/richtext-markdown] No serialize rule for node type "${node.type}"; serializing its children.`);
    const children = (node as Parent).children;
    if (!Array.isArray(children) || children.length === 0) return '';
    return hasInlineChildren(children) ? serializeInline(children, state, false) : state.serializeBlocks(children);
}
