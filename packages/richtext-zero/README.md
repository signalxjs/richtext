# @sigx/richtext-zero

A finished rich text editor for Markdown and HTML documents, drawn with
[`@sigx/zero`](https://github.com/signalxjs/zero) components and styled by
whichever `@sigx/zero-*` design system the app loads. Swap the design system
and the editor changes its look; the editor itself is
[`@sigx/richtext`](../richtext)'s `RichTextEditor`, untouched.

- A toolbar of zero `Toggle`s and `Button`s with icons, each in a `Tooltip`
  naming it with its shortcut as `Kbd`s, and a block-type `Select`.
- A floating toolbar over the selection, the slash menu, @mention
  suggestions, the block handle's menu and the link popover, drawn with zero
  parts inside the core's positioning.
- A rich / split / source view switch and a Markdown / HTML format switch
  (zero `ToggleGroup`s), a read-only source pane with line numbers and
  highlighting, and a status bar.

## Install

```bash
npm install @sigx/richtext @sigx/richtext-zero @sigx/zero @sigx/zero-basic
```

Peers on `@sigx/richtext`, `@sigx/zero` and the sigx runtime (`sigx`,
`@sigx/reactivity`, `@sigx/runtime-core`, `@sigx/runtime-dom`). Any
`@sigx/zero-*` design system works; `@sigx/zero-basic` is one.

## Use

```tsx
import '@sigx/zero/css';
import '@sigx/zero-basic/css';          // the skin: any @sigx/zero-* design system
import '@sigx/richtext-zero/css';       // layout only
import { ZeroRichTextEditor } from '@sigx/richtext-zero';
import { markdownFormat } from '@sigx/richtext-markdown';
import { markdownPreset } from '@sigx/richtext-markdown/editor';
import { htmlFormat } from '@sigx/richtext-html';
import { htmlPreset } from '@sigx/richtext-html/editor';

const plugins = [markdownPreset, htmlPreset];

<ZeroRichTextEditor
    format={markdownFormat}
    formats={[markdownFormat, htmlFormat]}
    views={['rich', 'split', 'source']}
    model:source={[note, 'md']}
    plugins={plugins}
    title="Design notes"
/>
```

`format` is what the `source` model reads and writes; `formats` are the
formats the source pane can show. `views` picks the views the switch offers
(`model:view` binds the current one), `docFont="serif"` sets the document in
a serif, and `toolbar`, `toolbarItems`, `floatingToolbar`, `blockHandles`,
`statusBar`, `readOnly` and `placeholder` pass through. `onReady` hands over
the `RichTextEditorController`.

The pieces work on a plain `RichTextEditor` too: `renderZeroToolbarItem`,
`renderZeroToolbarGroup`, `renderZeroSuggestion`, `renderZeroLinkPopover` and
`renderZeroBlockMenuItem` fill its skin hooks, `zeroToolbarItems()` is the
design's item set (history, block type, marks, lists, blocks), and
`SourcePane` / `highlightSource` render a format's source.

Every control is a zero part with zero's own `data-scope` / `data-part`, so
the design system styles it. The package's own layout parts sit in
`data-scope="richtext-zero"`. Icons come from a local set keyed by
`ToolbarItem.icon` (`ICONS`, `ZeroIcon`) until `@sigx/zero` ships an `Icon`
part.

## Documentation

Guides, API reference and live examples: **<https://sigx.dev/richtext/>**

## License

MIT © Andreas Ekdahl
