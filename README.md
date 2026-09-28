<div align="center">

# SignalX Richtext

**Rich text for [SignalX](https://sigx.dev/) — one schema-driven document model with pluggable formats, an incremental engine for web, Lynx and terminal, a save-friendly mdast document, and a block-tree editor.**

[![npm](https://img.shields.io/npm/v/@sigx/richtext.svg?label=@sigx/richtext&color=blue)](https://www.npmjs.com/package/@sigx/richtext)
[![license](https://img.shields.io/npm/l/@sigx/richtext.svg)](./LICENSE)
[![ci](https://github.com/signalxjs/richtext/actions/workflows/ci.yml/badge.svg)](https://github.com/signalxjs/richtext/actions/workflows/ci.yml)
[![types](https://img.shields.io/npm/types/@sigx/richtext.svg)](https://www.typescriptlang.org/)

</div>

> 🚧 Early release. The API surface is stabilising — feedback is very welcome.

## 📚 Documentation

Full guides, API reference and live examples → **<https://sigx.dev/richtext/>**

## Packages

| Package / entry | What |
|---|---|
| [`@sigx/richtext`](./packages/richtext) | The foundation: an mdast-shaped AST, the schema (`NodeSpec` as data — the one table that says what every node type is), the `DocumentFormat` contract with a generic incremental engine that keeps finalized blocks stable while text streams in, `toJSON` / `fromJSON`, `createTextStream`, a renderer-neutral render engine and the `RichTextPlugin` contract shared by every format, renderer and the editor |
| `@sigx/richtext/testing` | `strip()`, `feed()`, fake surfaces and the surface conformance suite |
| `@sigx/richtext/dom` | `RichTextView` for the web — default components styled through `data-scope` / `data-part` attributes, a `CodeBlock` chrome with copy button, the `CodeHighlighter` contract |
| `@sigx/richtext/editor` | The block-tree editor core: state, commands, history, keymap, input rules, triggers and the surface contract a platform implements |
| `@sigx/richtext/editor/dom` | `RichTextEditor` for the web — a Notion-class block editor: contenteditable surfaces per block, toolbar, block handles and menu, slash commands, mentions, two-way `source` / `document` models |
| [`@sigx/richtext-markdown`](./packages/richtext-markdown) | Markdown as a format: the CommonMark + GFM parser, `markdownFormat`, `toMarkdown`, the markdown syntax-extension contract for plugins, `markdownPreset` (`./editor`) |
| [`@sigx/richtext-html`](./packages/richtext-html) | HTML as a format: a platform-free parser for pasted and generated markup, a serializer with the CommonMark reference layout, `htmlFormat`, the HTML syntax-extension contract for plugins and `htmlPreset` (`./editor`, the `text/html` clipboard flavour) |
| [`@sigx/richtext-shiki`](./packages/richtext-shiki) | Shiki highlighting as a plugin: `shikiPlugin()` / `createShikiHighlighter()` (the only package that imports `shiki`) |
| [`@sigx/richtext-zero`](./packages/richtext-zero) | A finished editor drawn with `@sigx/zero` components, styled by whichever `@sigx/zero-*` design system the app loads: `ZeroRichTextEditor` with a toolbar, a floating toolbar, zero-drawn menus and link popover, and a rich / split / source view switch (the only package that imports `@sigx/zero`) |

Examples: [`examples/playground`](./examples/playground) — the view, streaming, plugins, Shiki, the serializer and the editor side by side, with a Playwright suite.

Consumers: [`@sigx/lynx-markdown`](https://sigx.dev/lynx/modules/markdown/overview/) renders and edits the same trees natively on Lynx; [`@sigx/ai`](https://sigx.dev/ai/) chat UI streams assistant messages through it.

## Install

```bash
npm install @sigx/richtext @sigx/richtext-markdown
```

Peers on `@sigx/reactivity` and `@sigx/runtime-core` (and `@sigx/runtime-dom` for the web entries) at the same minor as your app's `sigx`.

## Quick start

```tsx
import { component } from 'sigx';
import { createTextStream } from '@sigx/richtext';
import { RichTextView } from '@sigx/richtext/dom';
import { markdownFormat } from '@sigx/richtext-markdown';

const stream = createTextStream({ flushIntervalMs: 16 });
for await (const token of tokens) stream.append(token);
stream.done();

export const Answer = component(() => () => <RichTextView value={stream.value.value} format={markdownFormat} />);
```

Every finalized block keeps its identity as tokens arrive, so only the block still being written re-renders.

## Why this exists

- **One parser, every surface** — the same AST renders on the web, on Lynx and in the terminal; plugins add syntax, nodes, components, commands and toolbar items once.
- **Streaming-stable** — finalized blocks are the same objects between parses; keys never change, so UI never remounts.
- **mdast native** — the document is a standard mdast `Root`, so it round-trips through `remark` tooling and saves as plain JSON.
- **A real editor** — a block-tree editor core with platform surfaces, not a textarea with a preview.

## Part of SignalX

- [`core`](https://sigx.dev/core/) — `reactivity`, `runtime-core`, `runtime-dom`, `server-renderer`, `server`, `vite`, `sigx`
- [`lynx`](https://sigx.dev/lynx/) · [`ai`](https://sigx.dev/ai/) · [`daisyui`](https://sigx.dev/daisyui/) · [`terminal`](https://sigx.dev/terminal/)
- [Docs site](https://sigx.dev/) — main SignalX documentation

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). PRs welcome.

## License

MIT © Andreas Ekdahl
