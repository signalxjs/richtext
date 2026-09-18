# Changelog

All notable changes to this repo are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); every package in the
workspace shares one version line.

## [Unreleased]

## [0.4.0] - 2026-09-18

### Changed

- **SignalX core retargeted to 1.0; the packages peer on it at `^1.0.0`** (#39,
  #41). The `catalog:` block moves from `^0.15.0` to `^1.0.0`, and
  `@sigx/richtext`, `@sigx/richtext-markdown`, `@sigx/richtext-html` and
  `@sigx/richtext-shiki` now declare `@sigx/reactivity`, `@sigx/runtime-core`
  and `@sigx/runtime-dom` as `peerDependencies: "^1.0.0"` — the app owns the
  single copy of the runtime and any core 1.x satisfies (core rfc-1.0 §3).
  Breaking for consumers still on core 0.15: upgrade core first. No source
  change; the whole suite (2112 tests) and the playground e2e pass unchanged
  on core 1.0.0.

### Fixed

- **`verify:pack` smoked the tarballs against the wrong core** (#39). The
  scratch app's core peer range was hard-coded at `^0.15.0`, so the
  pack-smoke would have installed a 0.15 runtime under 1.0-peered tarballs
  with `--legacy-peer-deps`; it now derives the range from
  `packages/richtext/package.json`.

## [0.3.0] - 2026-09-13

### Added

- **`@sigx/richtext-html`** (#32, phase 6 of #19). HTML as a first-class
  `DocumentFormat`: `parseHtml` is a platform-free parser (a hand-written
  tokenizer and tree, no `DOMParser`) for the markup that reaches a clipboard,
  a CMS field or an LLM answer — the standard element table, browser-style
  structure repair, whitespace collapsing, transparent unknown elements (or
  `unknown: 'drop'`), only `href` / `src` kept and both through the core's
  `sanitizeUrl`; `toHtml` writes the CommonMark reference layout (URLs
  sanitised unless `sanitize: false`); `htmlFormat` (`text/html`) has no
  incremental engine and no extra nodes. Plugins add HTML syntax under
  `formats.html` (`HtmlPluginSlice`: `elements` rules by tag, `serialize`
  rules by node type); `mentionHtml` is the reference slice
  (`<span data-mention="id">@label</span>`). `htmlPreset` (`./editor`) puts
  `text/html` on the clipboard next to the primary format's flavour. Markdown
  ↔ HTML is `htmlFormat.serialize(markdownFormat.parse(src))` and back.

### Changed

- **One HTML writer** (#34, phase 7 of #19). `@sigx/richtext-markdown/testing`
  is gone: its `toHtml()` was the CommonMark conformance renderer, and
  `@sigx/richtext-html`'s `toHtml(tree, { sanitize: false })` is byte-identical
  on the CommonMark and GFM fixtures — the conformance suites now render
  through it (`known-failures.json` unchanged).
- `pickPasteFormat` (and so `Editor.paste`) tries every format's specific
  flavours before `text/plain`: a markdown editor that also reads HTML parses
  a browser's `text/html` instead of the plain text it ships alongside.
- **Package split and repo rename** (#30, phase 5 of #19). `@sigx/markdown`
  becomes three packages — `@sigx/richtext` (the foundation: `.`, `./dom`,
  `./editor`, `./editor/dom`, `./testing`), `@sigx/richtext-markdown`
  (`markdownFormat`, the parser and serializer, `markdownNodes` /
  `markdownSchema`, `collectDefinitions`, the `MarkdownPluginSlice` contract,
  `mentionPlugin` / `mentionMarkdown`; `./editor` with `markdownPreset`;
  `./testing` with `toHtml()`) and `@sigx/richtext-shiki` (`shikiPlugin`,
  `createShikiHighlighter`; the `./shiki` entry is gone and `shiki` is no
  longer a peer of the core) — and the repo becomes `signalxjs/richtext`.
  `@sigx/markdown` is deprecated on npm, not unpublished. Module
  augmentations (`PhrasingContentMap`, `PluginComponents`, `PluginFormats`)
  target `@sigx/richtext`. The core's root entry also exports the text
  helpers (`decodeEntities`, `normalizeLabel`, the character classes) formats
  build on. `createMentionPlugin` / `createDomMentionPlugin` take
  `formats` (`{ markdown: mentionMarkdown }`) instead of bundling the
  markdown syntax; `mentionNode` and the `Mention` type stay in the core.
  Dev warnings are prefixed `[@sigx/richtext]` / `[@sigx/richtext-markdown]`.

- **Format-agnostic DOM editor** (#28, phase 4b of #19). `<RichTextEditor>`
  replaces `<MarkdownEditor>`: `format` (required) is the codec the
  `source` model, `defaultSource` and the controller (`getSource(formatId?)`,
  `setSource(source, formatId?)`) read and write with, `formats` are further
  codecs pasted flavours are read with, and the presets go in `plugins`
  (`markdownPreset` is no longer installed implicitly). `model:markdown` /
  `defaultMarkdown` / `getMarkdown` / `setMarkdown` and the `markdown` field
  of the change event are `source`. Copying a block selection writes every
  flavour the plugins' clipboard writers produce (the primary format as
  `text/plain` when none sets it). The DOM editor entry no longer bundles the
  markdown parser or serializer.
- `data-scope` values are `richtext` (the DOM view), `richtext-editor`,
  `richtext-toolbar`, `richtext-block-menu` and `richtext-suggest` (the
  editor); stylesheets written against the `markdown-*` scopes must be
  updated (the playground's are).
- `<BlockView>` dispatches on the schema role; the list, list item and
  blockquote wrappers are container views (`standardContainerViews`,
  `ContainerView`, `defaultContainerView` in the DOM editor entry), a plugin
  adds its own under `editor.dom.containers` (next to `atoms`;
  `pluginContainerViews`) and the `containers` prop overrides both. Void
  blocks are labelled by their spec's menu entry.
- Mark elements come from the schema: `NodeSpec.html` (`HtmlTagHint { tag,
  aliases? }`) names the element a mark renders as in the DOM editor (and the
  aliases read back as it — `b` for `strong`); nesting order on ties is
  `spec.inline.priority`. `renderInline` takes `schema` in its options;
  without one every mark is a `span[data-mark]`. The standard marks carry
  their hints (`strong` / `b`, `em` / `i`, `del` / `s` / `strike`,
  `code`, `a`).

- **Format-agnostic editor core** (#26, phase 4a of #19). `createEditor` takes
  `format` (the primary format) and `formats` (further ones it reads); the
  schema is the standard specs plus the formats' and plugins' `nodes`.
  `Editor.setSource(source, formatId?)` replaces `setMarkdown`;
  `Editor.paste(data: PasteData)` replaces `paste(text, markdown?)` — the
  first format that reads a flavour present (`text`, `text/markdown`,
  `text/html`, …) parses it, plain text falls back to `plainTextFormat`
  (markdown lists `text/plain` last, so a markdown editor claims it);
  `Editor.clipboard(root)` collects the plugins' clipboard writers.
  `SurfacePasteEvent` is `{ data, range }` and `BridgeHost.paste(data)`; the
  DOM surface reads every clipboard type. `EditorOptions.parse`, `blocksOf`
  and `pasteText` are gone; `CommandContext` is `{ schema, formats, plugins }`.
- Commands split into a generic core (`commands.ts`: no node type by name —
  roles, `schema.defaultBlock` and the new spec flags `isolating`,
  `collapsesWhenEmpty`, `moveAsUnit`) and the standard vocabulary
  (`commands-standard.ts`: lists, quotes, tables, headings, links); `registry.ts`
  names them all (the `commands` namespace and `commandRegistry` of the editor
  entry). `splitBlock` = `chain(splitListItem, liftOutOfBlockquoteAtEnd,
  splitTextBlock)` and `joinBackward` = `chain(joinBackwardInList,
  liftOutOfBlockquoteAtStart, joinTextBackward)` reproduce the old
  precedence; `chain()` is exported.
- Input rules are a preset, not the core: `markdownPreset` (editor entry;
  `markdownInputRules`, `markdownEnterRules`, a `text/markdown` clipboard
  writer) replaces `baseInputRules` / `enterInputRules` / `TRIGGER_CHARS`. An
  editor without it never interprets markdown syntax. `InputRule.triggers`
  declares the characters that fire a rule (`triggerChars(rules)` unions
  them); `EditorPluginSlice` gains `enterRules` and `clipboard`;
  `applyEnterRules` takes the rules. `ToolbarState.ancestors` lists the
  block's ancestor types.

- **Formats and format-agnostic plugins** (#24, phase 3 of #19). A
  `DocumentFormat { id, mime, nodes?, parse, serialize, createIncrementalEngine? }`
  is the codec between source text and the one tree; `markdownFormat`
  (`@sigx/markdown` root entry) and `plainTextFormat` (`document/`) implement
  it. The incremental engine is generic: `createLineEngine(LineBlockParser)`
  is the streaming-stable engine over any line-oriented block parser
  (markdown's `createIncrementalEngine` is a thin wrapper), and
  `createReparseEngine(parse)` is the fallback for a format without one.
  `<RichTextView>` takes a required `format` — the DOM entry knows no format
  and no longer bundles the markdown parser or serializer.
- `RichTextPlugin { name, nodes, components, editor, formats }` replaces
  `MarkdownPlugin`: syntax lives under `formats.markdown` (a
  `MarkdownPluginSlice` — `block`, `inline`, `serialize`, `entities`,
  `transformBlock`, `transformDocument`), one slot per format id
  (`PluginFormats` is interface-merged by each format). `resolvePlugins` /
  `ResolvedPlugins` / `NO_PLUGINS` are `resolveMarkdownPlugins` /
  `ResolvedMarkdownPlugins` / `NO_MARKDOWN_PLUGINS`; `MarkdownPlatformComponents`
  is `PlatformComponents`. `mentionPlugin` is `{ nodes, formats: { markdown:
  mentionMarkdown } }`.
- `createMarkdownStream` / `MarkdownStream` are `createTextStream` /
  `TextStream` (the stream never touched markdown). `toJSON({ format })`
  records the source format in `data.format`; `MarkdownDocument` /
  `MarkdownFormatError` are `RichTextDocument` / `DocumentFormatError`.

- **Schema-driven render engine** (#22, phase 2 of #19). `render/engine.ts`
  has no per-type code any more: one `renderNode` reads the `NodeSpec` —
  `props` (what the component receives beyond `node` and `children`: a
  heading's `depth`, a list item's `number`, a cell's `align`, a link's
  sanitised `url`), `render` (the escape hatch references use), `text` (the
  projection a node renders as without a component), `collect` (the render
  env — CommonMark definitions are gathered by the `definition` spec).
  `RenderContext` takes `schema` (required) and `env` (replaces
  `definitions`); `collectEnv()` and `missingComponents()` are exported. The
  serialize-rule render fallback is gone: a node without a component renders
  its spec's `text`, else its children.
- Component contract renamed: `ComponentMap<E>` (only `root` required),
  `StandardComponents<E>`, `PluginComponents<E>`, `RenderChild<E>` replace
  `MarkdownComponents` / `MarkdownComponentMap` / `MarkdownPluginComponents` /
  `MarkdownChild`; the DOM map is `DomComponents`. `RenderContext.plugins` is
  gone.
- `<MarkdownView>` is `<RichTextView>` (`schema` prop; merges the DOM
  renderers plugins ship through `components.dom`).
  `MarkdownPlatformComponents` declares `dom` / `lynx` / `terminal` slots.
- The highlighter contract (`CodeHighlighter`, `HighlightedToken`,
  `plainTokens`) and the highlighted code block (`highlightedCodeBlock`, was
  `shikiCodeBlock`) live in `@sigx/markdown/dom`; `@sigx/markdown/shiki` keeps
  `createShikiHighlighter` and adds `shikiPlugin()` — the only module that
  imports `shiki`.
- `mentionNode` (the mention `NodeSpec`, with a `@label` text projection) is
  part of `mentionPlugin` in the root entry.

- **Schema as data** (#20, phase 1 of #19). One `Schema` now says what every
  node type is — `NodeSpec { type, role, … }` with roles `textblock`,
  `container`, `table`, `code`, `void`, `inline`, `mark`, `atom` — and every
  layer reads it instead of carrying its own list: key assignment, the
  editor's block index, steps and transactions, the flat inline model, the
  menus. `createSchema(specs)` implies nothing; `standardNodes` /
  `standardSchema` are the mdast vocabulary the core owns, `markdownNodes` /
  `markdownSchema` add what markdown needs (`html`, `definition`,
  `linkReference`, `imageReference`). A plugin registers node types through
  `MarkdownPlugin.nodes` (replaces `editor.blockEditors` + `editor.inline`);
  its flat-model mapping lives on the spec (`inline: { literal, wrapsLiteral,
  priority, toFlat, fromFlat }`).
- Breaking, no aliases kept: `editor/schema.ts` (`BlockEditorSpec`,
  `SurfaceKind`, `builtinBlockEditors`, the editor-local `createSchema`),
  `EDITABLE_TYPES`, `isContainerType`, `InlineKindSpec`, `InlineFlatOptions`,
  `mentionInlineKind` (now `mentionNode`) and `isKeyedType` are gone.
  `Schema.kind()` is `Schema.role()` and the `'inline'` surface kind is the
  `'textblock'` role. `toFlat` / `toInline` / `buildIndex` / `createState` /
  `normalizeDoc` / `emptyDoc` take the schema; `StepContext` is `{ schema }`
  and `applyTransaction` / `applyStep` / `invertStep` require it;
  `mapSelection` takes the schema. `InlineSurfaceInit` and `BridgeHost` carry
  `schema` so surfaces compare flat models exactly (`flatEquals`,
  `mergeAdjacent`, `marksAt` and `diffFlat` accept it). `createSlashPlugin`
  takes `nodes` instead of `blockEditors`; `EditorOptions.schema` overrides the
  derived schema.
- `toJSON` / `fromJSON` / `MarkdownFormatError` and `collectDefinitions` moved
  from `ast/` to the new `document/` folder (`fromJSON(input, { schema })`,
  `collectDefinitions(root, schema)`); `ast/` keeps only the node types,
  positions, `topKey` / `childKey` and `visit`.

## [0.2.0] - 2026-09-12

### Added

- `@sigx/markdown/editor` entry (#11) — the platform-neutral block-tree editor
  core: an immutable `Root` with structural sharing and a key-addressed
  selection (`EditorState`), the `InlineFlat` model surfaces speak (marks as
  ranges, atoms as U+FFFC, lossless both ways), invertible steps and
  transactions with selection mapping, grouped undo history (typing groups,
  one entry per IME composition, `undoInputRule`), the editing schema
  (`BlockEditorSpec` with inline / code / void / container / table kinds),
  every command (split and join, block types, lists with indent and outdent,
  task toggles, blockquotes, tables, void blocks, move / duplicate / delete,
  selection and document commands, markdown-aware paste), a keymap with
  `baseKeymap`, markdown input rules (`# `, `- `, `1. `, `- [ ] `, `> `,
  `**x**`, `*x*`, `` `x` ``, `~~x~~`, `[t](u)`, a fence and `---` on Enter),
  the trigger session state machine and popup placement math, `ToolbarItem` +
  `defaultToolbarItems`, the `InlineSurface` / `CodeSurface` contracts a
  platform implements, the surface bridge with echo suppression and the IME
  contract, the `MarkdownPlugin.editor` slice, and `createEditor()`.
- `@sigx/markdown/testing`: `createFakeInlineSurface` / `createFakeCodeSurface`
  and `runInlineSurfaceConformance()` — the suite every surface implementation
  (DOM, Lynx, the fake) runs.
- `@sigx/markdown/editor/dom` entry (#13) — the web block editor:
  - **`<MarkdownEditor>`** — two-way `markdown` (string) and `document`
    (mdast `Root`) models with echo suppression, `defaultMarkdown` /
    `defaultDocument`, `plugins`, `components`, `atoms`, `toolbar`
    (`true | 'top' | 'bottom' | false`), `toolbarItems`, `renderToolbarItem`,
    `renderSuggestion`, `blockHandles`, `readOnly`, `placeholder`,
    `autofocus`, `keymap`, `inputRules`, `onChange`, `onSelectionChange`, a
    `ready` event and a `ref` controller (`editor`, `getMarkdown`,
    `getDocument`, `setMarkdown`, `setDocument`, `run`, `focus`, `blur`,
    `clear`, `undo`, `redo`). Renders read-only through `<MarkdownView>` on
    the server and before mount.
  - **Blocks** — keyed `<BlockView>`s dispatching on the schema kind: inline
    containers (paragraph, heading, table cell) as `contenteditable` hosts
    owned by a `DomInlineSurface`, code and `html` blocks as a `<textarea>`
    `DomCodeSurface` with a language field, void blocks (rendered by the DOM
    components, selectable), lists (with task checkboxes), blockquotes and
    tables. Structural sharing in the state means an untouched block is
    never re-rendered or re-mounted.
  - **Surfaces** — `createDomInlineSurface()`: a single-line port of the
    Lynx web element's DOM algorithms (`renderInline` / tolerant
    `readInline`, `offsetToPoint` / `pointToOffset`, shadow-root aware
    selection, caret rects, first/last visual line detection), boundary keys
    for the core, chords forwarded to the keymap, `beforeinput` routing for
    virtual keyboards and native format/history commands, paste, IME with
    post-`compositionend` dedupe, progressive Mod-a. Passes the surface
    conformance suite under happy-dom.
  - **Chrome** — `<EditorToolbar>` (`role="toolbar"`, `data-state="on|off"`),
    block handles opening `<BlockMenu>` (turn into, move, duplicate, delete;
    `role="menu"` with roving focus), `<SuggestionPopup>` (`role="listbox"`)
    driven by trigger sessions with the caret kept in the surface, block
    selection on the editor root (Escape, Shift-arrows, Backspace/Delete,
    copy/cut as markdown, a live region), a click below the last block
    focusing its end. Every element carries `data-scope` (`markdown-editor`,
    `markdown-toolbar`, `markdown-block-menu`, `markdown-suggest`) and
    `data-part` attributes; no CSS ships (`examples/playground/src/editor.css`
    is the reference stylesheet).
  - **Plugins** — `createDomMentionPlugin()` (the mention syntax, atom kind,
    `@` trigger and chip) and, in `./editor`, `createMentionPlugin()`,
    `mentionInlineKind`, `createSlashPlugin()` (`/` block commands from the
    schema menu plus custom items), `turnIntoCommand()`, `filterMenu()`;
    a plugin's `editor.dom.atoms` slot ships chip renderers.
  - `./editor`: `TriggerSelectApi.run()`, an optional `keydown` channel on
    `CodeSurfaceEvents`; `insertBlocks` merges only pasted *paragraphs* into
    the paste edges (a heading, list or code block stays its own block),
    replaces an empty paragraph with the first pasted block and lands the
    caret in the last editable of the last pasted block; `mergeAdjacent` no
    longer treats a built-in mark covering exactly one atom as an atom.
  - Serializer: a run-final `!` stays bare unless the next node starts with
    `[`.
  - `examples/playground`: an Editor toggle (mentions + slash commands,
    bound to the same source as the panes) and eleven Playwright tests
    driving the editor in Chromium.
- Serializer: a bare autolink literal is emitted only at a word boundary
  (otherwise the angle form); a list item whose first paragraph is empty puts
  its marker alone on the line so nested content re-parses correctly.

## [0.1.0] - 2026-09-12

### Added

- `@sigx/markdown` root entry (#7):
  - **AST** — mdast-compatible node types (`Root`, `Paragraph`, `Heading`,
    `Blockquote`, `List`/`ListItem`, `Code`, `Html`, `Definition`, `Table`,
    `Text`, `Emphasis`, `Strong`, `Delete`, `InlineCode`, `Break`, `Link`,
    `Image`, `LinkReference`, `ImageReference`), structurally assignable to
    `@types/mdast`. sigx extensions: `key` (stable reconciliation key on every
    block-level node) and `Code.open` (an unterminated fence while streaming).
    `visit`, `map`, `collectDefinitions`, `assignKeys`, `sliceSource`.
  - **JSON document format** — `toJSON()` / `fromJSON()` with
    `data.version` (`CURRENT_VERSION = 1`) and `MarkdownFormatError`.
  - **Parser** — `parseMarkdown()`: CommonMark block parsing on the
    open-container-stack algorithm (setext headings, indented and fenced code,
    link reference definitions, nested-blockquote laziness, list `spread`),
    the CommonMark emphasis algorithm (rule of 3, Unicode flanking), entity
    and numeric character references, reference links, GFM tables,
    strikethrough, task items and autolink literals (URL and email). Raw HTML
    renders as literal text. Never throws; positions on every node.
    Conformance: 562 of 586 vendored CommonMark 0.31.2 examples (in-scope
    sections) and every GFM fixture; the remaining 24 are enumerated in
    `__tests__/conformance/known-failures.json`.
  - **Incremental engine** — `createIncrementalEngine()`: finalized blocks
    are reused by reference across appends, keys never change, and the cut
    only moves past blocks that can no longer change (proved by a stability
    suite over the whole corpus, char by char and in random chunks).
  - **Serializer** — `toMarkdown()` with deterministic delimiters and
    escaping; `parse(toMarkdown(parse(md)))` is structurally equal to
    `parse(md)`.
  - **Render engine** — platform-generic `renderDocument()` over a
    `MarkdownComponents<E>` map: recursion and key stamping owned by the
    engine, references resolved at render time, URL sanitisation, plugin
    node slots and fallbacks.
  - **Stream** — `createMarkdownStream()` on `@sigx/reactivity`, plus
    `pipe()` for an `AsyncIterable<string>` with abort support.
  - **Plugin contract** — one `MarkdownPlugin` with block and inline syntax
    extensions (trigger-char gated, streaming-safe, hardened), serializer
    rules, transforms, entities and per-platform component slots;
    `mentionPlugin` (`@[label](id)`) as the reference plugin.
- `@sigx/markdown/testing` entry: `strip()`, `stripPositions()`, `toHtml()`
  (spec-conformance HTML), `feed()` and `seededChunks()` for streaming tests.
- `@sigx/markdown/dom` entry (#9): `MarkdownView` on `@sigx/runtime-core` +
  `@sigx/runtime-dom` — one incremental engine per instance so a growing
  `value` re-renders only the live block; props `value | root`, `plugins`,
  `components`, `onLink(url, node, event)`, `linkTarget`, `sanitizeUrl`,
  `classPrefix`, `copyButton`, plus host attributes on the root. Default DOM
  components styled through `data-scope="markdown"` / `data-part` attributes
  (no classes unless `classPrefix`), `CodeBlock` chrome with a language label
  and a clipboard copy button, `html` nodes rendered as text.
- `@sigx/markdown/shiki` entry (#9): `createShikiHighlighter()` (lazy
  `import('shiki')`, `shiki >=3.7.0` optional peer, LRU token cache, dual
  light/dark themes) and `shikiCodeBlock()` — a `code` component whose instance
  survives streaming, highlighting debounced while a fence is open.
- `examples/playground`: a Vite app exercising the view, streaming, plugins,
  Shiki and the serializer, with a Playwright e2e suite run in CI.
- Repo scaffold: `packages/markdown` (`@sigx/markdown`) with the sigx standard
  build, test, catalog and release setup.
