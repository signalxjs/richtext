# @sigx/richtext

Rich text for [SignalX](https://sigx.dev/) — a schema-driven, mdast-shaped
document model with pluggable formats, an incremental engine that keeps
finalized blocks stable while text streams in, a save-friendly JSON document,
`createTextStream()`, a renderer-neutral render engine with a DOM view, and a
block-tree editor core with a DOM editor. Formats are packages on top:
[`@sigx/richtext-markdown`](../richtext-markdown) today, `@sigx/richtext-html`
next. Zero dependencies beyond the sigx runtime, no `node:` imports.

| Entry | What |
|---|---|
| `@sigx/richtext` | the mdast-shaped AST, the schema (`NodeSpec`, `createSchema`, `standardNodes`), the `DocumentFormat` contract, `createLineEngine` / `createReparseEngine`, `plainTextFormat`, `toJSON` / `fromJSON`, `createTextStream`, `renderDocument`, the `RichTextPlugin` contract, `mentionNode` |
| `@sigx/richtext/testing` | `strip()`, `feed()`, fake surfaces and the surface conformance suite — helpers for tests that stream, render or edit |
| `@sigx/richtext/dom` | `RichTextView` for the web, the default DOM components (`data-scope` / `data-part` styling seam), the `CodeBlock` chrome, the `CodeHighlighter` contract and `highlightedCodeBlock()` |
| `@sigx/richtext/editor` | the block-tree editor core: `createEditor()`, state, steps, history, commands, keymap, input rules, triggers, toolbar items and the `InlineSurface` / `CodeSurface` contracts a platform implements |
| `@sigx/richtext/editor/dom` | `RichTextEditor` for the web: `contenteditable` block surfaces, toolbar, block menu, slash commands, mentions, two-way `source` / `document` models, `data-scope` / `data-part` styling |

## Install

```bash
npm install @sigx/richtext @sigx/richtext-markdown
```

Peers on `@sigx/reactivity` and `@sigx/runtime-core` at the same minor as
your app's `sigx` (`@sigx/runtime-dom` too for `./dom` and `./editor/dom`).

## Taste

A format is a codec into and out of one tree; the core never knows a syntax.

```ts
import { toJSON } from '@sigx/richtext';
import { markdownFormat } from '@sigx/richtext-markdown';

const root = markdownFormat.parse('# Hi\n\nSome **markdown**.');   // an mdast Root, keyed and positioned
markdownFormat.serialize(root);                                     // '# Hi\n\nSome **markdown**.\n'
JSON.stringify(toJSON(root, { format: 'markdown' }));               // the save format, { data: { version: 1, format: 'markdown' } }

const engine = markdownFormat.createIncrementalEngine!();
const a = engine.parse('# Hi\n\nSome **mark');
const b = engine.parse('# Hi\n\nSome **markdown**.');
a.children[0] === b.children[0];                                    // true: finalized blocks keep identity
```

Streaming: `createTextStream({ flushIntervalMs: 16 })` coalesces tokens
into one signal write per frame; pass `stream.value.value` to a view.

```tsx
import { RichTextView } from '@sigx/richtext/dom';
import { markdownFormat } from '@sigx/richtext-markdown';
import { shikiPlugin } from '@sigx/richtext-shiki';

const plugins = [shikiPlugin()];

<RichTextView value={stream.value.value} format={markdownFormat} plugins={plugins} onLink={(url) => router.push(url)} />
```

Every element carries `data-scope="richtext"` and `data-part="heading"`,
`"code"`, `"link"`, … — style them with attribute selectors (the playground's
`styles.css` is the reference stylesheet), or pass `classPrefix="rt"` for
`rt-heading`-style classes, or replace any slot through `components`.

Editing:

```tsx
import { signal } from 'sigx';
import { createSlashPlugin } from '@sigx/richtext/editor';
import { RichTextEditor, createDomMentionPlugin } from '@sigx/richtext/editor/dom';
import { markdownFormat, mentionMarkdown } from '@sigx/richtext-markdown';
import { markdownPreset } from '@sigx/richtext-markdown/editor';

const plugins = [
    markdownPreset,
    createDomMentionPlugin({ onQuery: (q) => people(q), formats: { markdown: mentionMarkdown } }),
    createSlashPlugin(),
];
const note = signal({ md: '# Hi' });

<RichTextEditor format={markdownFormat} model:source={[note, 'md']} plugins={plugins} placeholder="Write…" />
```

A block-tree editor on the same tree: one `contenteditable` per paragraph or
heading, a `<textarea>` per code block, Enter / Backspace / arrows / Tab
handled by the core, undo grouped by typing, a toolbar, block handles with a
menu, `/` commands and `@` mentions. The editor knows no syntax: `format` is
what the `source` model and the controller read and write with, and a
format's preset (`markdownPreset`) brings the input rules and the clipboard
flavour. Elements carry `data-scope="richtext-editor"` (and
`richtext-toolbar`, `richtext-block-menu`, `richtext-suggest`) with
`data-part` — the playground's `editor.css` is the reference stylesheet.

Selections can span blocks: drag across them, Shift+Arrow past a block's
edge, or Shift+click another block. Typing, Backspace, Enter, paste, marks,
links, block types, lists and quotes then act on the whole range, and copy
writes it in every clipboard flavour. Each block keeps its own surface. While
a range is selected, the content element becomes the editing host
(`data-multi`) and every input goes through the core's range commands (the
model: `rangeBlocks`, `deleteRange`, `sliceDoc`, …, all in `./editor`, so
other hosts get the same editing). Code, void and table blocks inside a range
carry `data-in-range`, since they show no native highlight. Tables are all or
nothing: a range never ends inside one. Shift+Up/Down therefore extends text
across blocks; Escape selects whole blocks.

Plugins extend the vocabulary once for every format, renderer and the editor:

```ts
const callout: RichTextPlugin = {
    name: 'callout',
    nodes: [{ type: 'callout', role: 'container', fillsWith: 'paragraph', menu: { label: 'Callout', create: () => ({ type: 'callout', children: [] }) } }],
    components: { dom: { callout: CalloutView } },
    formats: { markdown: calloutMarkdown },   // the syntax, typed by @sigx/richtext-markdown
};
```

## Documentation

Guides, API reference and live examples: **<https://sigx.dev/richtext/>**

Native rendering and editing on Lynx:
[`@sigx/lynx-markdown`](https://sigx.dev/lynx/modules/markdown/overview/).

## License

MIT © Andreas Ekdahl
