import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BlockContent, AlignType, Blockquote, Break, Code, Definition, Delete, Emphasis, Heading, HeadingDepth, Html, Image, ImageReference, InlineCode, Link, LinkReference, List, ListItem, Node, Paragraph, PhrasingContent, ReferenceType, Root, Strong, Table, TableCell, TableRow, Text, ThematicBreak } from '@sigx/richtext';
import type { RichTextPlugin } from '@sigx/richtext';
import { toMarkdown } from '../../src/serializer/index.js';
import { parseMarkdown } from '../../src/parser/index.js';
import { strip } from '@sigx/richtext/testing';

// ---------------------------------------------------------------------------
// Builders (hand-built ASTs — the parser is not involved)
// ---------------------------------------------------------------------------

const root = (...children: BlockContent[]): Root => ({ type: 'root', children });
const t = (value: string): Text => ({ type: 'text', value });
const p = (...children: (PhrasingContent | string)[]): Paragraph => ({ type: 'paragraph', children: inline(children) });
const inline = (children: (PhrasingContent | string)[]): PhrasingContent[] =>
    children.map((c) => (typeof c === 'string' ? t(c) : c));
const h = (depth: HeadingDepth, ...children: (PhrasingContent | string)[]): Heading => ({
    type: 'heading',
    depth,
    children: inline(children),
});
const hr = (): ThematicBreak => ({ type: 'thematicBreak' });
const bq = (...children: Blockquote['children']): Blockquote => ({ type: 'blockquote', children });
const em = (...children: (PhrasingContent | string)[]): Emphasis => ({ type: 'emphasis', children: inline(children) });
const strong = (...children: (PhrasingContent | string)[]): Strong => ({ type: 'strong', children: inline(children) });
const del = (...children: (PhrasingContent | string)[]): Delete => ({ type: 'delete', children: inline(children) });
const code = (value: string, lang?: string | null, meta?: string | null): Code => ({ type: 'code', value, lang, meta });
const ic = (value: string): InlineCode => ({ type: 'inlineCode', value });
const br = (): Break => ({ type: 'break' });
const html = (value: string): Html => ({ type: 'html', value });
const link = (url: string, children: (PhrasingContent | string)[], title?: string | null, autolink?: boolean): Link => ({
    type: 'link',
    url,
    title,
    children: inline(children),
    ...(autolink ? { data: { autolink: true } } : {}),
});
const img = (url: string, alt?: string | null, title?: string | null): Image => ({ type: 'image', url, alt, title });
const lref = (
    referenceType: ReferenceType,
    identifier: string,
    children: (PhrasingContent | string)[],
    label?: string,
): LinkReference => ({ type: 'linkReference', identifier, label, referenceType, children: inline(children) });
const iref = (referenceType: ReferenceType, identifier: string, alt?: string, label?: string): ImageReference => ({
    type: 'imageReference',
    identifier,
    label,
    referenceType,
    alt,
});
const def = (identifier: string, url: string, title?: string | null, label?: string): Definition => ({
    type: 'definition',
    identifier,
    label,
    url,
    title,
});
const li = (children: ListItem['children'], extra: Partial<ListItem> = {}): ListItem => ({
    type: 'listItem',
    children,
    ...extra,
});
const ul = (items: ListItem[], extra: Partial<List> = {}): List => ({ type: 'list', ordered: false, children: items, ...extra });
const ol = (items: ListItem[], extra: Partial<List> = {}): List => ({ type: 'list', ordered: true, children: items, ...extra });
const cell = (...children: (PhrasingContent | string)[]): TableCell => ({ type: 'tableCell', children: inline(children) });
const row = (...cells: TableCell[]): TableRow => ({ type: 'tableRow', children: cells });
const table = (rows: TableRow[], align?: AlignType[]): Table => ({ type: 'table', align, children: rows });

const md = (...children: BlockContent[]): string => toMarkdown(root(...children));

// ---------------------------------------------------------------------------

describe('toMarkdown — root and paragraphs', () => {
    it('returns "" for an empty root and joins blocks by one blank line with a trailing newline', () => {
        expect(md()).toBe('');
        expect(md(p('a'), p('b'))).toBe('a\n\nb\n');
    });

    it('escapes text and keeps soft breaks as newlines', () => {
        expect(md(p('a *b* c\n- not a list'))).toBe('a \\*b\\* c\n\\- not a list\n');
    });

    it('escapes a trailing "!" only when the next node starts with "["', () => {
        expect(md(p('hello!'))).toBe('hello!\n');
        expect(md({ type: 'paragraph', children: [{ type: 'text', value: 'a!' }, { type: 'link', url: 'u', children: [{ type: 'text', value: 'b' }] }] })).toBe('a\\![b](u)\n');
        expect(md({ type: 'paragraph', children: [{ type: 'text', value: 'a!' }, { type: 'text', value: '[b]' }] })).toBe('a!\\[b\\]\n');
        expect(md({ type: 'paragraph', children: [{ type: 'text', value: 'a!' }, { type: 'emphasis', children: [{ type: 'text', value: 'b' }] }] })).toBe('a!*b*\n');
    });

    it('serializes a hard break as backslash + newline', () => {
        expect(md(p('a', br(), 'b'))).toBe('a\\\nb\n');
    });

    it('escapes the line after a hard break as a line start', () => {
        expect(md(p('a', br(), '# b'))).toBe('a\\\n\\# b\n');
    });

    it('drops trailing whitespace and a dangling break', () => {
        expect(md(p('a  '))).toBe('a\n');
        expect(md(p('a', br()))).toBe('a\n');
        expect(md(p('a\\', br()))).toBe('a\\\\\n');
    });

    it('skips empty blocks', () => {
        expect(md(p(), p('b'), { type: 'paragraph', children: [] })).toBe('b\n');
    });

    it('serializes a single non-root node with a trailing newline', () => {
        expect(toMarkdown(p('hi'))).toBe('hi\n');
        expect(toMarkdown(t('*x*'))).toBe('\\*x\\*\n');
        expect(toMarkdown(li([p('a')]))).toBe('- a\n');
        expect(toMarkdown(row(cell('a'), cell('b')))).toBe('| a | b |\n');
        expect(toMarkdown(cell('a|b'))).toBe('a\\|b\n');
    });

    it('uses CRLF line endings on request', () => {
        expect(toMarkdown(root(p('a\nb'), code('x\ny')), { lineEnding: '\r\n' })).toBe(
            'a\r\nb\r\n\r\n```\r\nx\r\ny\r\n```\r\n',
        );
    });
});

describe('toMarkdown — headings and thematic breaks', () => {
    it('always writes ATX headings', () => {
        expect(md(h(1, 'Title'), h(3, 'Sub'))).toBe('# Title\n\n### Sub\n');
        expect(md(h(2))).toBe('##\n');
    });

    it('flattens a heading onto one line and escapes a closing sequence', () => {
        expect(md(h(1, 'a\nb', br(), 'c'))).toBe('# a b c\n');
        expect(md(h(1, 'a #'))).toBe('# a \\#\n');
        expect(md(h(1, 'a#'))).toBe('# a#\n');
        expect(md(h(2, '# not a level'))).toBe('## # not a level\n');
    });

    it('writes the configured rule', () => {
        expect(md(hr())).toBe('---\n');
        expect(toMarkdown(root(hr()), { rule: '***' })).toBe('***\n');
        expect(toMarkdown(root(hr()), { rule: '___' })).toBe('___\n');
    });
});

describe('toMarkdown — inline', () => {
    it('emphasis, strong, delete', () => {
        expect(md(p(em('a'), ' ', strong('b'), ' ', del('c')))).toBe('*a* **b** ~~c~~\n');
        expect(toMarkdown(root(p(em('a'), ' ', strong('b'))), { emphasis: '_', strong: '__' })).toBe('_a_ __b__\n');
    });

    it('drops empty emphasis-like nodes', () => {
        expect(md(p('a', em(), strong(), del(), 'b'))).toBe('ab\n');
    });

    it('moves whitespace at a mark edge outside the delimiters (#18)', () => {
        // A closing delimiter after whitespace does not close in CommonMark.
        expect(md(p('hello ', strong('world '), 'again'))).toBe('hello **world** again\n');
        // Trailing whitespace at the end of a paragraph is dropped, as before.
        expect(md(p('hello ', strong('world ')))).toBe('hello **world**\n');
        expect(md(p('x', strong(' world')))).toBe('x **world**\n');
        expect(md(p('a', em(' b '), 'c'))).toBe('a *b* c\n');
        expect(md(p('a', del('b\t'), 'c'))).toBe('a~~b~~\tc\n');
        // Nested: the inner mark's whitespace moves out through the outer one.
        expect(md(p('a ', strong(em('b '), 'c '), 'd'))).toBe('a **_b_ c** d\n');
        expect(md(p(strong('a', em(' b'))))).toBe('**a _b_**\n');
    });

    it('round-trips a mark that ended in whitespace through the parser (#18)', () => {
        const out = md(p('hello ', strong('world '), 'again'));
        expect(strip(parseMarkdown(out))).toEqual(strip(root(p('hello ', strong('world'), ' again'))));
    });

    it('hoists only CommonMark whitespace, not every JS \\s character (#18)', () => {
        // U+FEFF matches \s but is not Unicode whitespace to CommonMark.
        expect(md(p('a ', strong('b\uFEFF'), 'c'))).toBe('a **b\uFEFF**c\n');
        // U+00A0 (Zs) is.
        expect(md(p('a ', strong('b\u00A0'), 'c'))).toBe('a **b**\u00A0c\n');
    });

    it('drops a mark that holds only whitespace, keeping the whitespace (#18)', () => {
        expect(md(p('a', strong(' '), 'b'))).toBe('a b\n');
        expect(md(p('a', em(strong('  ')), 'b'))).toBe('a  b\n');
    });

    it('picks the emphasis delimiter against the neighbours left after hoisting (#18)', () => {
        // `_` next to a letter could not close; the hoisted space makes it legal.
        expect(md(p('foo', em(strong('x')), 'bar'))).toBe('foo***x***bar\n');
        expect(md(p('foo ', em(strong(' x ')), 'bar'))).toBe('foo  _**x**_ bar\n');
    });

    it('switches the emphasis delimiter next to a strong of the same character', () => {
        expect(md(p(em(strong('x'))))).toBe('_**x**_\n');
        expect(md(p(strong(em('x'))))).toBe('**_x_**\n');
        expect(md(p(strong(em('x'), ' y')))).toBe('**_x_ y**\n');
        expect(md(p(em('a'), strong('b')))).toBe('_a_**b**\n');
        expect(md(p(strong('b'), em('a')))).toBe('**b**_a_\n');
        expect(md(p(em('a'), em('b')))).toBe('_a_*b*\n');
    });

    it('keeps * inside a word where _ could not open or close', () => {
        expect(md(p('foo', em(strong('bar')), 'baz'))).toBe('foo***bar***baz\n');
        expect(md(p('foo', strong(em('bar')), 'baz'))).toBe('foo**_bar_**baz\n');
    });

    it('switches to * when the _ option would touch a _-strong', () => {
        expect(toMarkdown(root(p(em(strong('x')))), { emphasis: '_', strong: '__' })).toBe('*__x__*\n');
        expect(toMarkdown(root(p(strong(em('x')))), { emphasis: '_', strong: '__' })).toBe('__*x*__\n');
    });

    it('inline code picks a longer backtick run and pads when needed', () => {
        expect(md(p(ic('a')))).toBe('`a`\n');
        expect(md(p(ic('a ` b')))).toBe('``a ` b``\n');
        expect(md(p(ic('``')))).toBe('``` `` ```\n');
        expect(md(p(ic('`a')))).toBe('`` `a ``\n');
        expect(md(p(ic(' a ')))).toBe('`  a  `\n');
        expect(md(p(ic('  ')))).toBe('`  `\n');
        expect(md(p(ic('a\nb')))).toBe('`a b`\n');
        expect(md(p('x', ic(''), 'y'))).toBe('xy\n');
    });

    it('links with titles, parens and spaces in the destination', () => {
        expect(md(p(link('https://x.y', ['a'])))).toBe('[a](https://x.y)\n');
        expect(md(p(link('https://x.y', ['a'], 'T')))).toBe('[a](https://x.y "T")\n');
        expect(md(p(link('https://x.y/(1)', ['a'], 'say "hi"')))).toBe('[a](https://x.y/\\(1\\) \'say "hi"\')\n');
        expect(md(p(link('a b', ['a'])))).toBe('[a](<a b>)\n');
        expect(md(p(link('', ['a'])))).toBe('[a](<>)\n');
        expect(md(p(link('x', [em('a'), ' ]'])))).toBe('[*a* \\]](x)\n');
    });

    it('autolinks: angle, email and bare', () => {
        expect(md(p(link('https://x.y/', ['https://x.y/'], null, true)))).toBe('https://x.y/\n');
        expect(md(p(link('http://www.x.y', ['www.x.y'], null, true)))).toBe('www.x.y\n');
        expect(md(p(link('irc://x', ['irc://x'], null, true)))).toBe('<irc://x>\n');
        expect(md(p(link('mailto:a@b.c', ['a@b.c'], null, true)))).toBe('<a@b.c>\n');
        // Trailing punctuation would be stripped from a bare URL → angle form.
        expect(md(p(link('https://x.y/a.', ['https://x.y/a.'], null, true)))).toBe('<https://x.y/a.>\n');
        // Not an autolink: text differs, or a title is present.
        expect(md(p(link('https://x.y', ['x'], null, true)))).toBe('[x](https://x.y)\n');
        expect(md(p(link('https://x.y', ['https://x.y'], 'T', true)))).toBe('[https&#x3A;//x.y](https://x.y "T")\n');
        expect(md(p(link('https://x.y', ['https://x.y'])))).toBe('[https&#x3A;//x.y](https://x.y)\n');
    });

    it('images', () => {
        expect(md(p(img('a.png')))).toBe('![](a.png)\n');
        expect(md(p(img('a.png', 'alt [x]', 'T')))).toBe('![alt \\[x\\]](a.png "T")\n');
    });

    it('references', () => {
        expect(md(p(lref('full', 'x', ['a'], 'X')))).toBe('[a][X]\n');
        expect(md(p(lref('full', 'x', ['a'])))).toBe('[a][x]\n');
        expect(md(p(lref('collapsed', 'a', ['a'])))).toBe('[a][]\n');
        expect(md(p(lref('shortcut', 'a', ['a'])))).toBe('[a]\n');
        expect(md(p(iref('full', 'x', 'alt', 'X')))).toBe('![alt][X]\n');
        expect(md(p(iref('collapsed', 'x', 'alt')))).toBe('![alt][]\n');
        expect(md(p(iref('shortcut', 'x', 'alt')))).toBe('![alt]\n');
        expect(md(p(iref('shortcut', 'x')))).toBe('![]\n');
    });

    it('keeps a shortcut reference from becoming a link or definition', () => {
        expect(md(p(lref('shortcut', 'a', ['a']), '(b)'))).toBe('[a]\\(b)\n');
        expect(md(p(lref('shortcut', 'a', ['a']), ': b'))).toBe('[a]\\: b\n');
        // Only the first line of a paragraph can be a definition.
        expect(md(p('x ', lref('shortcut', 'a', ['a']), ': b'))).toBe('x [a]: b\n');
        expect(md(p('!', lref('shortcut', 'a', ['a'])))).toBe('\\![a]\n');
    });

    it('inline html verbatim', () => {
        const inlineHtml = (v: string) => html(v) as unknown as PhrasingContent;
        expect(md(p('a ', inlineHtml('<b>'), 'x', inlineHtml('</b>')))).toBe('a <b>x</b>\n');
    });
});

describe('toMarkdown — code and html blocks', () => {
    it('fenced code with info string, never indented', () => {
        expect(md(code('x = 1', 'js'))).toBe('```js\nx = 1\n```\n');
        expect(md(code('x', 'js', 'title="a"'))).toBe('```js title="a"\nx\n```\n');
        expect(md(code(''))).toBe('```\n```\n');
        expect(toMarkdown(root(code('x')), { fence: '~' })).toBe('~~~\nx\n~~~\n');
    });

    it('widens the fence past any run inside and swaps to ~ for backticks in the info', () => {
        expect(md(code('```\nx\n```'))).toBe('````\n```\nx\n```\n````\n');
        expect(md(code('a``b'))).toBe('```\na``b\n```\n');
        expect(md(code('x', 'a`b'))).toBe('~~~a`b\nx\n~~~\n');
        expect(toMarkdown(root(code('~~~~')), { fence: '~' })).toBe('~~~~~\n~~~~\n~~~~~\n');
    });

    it('ignores `open` and always closes', () => {
        expect(md({ type: 'code', value: 'x', open: true })).toBe('```\nx\n```\n');
    });

    it('html blocks verbatim', () => {
        expect(md(html('<div>\n  *hi*\n</div>'), p('a'))).toBe('<div>\n  *hi*\n</div>\n\na\n');
    });
});

describe('toMarkdown — definitions', () => {
    it('writes label, destination and title', () => {
        expect(md(def('foo', 'https://x.y'))).toBe('[foo]: https://x.y\n');
        expect(md(def('foo', 'https://x.y', 'T', 'Foo'))).toBe('[Foo]: https://x.y "T"\n');
        expect(md(def('foo', 'a b', "it's"))).toBe('[foo]: <a b> "it\'s"\n');
        expect(md(def('foo', '', 'a "b"'))).toBe('[foo]: <> \'a "b"\'\n');
        expect(md(def('a]b', 'x'))).toBe('[a\\]b]: x\n');
    });
});

describe('toMarkdown — blockquotes', () => {
    it('prefixes every line, blank lines with a bare >', () => {
        expect(md(bq(p('a\nb'), p('c')))).toBe('> a\n> b\n>\n> c\n');
        expect(md(bq())).toBe('>\n');
    });

    it('nests lists and code', () => {
        expect(md(bq(ul([li([p('a')]), li([p('b'), code('x\n\ny')])]), bq(p('deep'))))).toBe(
            '> - a\n> - b\n>   ```\n>   x\n>\n>   y\n>   ```\n>\n> > deep\n',
        );
    });
});

describe('toMarkdown — lists', () => {
    it('tight bullet list', () => {
        expect(md(ul([li([p('a')]), li([p('b')])]))).toBe('- a\n- b\n');
        expect(toMarkdown(root(ul([li([p('a')])])), { bullet: '+' })).toBe('+ a\n');
    });

    it('spread list separates items and blocks with blank lines', () => {
        expect(md(ul([li([p('a'), p('b')]), li([p('c')])], { spread: true }))).toBe('- a\n\n  b\n\n- c\n');
        // Any spread item makes the whole list loose.
        expect(md(ul([li([p('a')]), li([p('b')], { spread: true })]))).toBe('- a\n\n- b\n');
    });

    it('ordered lists honour start and incrementListMarker', () => {
        expect(md(ol([li([p('a')]), li([p('b')])], { start: 3 }))).toBe('3. a\n4. b\n');
        expect(toMarkdown(root(ol([li([p('a')]), li([p('b')])])), { incrementListMarker: false })).toBe('1. a\n1. b\n');
        expect(md(ol([li([p('a\nb')]), li([p('c')])], { start: 9 }))).toBe('9. a\n   b\n10. c\n');
    });

    it('nested lists indent by marker width + 1', () => {
        expect(md(ul([li([p('a'), ul([li([p('b'), ol([li([p('c\nd')])])])])])]))).toBe(
            '- a\n  - b\n    1. c\n       d\n',
        );
        // A wide marker in a loose list (no paragraph-interrupt concern).
        expect(md(ol([li([p('a'), p('b\nc')])], { start: 10, spread: true }))).toBe('10. a\n\n    b\n    c\n');
    });

    it('task items and empty items', () => {
        expect(md(ul([li([p('a')], { checked: true }), li([p('b')], { checked: false }), li([p('c')])]))).toBe(
            '- [x] a\n- [ ] b\n- c\n',
        );
        expect(md(ul([li([]), li([], { checked: false }), li([p('x')])]))).toBe('-\n- [ ]\n- x\n');
        // Literal task-looking text is escaped.
        expect(md(ul([li([p('[x] a')])]))).toBe('- \\[x\\] a\n');
    });

    it('alternates the marker between adjacent lists of the same kind', () => {
        expect(md(ul([li([p('a')])]), ul([li([p('b')])]), ul([li([p('c')])]))).toBe('- a\n\n* b\n\n- c\n');
        expect(md(ol([li([p('a')])]), ol([li([p('b')])]))).toBe('1. a\n\n1) b\n');
        expect(toMarkdown(root(ul([li([p('a')])]), ul([li([p('b')])])), { bullet: '+' })).toBe('+ a\n\n- b\n');
        // Different kinds do not merge, so no alternation.
        expect(md(ul([li([p('a')])]), ol([li([p('b')])]), ul([li([p('c')])]))).toBe('- a\n\n1. b\n\n- c\n');
        expect(md(ul([li([p('a')])]), p('x'), ul([li([p('b')])]))).toBe('- a\n\nx\n\n- b\n');
    });

    it('keeps a thematic break from merging with the bullet or a paragraph', () => {
        expect(md(ul([li([hr()])]))).toBe('- ***\n');
        expect(toMarkdown(root(ul([li([hr()])])), { bullet: '*', rule: '***' })).toBe('* ---\n');
        expect(toMarkdown(root(ul([li([hr()])])), { bullet: '+' })).toBe('+ ---\n');
        expect(md(ul([li([p('a'), hr()])]))).toBe('- a\n  ***\n');
    });

    it('in a tight item, inserts a blank line only where the next block could not interrupt', () => {
        expect(md(ul([li([p('a'), h(1, 'b'), code('c'), bq(p('d'))])]))).toBe('- a\n  # b\n  ```\n  c\n  ```\n  > d\n');
        expect(md(ul([li([p('a'), ol([li([p('b')])], { start: 2 })])]))).toBe('- a\n\n  2. b\n');
        expect(md(ul([li([p('a'), ol([li([p('b')])])])]))).toBe('- a\n  1. b\n');
        expect(md(ul([li([p('a'), ul([li([])])])]))).toBe('- a\n\n  -\n');
        expect(md(ul([li([p('a'), html('<div>x</div>')])]))).toBe('- a\n  <div>x</div>\n');
        expect(md(ul([li([p('a'), html('<span>x</span>')])]))).toBe('- a\n\n  <span>x</span>\n');
        expect(md(ul([li([html('<div>'), p('a')])]))).toBe('- <div>\n\n  a\n');
        expect(md(ul([li([ul([li([p('a')])]), p('b')])]))).toBe('- - a\n\n  b\n');
        expect(md(ul([li([table([row(cell('a'))]), p('b')])]))).toBe('- | a |\n  | --- |\n\n  b\n');
    });
});

describe('toMarkdown — tables', () => {
    it('writes header, alignment row and body', () => {
        expect(
            md(
                table(
                    [row(cell('a'), cell('b'), cell('c'), cell('d')), row(cell('1'), cell('2'), cell('3'), cell('4'))],
                    ['left', 'center', 'right', null],
                ),
            ),
        ).toBe('| a | b | c | d |\n| :-- | :-: | --: | --- |\n| 1 | 2 | 3 | 4 |\n');
        expect(md(table([row(cell('a'))]))).toBe('| a |\n| --- |\n');
        expect(md(table([]))).toBe('');
    });

    it('escapes pipes (even in code) and flattens newlines', () => {
        expect(md(table([row(cell('a|b'), cell(ic('x|y')))]))).toBe('| a\\|b | `x\\|y` |\n| --- | --- |\n');
        expect(md(table([row(cell('a\nb'), cell('c', br(), 'd'))]))).toBe('| a b | c d |\n| --- | --- |\n');
        expect(md(table([row(cell('\\|'))]))).toBe('| \\\\\\| |\n| --- |\n');
    });

    it('normalises rows to the header width', () => {
        expect(md(table([row(cell('a'), cell('b')), row(cell('1')), row(cell('1'), cell('2'), cell('3'))]))).toBe(
            '| a | b |\n| --- | --- |\n| 1 |  |\n| 1 | 2 |\n',
        );
    });
});

describe('toMarkdown — plugins and unknown nodes', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    const mention = (name: string): Node => ({ type: 'mention', name } as Node);
    const plugin: RichTextPlugin = {
        name: 'mention',
        formats: { markdown: { serialize: { mention: (node: Node & { name: string }, ctx) => '@' + ctx.escapeText(node.name) } } },
    };

    it('uses a plugin rule with the context', () => {
        const out = toMarkdown(root(p('hi ', mention('a_b') as PhrasingContent)), { plugins: [plugin] });
        expect(out).toBe('hi @a\\_b\n');
    });

    it('lets a rule override a built-in type and reach the options and indent', () => {
        const seen: { indent: string; options: unknown }[] = [];
        const override: RichTextPlugin = {
            name: 'override',
            formats: {
                markdown: {
                    serialize: {
                        code: (node: Code, ctx) => {
                            seen.push({ indent: ctx.indent, options: ctx.options });
                            return '<code>' + node.value + '</code>';
                        },
                        paragraph: (node: Paragraph, ctx) => ctx.serializeChildren(node) + '!',
                    },
                },
            },
        };
        const options = { plugins: [override] };
        expect(toMarkdown(root(ul([li([p('a'), code('x')])])), options)).toBe('- a!\n  <code>x</code>\n');
        expect(seen).toEqual([{ indent: '  ', options }]);
    });

    it('ctx.serialize and ctx.serializeChildren dispatch inline vs blocks', () => {
        const wrap: RichTextPlugin = {
            name: 'wrap',
            formats: {
                markdown: {
                    serialize: {
                        box: (node: Node & { children: Node[] }, ctx) => '::: box\n' + ctx.serializeChildren(node) + '\n:::',
                        note: (node: Node & { child: Node }, ctx) => '(' + ctx.serialize(node.child) + ')',
                    },
                },
            },
        };
        const box = { type: 'box', children: [p('a'), p('b')] } as unknown as BlockContent;
        const note = { type: 'note', child: em('x') } as unknown as PhrasingContent;
        expect(toMarkdown(root(box, p('see ', note)), { plugins: [wrap] })).toBe('::: box\na\n\nb\n:::\n\nsee (*x*)\n');
    });

    it('falls back to the children of an unknown node and warns', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const custom = { type: 'custom', children: [t('a'), em('b')] } as unknown as PhrasingContent;
        const wrapper = { type: 'wrapper', children: [p('x'), p('y')] } as unknown as BlockContent;
        const leaf = { type: 'leaf' } as unknown as BlockContent;
        expect(md(p('[', custom, ']'), wrapper, leaf)).toBe('\\[a*b*\\]\n\nx\n\ny\n');
        expect(warn).toHaveBeenCalledTimes(3);
    });

    it('never throws: a throwing or non-string rule yields nothing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const bad: RichTextPlugin = {
            name: 'bad',
            formats: {
                markdown: {
                    serialize: {
                        boom: () => {
                            throw new Error('nope');
                        },
                        num: () => 42 as unknown as string,
                    },
                },
            },
        };
        const boom = { type: 'boom' } as unknown as PhrasingContent;
        const num = { type: 'num' } as unknown as PhrasingContent;
        expect(toMarkdown(root(p('a', boom, 'b', num, 'c')), { plugins: [bad] })).toBe('abc\n');
        expect(warn).toHaveBeenCalledTimes(2);
    });
});

describe('toMarkdown — bare autolinks need a word boundary', () => {
    it('uses the angle form when a bare url is glued to a word', () => {
        const auto = (url: string) => link(url, [url], null, true);
        expect(md(p('see', auto('https://x')))).toBe('see<https://x>\n');
        expect(md(p(auto('https://x'), 'now'))).toBe('<https://x>now\n');
        expect(md(p('see ', auto('https://x')))).toBe('see https://x\n');
        // The label is escaped like any text (a `www.` literal is neutralised); it decodes back on parse.
        expect(md(p('go', link('http://www.x.com', ['www.x.com'], null, true)))).toBe('go[www&#x2E;x.com](http://www.x.com)\n');
    });
});
