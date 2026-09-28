import { describe, expect, it } from 'vitest';
import { highlightHtml, highlightMarkdown, highlightSource, type Line } from '../src/highlight.js';

const text = (lines: Line[]) => lines.map((l) => l.map((t) => t.text).join('')).join('\n');
const kinds = (line: Line) => line.map((t) => `${t.kind}:${t.text}`);

describe('highlightMarkdown', () => {
    const source = '# Title **bold**\n\n> quote with `code`\n\n1. [link](https://x.dev) and @alice\n- [x] done *em*\n\n```ts\nconst a = 1;\n```\n\n| a | b |\n| - | - |\n\n---';

    it('gives every character back, line by line', () => {
        expect(text(highlightMarkdown(source))).toBe(source);
    });

    it('marks syntax and colours headings, code, links and mentions', () => {
        const lines = highlightMarkdown(source);
        expect(kinds(lines[0])).toEqual(['mark:# ', 'heading:Title ', 'mark:**', 'strong:bold', 'mark:**']);
        expect(kinds(lines[2])).toEqual(['mark:> ', 'text:quote with ', 'code:`code`']);
        expect(kinds(lines[4])).toEqual(['mark:1. [', 'text:link', 'mark:](', 'link:https://x.dev', 'mark:)', 'text: and ', 'link:@alice']);
        expect(kinds(lines[5])).toEqual(['mark:- [x] ', 'text:done ', 'mark:*', 'em:em', 'mark:*']);
        expect(kinds(lines[7])).toEqual(['mark:```', 'code:ts']);
        expect(kinds(lines[8])).toEqual(['code:const a = 1;']);
        expect(kinds(lines[9])).toEqual(['mark:```']);
        expect(lines[11][0]).toEqual({ kind: 'mark', text: '|' });
        expect(kinds(lines[12])).toEqual(['mark:| - | - |']);
        expect(kinds(lines[14])).toEqual(['mark:---']);
    });

    it('does not read markdown inside a fence', () => {
        const lines = highlightMarkdown('```\n# not a heading\n```');
        expect(kinds(lines[1])).toEqual(['code:# not a heading']);
    });
});

describe('highlightHtml', () => {
    const source = '<h1>Title</h1>\n<p class="lead">Some <a href=\'https://x.dev\'>link</a></p>\n<!-- note -->';

    it('gives every character back', () => {
        expect(text(highlightHtml(source))).toBe(source);
    });

    it('colours tags, attributes and values', () => {
        const lines = highlightHtml(source);
        expect(kinds(lines[0])).toEqual(['tag:<h1>', 'text:Title', 'tag:</h1>']);
        expect(kinds(lines[1]).slice(0, 5)).toEqual(['tag:<p', 'text: ', 'attr:class', 'mark:=', 'string:"lead"']);
        expect(kinds(lines[2])).toEqual(['comment:<!-- note -->']);
    });
});

describe('highlightSource', () => {
    it('falls back to plain lines for other formats', () => {
        expect(highlightSource('a\nb', 'text')).toEqual([[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]]);
    });
});
