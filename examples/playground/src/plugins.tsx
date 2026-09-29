/**
 * The Lab's plugins. Every array here is a module constant: the view's
 * incremental engine and the editor capture their plugins at construction,
 * so a new array identity means a new engine (and a remounted editor).
 */
import type { JSXElement } from 'sigx';
import type { Mention, NodeProps, RenderChild, RichTextPlugin } from '@sigx/richtext';
import { createSlashPlugin } from '@sigx/richtext/editor';
import { createDomMentionPlugin } from '@sigx/richtext/editor/dom';
import { mentionMarkdown, mentionPlugin } from '@sigx/richtext-markdown';
import { markdownPreset } from '@sigx/richtext-markdown/editor';
import { mentionHtml } from '@sigx/richtext-html';
import { htmlPreset } from '@sigx/richtext-html/editor';

// Register the mention node with the AST and type its component slot: this
// is the consumer-side half of the plugin contract (the package does not do
// it itself so a plain tree stays exactly mdast).
declare module '@sigx/richtext' {
    interface PhrasingContentMap {
        mention: Mention;
    }
    interface PluginComponents<E> {
        mention(p: NodeProps<E, Mention>): RenderChild<E>;
    }
}

/** The mention node with its syntax in both source formats (`@[Andy](u1)` in markdown, the chip's `<span>` in HTML). */
const MENTION: RichTextPlugin = { ...mentionPlugin, formats: { markdown: mentionMarkdown, html: mentionHtml } };

/** The view's and the serializers' plugins, with the mention plugin on or off. */
export const VIEW_PLUGINS = {
    on: [MENTION] as readonly RichTextPlugin[],
    off: [] as readonly RichTextPlugin[]
};

/** Who `@` can mention in the editor. */
const PEOPLE = [
    { id: 'u1', label: 'Andy' },
    { id: 'u2', label: 'Bea' },
    { id: 'u3', label: 'Chris' },
    { id: 'u4', label: 'Dana' }
];

const domMention = createDomMentionPlugin({
    onQuery: (q) => PEOPLE.filter((p) => p.label.toLowerCase().startsWith(q.toLowerCase())),
    formats: { markdown: mentionMarkdown, html: mentionHtml }
});
const slash = createSlashPlugin();

/**
 * The editor's plugins for each Mentions × HTML paste combination: the
 * markdown preset (input rules, clipboard) and `/` block commands always,
 * the HTML preset (`text/html` on copy and paste) and the `@` trigger + chip
 * when their toggles are on.
 */
const EDITOR_PLUGINS: Record<string, readonly RichTextPlugin[]> = {
    'mention+html': [markdownPreset, htmlPreset, domMention, slash],
    mention: [markdownPreset, domMention, slash],
    html: [markdownPreset, htmlPreset, slash],
    none: [markdownPreset, slash]
};

/** The stable key of an editor plugin set — also the editor's remount key. */
export function editorPluginKey(mention: boolean, htmlPaste: boolean): string {
    return mention && htmlPaste ? 'mention+html' : mention ? 'mention' : htmlPaste ? 'html' : 'none';
}

export function editorPlugins(key: string): readonly RichTextPlugin[] {
    return EDITOR_PLUGINS[key];
}

/** The `mention` slot: a plain function, called by the render engine with the node. */
export const MentionChip = ({ node }: NodeProps<JSXElement, Mention>): JSXElement => (
    <span data-scope="richtext" data-part="mention" title={node.id}>
        @{node.label}
    </span>
);
