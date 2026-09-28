/**
 * `@sigx/richtext-zero` — the richtext editor drawn with `@sigx/zero`
 * components, styled by whichever `@sigx/zero-*` design system the app loads.
 */

export { ZERO_SCOPE, zeroPart } from './anatomy.js';
export type { ZeroPart } from './anatomy.js';
export { ICONS, hasIcon, ZeroIcon } from './icons.js';
export type { ZeroIconProps } from './icons.js';
export { renderZeroToolbarItem, renderZeroToolbarGroup, zeroToolbarItems, blockTypeItem, blockTypeOf, BLOCK_TYPES, BLOCK_TYPE_ID, titleOf, ShortcutKeys, isMacPlatform } from './toolbar.js';
export type { BlockTypeOption } from './toolbar.js';
export { renderZeroLinkPopover } from './link.js';
export { renderZeroBlockMenuItem, renderZeroSuggestion, BLOCK_HINTS } from './menus.js';
export { highlightMarkdown, highlightHtml, highlightSource } from './highlight.js';
export type { Token, TokenKind, Line } from './highlight.js';
export { SourcePane, FORMAT_NAMES, formatName } from './SourcePane.js';
export type { SourcePaneProps } from './SourcePane.js';
export { ZeroRichTextEditor } from './ZeroRichTextEditor.js';
export type { ZeroRichTextEditorProps, EditorViewMode } from './ZeroRichTextEditor.js';
