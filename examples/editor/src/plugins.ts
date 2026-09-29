/**
 * The editor's plugins: the markdown preset (input rules, clipboard), the
 * HTML preset (`text/html` on copy), the mention syntax + `@` trigger + chip
 * and `/` block commands. The editor captures them at mount, so this is one
 * module constant.
 */
import type { RichTextPlugin } from '@sigx/richtext';
import { createSlashPlugin } from '@sigx/richtext/editor';
import { createDomMentionPlugin } from '@sigx/richtext/editor/dom';
import { mentionMarkdown } from '@sigx/richtext-markdown';
import { markdownPreset } from '@sigx/richtext-markdown/editor';
import { mentionHtml } from '@sigx/richtext-html';
import { htmlPreset } from '@sigx/richtext-html/editor';

/** Who `@` can mention. */
const PEOPLE = [
    { id: 'u1', label: 'Andy' },
    { id: 'u2', label: 'Bea' },
    { id: 'u3', label: 'Chris' },
    { id: 'u4', label: 'Dana' }
];

export const EDITOR_PLUGINS: readonly RichTextPlugin[] = [
    markdownPreset,
    htmlPreset,
    createDomMentionPlugin({
        onQuery: (q) => PEOPLE.filter((p) => p.label.toLowerCase().startsWith(q.toLowerCase())),
        formats: { markdown: mentionMarkdown, html: mentionHtml }
    }),
    createSlashPlugin()
];
