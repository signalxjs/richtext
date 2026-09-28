/**
 * A small line highlighter for the source pane — enough to read Markdown and
 * HTML at a glance, not a parser: syntax marks, headings, code, links and
 * mentions in Markdown; tags, attributes and values in HTML. Every source
 * character lands in exactly one token, so joining a line's tokens gives the
 * line back.
 */

export type TokenKind = 'text' | 'mark' | 'heading' | 'strong' | 'em' | 'code' | 'link' | 'tag' | 'attr' | 'string' | 'comment';

export interface Token {
    kind: TokenKind;
    text: string;
}

export type Line = Token[];

function push(line: Line, kind: TokenKind, text: string): void {
    if (!text) return;
    const last = line[line.length - 1];
    if (last && last.kind === kind) last.text += text;
    else line.push({ kind, text });
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** Inline spans, most specific first: code, links, autolinks, strong, emphasis, mentions. */
const INLINE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)|<(?:https?|mailto):[^>\s]*>|(\*\*|__)(?=\S)([\s\S]*?\S)\5|(\*|_)(?=\S)([\s\S]*?\S)\7|(^|[^\w])(@[\w.-]+)/g;

function inline(line: Line, text: string, base: TokenKind): void {
    let at = 0;
    // A fresh regex per call: the spans recurse, and a shared `lastIndex` would restart the outer scan.
    const re = new RegExp(INLINE.source, 'g');
    for (let m = re.exec(text); m; m = re.exec(text)) {
        let start = m.index;
        let whole = m[0];
        if (m[10] !== undefined) {
            // A mention: keep the character before it in the text.
            start += m[9].length;
            whole = m[10];
        }
        push(line, base, text.slice(at, start));
        if (m[1] !== undefined) push(line, 'code', whole);
        else if (m[3] !== undefined) {
            push(line, 'mark', '[');
            inline(line, m[3], base);
            push(line, 'mark', '](');
            push(line, 'link', m[4]);
            push(line, 'mark', whole.slice(1 + m[3].length + 2 + m[4].length));
        } else if (whole.startsWith('<')) push(line, 'link', whole);
        else if (m[5] !== undefined) {
            push(line, 'mark', m[5]);
            inline(line, m[6], 'strong');
            push(line, 'mark', m[5]);
        } else if (m[7] !== undefined) {
            push(line, 'mark', m[7]);
            inline(line, m[8], 'em');
            push(line, 'mark', m[7]);
        } else push(line, 'link', whole);
        at = start + whole.length;
    }
    push(line, base, text.slice(at));
}

const FENCE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
const HEADING = /^(\s{0,3}#{1,6}(?:\s+|$))(.*?)(\s+#+\s*)?$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^(\s{0,3}>\s?)+/;
const LIST = /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s+\[[ xX]\])?(?:\s+|$)/;

/** Highlight Markdown source, one token list per line. */
export function highlightMarkdown(source: string): Line[] {
    const lines: Line[] = [];
    let fence: string | null = null;
    for (const raw of source.split('\n')) {
        const line: Line = [];
        lines.push(line);
        const fenceMatch = FENCE.exec(raw);
        if (fence !== null) {
            if (fenceMatch && fenceMatch[2][0] === fence[0] && fenceMatch[2].length >= fence.length && !fenceMatch[3].trim()) {
                push(line, 'mark', raw);
                fence = null;
            } else push(line, 'code', raw);
            continue;
        }
        if (fenceMatch) {
            fence = fenceMatch[2];
            push(line, 'mark', fenceMatch[1] + fenceMatch[2]);
            push(line, 'code', fenceMatch[3]);
            continue;
        }
        if (RULE.test(raw)) {
            push(line, 'mark', raw);
            continue;
        }
        let rest = raw;
        const quote = QUOTE.exec(rest);
        if (quote) {
            push(line, 'mark', quote[0]);
            rest = rest.slice(quote[0].length);
        }
        const heading = HEADING.exec(rest);
        if (heading) {
            push(line, 'mark', heading[1]);
            inline(line, heading[2], 'heading');
            push(line, 'mark', heading[3] ?? '');
            continue;
        }
        const list = LIST.exec(rest);
        if (list) {
            push(line, 'mark', list[0]);
            rest = rest.slice(list[0].length);
        }
        if (/^\s*\|/.test(rest)) {
            // A table row: pipes and the delimiter row are syntax.
            if (/^[\s|:-]+$/.test(rest)) push(line, 'mark', rest);
            else for (const part of rest.split(/(\|)/)) part === '|' ? push(line, 'mark', part) : inline(line, part, 'text');
            continue;
        }
        inline(line, rest, 'text');
    }
    return lines;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const HTML = /<!--[\s\S]*?-->|<\/?[A-Za-z][^\s/>]*(?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/g;
const ATTR = /(\s+)([^\s=/>]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+))?/g;

function tag(tokens: Token[], text: string): void {
    const name = /^<\/?[A-Za-z][^\s/>]*/.exec(text)![0];
    const close = /\s*\/?>$/.exec(text)![0];
    tokens.push({ kind: 'tag', text: name });
    const attrs = text.slice(name.length, text.length - close.length);
    let at = 0;
    ATTR.lastIndex = 0;
    for (let m = ATTR.exec(attrs); m; m = ATTR.exec(attrs)) {
        if (m.index > at) tokens.push({ kind: 'text', text: attrs.slice(at, m.index) });
        tokens.push({ kind: 'text', text: m[1] }, { kind: 'attr', text: m[2] });
        if (m[3] !== undefined) tokens.push({ kind: 'mark', text: m[3] }, { kind: 'string', text: m[4] });
        at = m.index + m[0].length;
    }
    if (at < attrs.length) tokens.push({ kind: 'text', text: attrs.slice(at) });
    tokens.push({ kind: 'tag', text: close });
}

/** Highlight HTML source, one token list per line. */
export function highlightHtml(source: string): Line[] {
    const tokens: Token[] = [];
    let at = 0;
    HTML.lastIndex = 0;
    for (let m = HTML.exec(source); m; m = HTML.exec(source)) {
        if (m.index > at) tokens.push({ kind: 'text', text: source.slice(at, m.index) });
        if (m[0].startsWith('<!--')) tokens.push({ kind: 'comment', text: m[0] });
        else tag(tokens, m[0]);
        at = m.index + m[0].length;
    }
    if (at < source.length) tokens.push({ kind: 'text', text: source.slice(at) });
    // Split on newlines, carrying each token's kind across the break.
    const lines: Line[] = [[]];
    for (const t of tokens) {
        const parts = t.text.split('\n');
        parts.forEach((part, i) => {
            if (i > 0) lines.push([]);
            push(lines[lines.length - 1], t.kind, part);
        });
    }
    return lines;
}

/** The highlighter for a format id (`markdown`, `html`), else plain lines. */
export function highlightSource(source: string, formatId: string): Line[] {
    if (formatId === 'markdown') return highlightMarkdown(source);
    if (formatId === 'html') return highlightHtml(source);
    return source.split('\n').map((text) => (text ? [{ kind: 'text' as const, text }] : []));
}
