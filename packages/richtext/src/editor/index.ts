/**
 * `@sigx/richtext/editor` — the platform-neutral block-tree editor core.
 *
 * No DOM here: this entry runs in Node, in the browser and on the Lynx
 * background thread. A platform view (`@sigx/richtext/editor/dom`,
 * `@sigx/lynx-markdown/editor`) renders the blocks, implements the
 * `InlineSurface` / `CodeSurface` contracts and wires them through the bridge.
 * The core knows no format: it edits the tree; a format's preset
 * (`markdownPreset` from `@sigx/richtext-markdown/editor`, with
 * `markdownFormat`) makes it a markdown editor.
 */

export { createEditor } from './editor.js';
export type { Editor, EditorOptions, EditorListener } from './editor.js';

export { createState, normalizeDoc, buildIndex, makeState, emptyDoc, textSelection, textRange, blockSelection, selectionRange, selectionEquals, isCrossBlock, comparePoints } from './state.js';
export type { EditorState, EditorSelection, TextSelection, BlockSelection, Point, BlockIndex, BlockEntry, EditorBlock, EditorParent } from './state.js';

export { applyStep, invertStep, applyMove, updateBlock, updateChildren, rekey, rekeyChildren, flatOf, getBlock, StepError } from './steps.js';
export type { Step, StepContext } from './steps.js';

export { applyTransaction, mapSelection, transaction } from './transaction.js';
export type { Transaction, TransactionMeta, TransactionOrigin, AppliedTransaction } from './transaction.js';

export { createHistory } from './history.js';
export type { History, HistoryEntry, HistoryOptions } from './history.js';

export {
    ATOM_CHAR,
    toFlat,
    toInline,
    flatEquals,
    spliceFlat,
    sliceFlat,
    concatFlat,
    marksAt,
    toggleMark as toggleFlatMark,
    addMark,
    removeMark,
    normalizeSpans,
    mergeAdjacent,
    isPhrasingNode,
} from './inline-flat.js';
export type { InlineFlat, InlineSpan } from './inline-flat.js';

export { createSchema, standardNodes, standardSchema } from '../schema/index.js';
export type { Schema, NodeSpec, NodeRole, InlineFlatSpec, BlockMenuEntry } from '../schema/index.js';

export * as commands from './registry.js';
export { commands as commandRegistry, selectedBlockKeys, blocksToRoot, replaceSelectedBlocks, chain, sequence } from './registry.js';
export type { Command, CommandContext, CommandName, Dispatch, ListKind } from './registry.js';

export { orderedRange, rangeBlocks, normalizeTextRange, normalizeSelection } from './range.js';
export type { OrderedRange, RangeBlock } from './range.js';

export { pickPasteFormat } from './paste.js';
export type { PasteData } from './paste.js';

export { keyName, keyNames, normalizeKeyName, canonicalKey } from './keys.js';
export type { KeyEventLike, KeyPlatform } from './keys.js';
export { baseKeymap, resolveKeymap, runKeymap } from './keymap.js';
export type { KeyName, Keymap, KeymapBinding, ResolvedKeymap, HistoryCommand } from './keymap.js';

export { applyInputRules, applyEnterRules, isInputRuleEntry, triggerChars } from './input-rules.js';
export type { InputRule, InputRuleContext, EnterRule } from './input-rules.js';


export { toolbarState, defaultToolbarItems } from './toolbar.js';
export type { ToolbarItem, ToolbarState, ToolbarContext } from './toolbar.js';

export { createTriggerSessionManager, placeSuggestionPopup } from './trigger/index.js';
export type {
    TriggerItem,
    TriggerSpec,
    TriggerSelectApi,
    TriggerSession,
    TriggerSessionManager,
    TriggerSessionManagerOptions,
    CaretRect as PopupCaretRect,
    PopupPlacement,
    PlaceSuggestionPopupOptions,
} from './trigger/index.js';

export type {
    InlineSurface,
    InlineSurfaceInit,
    InlineSurfaceEvents,
    CodeSurface,
    CodeSurfaceInit,
    CodeSurfaceEvents,
    AnySurface,
    SurfaceHost,
    PlatformInfo,
    Range,
    CaretRect,
    BoundaryKey,
    SurfaceChangeEvent,
    SurfaceSelectionEvent,
    SurfaceBoundaryEvent,
    SurfacePasteEvent,
} from './surface.js';

export { createInlineBridge, createCodeBridge, diffFlat, clampRange } from './bridge.js';
export type { BridgeHost, InlineBridge, CodeBridge } from './bridge.js';

export { editorSlice } from './plugin.js';
export type { EditorPlugin, EditorPluginSlice, ClipboardWriter } from './plugin.js';

export { turnIntoCommand, filterMenu } from './menu.js';
export { createSlashPlugin } from './slash.js';
export type { SlashItem, SlashPluginOptions } from './slash.js';
export { createMentionPlugin } from './mention.js';
export type { MentionItem, MentionPluginOptions } from './mention.js';
