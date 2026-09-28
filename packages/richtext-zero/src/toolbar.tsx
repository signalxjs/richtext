/**
 * Toolbar items and groups as zero parts. An item with `isActive` is a
 * `Toggle` (the skin's pressed treatment), any other a `Button`; both sit
 * in a `Tooltip` naming the item with its shortcut as `Kbd`s. The core's
 * `EditorToolbar` keeps the root and its roving tab stop: every button
 * carries the core's `data-item`, `tabIndex`, `disabled` and the
 * `pointerdown` cancel that keeps the caret in the text.
 *
 * The block-type item (`blockTypeItem`) is a zero `Select` of paragraph,
 * H1–H3, quote and code.
 */

import { createModel, mergeProps, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import { Button, Kbd, Select, Toggle, Tooltip } from '@sigx/zero';
import { commandRegistry as registry, commands, defaultToolbarItems, formatKeyName, type ToolbarContext, type ToolbarItem, type ToolbarState } from '@sigx/richtext/editor';
import type { ToolbarItemAttrs, ToolbarItemInfo, ToolbarRenderGroup, ToolbarRenderItem } from '@sigx/richtext/editor/dom';
import { zeroPart } from './anatomy.js';
import { ZeroIcon } from './icons.js';

/** A mac shows ⌘ where others show Ctrl. */
export function isMacPlatform(): boolean {
    if (typeof navigator === 'undefined') return false;
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent ?? '');
}

/** The keys of a shortcut as `Kbd`s. */
export function ShortcutKeys(shortcut: string | undefined): JSXElement {
    if (!shortcut) return null;
    const keys = formatKeyName(shortcut, { isMac: isMacPlatform() });
    return (
        <span {...zeroPart('item-hint')}>
            {keys.map((k, i) => (
                <Kbd key={String(i)} size="xs">
                    {k}
                </Kbd>
            ))}
        </span>
    );
}

/** The core attrs a zero part does not own: the roving tab stop, `disabled` and the caret-keeping `pointerdown`. */
function roving(attrs: ToolbarItemAttrs): Record<string, unknown> {
    const { key: _key, 'data-scope': _scope, 'data-part': _part, 'data-state': _state, ...rest } = attrs;
    return rest;
}

/** A tooltip around a zero part rendered `asChild` onto one `<button>`. */
function withTooltip(item: ToolbarItem, info: ToolbarItemInfo, part: (tooltip: Record<string, unknown>) => JSXElement): JSXElement {
    return (
        <Tooltip.Root key={item.id} placement="bottom" openDelay={500}>
            <Tooltip.Trigger asChild>{(tooltip: Record<string, unknown>) => part(tooltip)}</Tooltip.Trigger>
            <Tooltip.Popup>
                {item.label && item.label.length > 2 ? item.label : titleOf(item)}
                {item.shortcut ? ' ' : null}
                {ShortcutKeys(item.shortcut)}
            </Tooltip.Popup>
        </Tooltip.Root>
    );
}

const TITLES: Record<string, string> = {
    bold: 'Bold',
    italic: 'Italic',
    strike: 'Strikethrough',
    code: 'Inline code',
    link: 'Link',
    h1: 'Heading 1',
    h2: 'Heading 2',
    h3: 'Heading 3',
    paragraph: 'Text',
    bullet: 'Bulleted list',
    ordered: 'Numbered list',
    task: 'Task list',
    quote: 'Quote',
    codeBlock: 'Code block',
    hr: 'Divider',
    table: 'Table',
    undo: 'Undo',
    redo: 'Redo',
};

/** The item's accessible name: a known title for the default items, else its label, else its id. */
export function titleOf(item: ToolbarItem): string {
    return TITLES[item.id] ?? item.label ?? item.id;
}

/** The glyph, or the item's short label when the set has none. */
function face(item: ToolbarItem): JSXElement {
    return item.icon ? <ZeroIcon name={item.icon} /> : <span {...zeroPart('item-label')}>{item.label ?? item.id}</span>;
}

/** `renderToolbarItem` for `RichTextEditor`: a zero `Toggle` / `Button` in a `Tooltip`. */
export const renderZeroToolbarItem: ToolbarRenderItem = (item, info) => {
    if (item.id === BLOCK_TYPE_ID) return renderBlockType(info);
    const name = titleOf(item);
    // `role: undefined`: an asChild Toggle adds role="button", which a real <button> needs not.
    const own = { ...roving(info.attrs), role: undefined, 'aria-keyshortcuts': item.shortcut ? formatKeyName(item.shortcut, { isMac: isMacPlatform() }).join('+') : undefined };
    if (item.isActive) {
        // Controlled: pressed is the item's state; a press runs the item (the state follows the editor).
        const holder = { get value() { return info.active; } };
        const pressed = createModel<boolean>([holder, 'value'], () => info.run());
        return withTooltip(item, info, (tooltip) => (
            <Toggle.Root asChild model={pressed} label={name} size="sm" disabled={!info.enabled}>
                {(toggle: Record<string, unknown>) => (
                    <button type="button" {...mergeProps(tooltip, toggle, own)}>
                        {face(item)}
                    </button>
                )}
            </Toggle.Root>
        ));
    }
    return withTooltip(item, info, (tooltip) => (
        <Button.Root asChild size="sm" variant="ghost" disabled={!info.enabled}>
            {(button: Record<string, unknown>) => (
                <button type="button" aria-label={name} {...mergeProps(tooltip, button, own, { onClick: info.run })}>
                    {face(item)}
                </button>
            )}
        </Button.Root>
    ));
};

/** `renderToolbarGroup`: the group, then a separator unless it is the last. */
const GROUP_LABELS: Record<string, string> = { history: 'History', type: 'Block type', inline: 'Text formatting', block: 'Blocks', lists: 'Lists', blocks: 'Insert', insert: 'Insert' };

export const renderZeroToolbarGroup: ToolbarRenderGroup = (group, children) => (
    <div {...group.attrs} role="group" aria-label={group.name ? (GROUP_LABELS[group.name] ?? group.name) : undefined}>
        {children}
        {group.index < group.count - 1 ? <span {...zeroPart('separator')} role="separator" aria-orientation="vertical" /> : null}
    </div>
);

// ---------------------------------------------------------------------------
// Block type
// ---------------------------------------------------------------------------

export const BLOCK_TYPE_ID = 'blockType';

export interface BlockTypeOption {
    value: string;
    label: string;
    active(tb: ToolbarState): boolean;
    run(tc: ToolbarContext): void;
}

const headingDepth = (tb: ToolbarState): number | null => (tb.blockType === 'heading' ? Number(tb.attrs.depth) : null);

/** Out of a blockquote first: the select sets the block's own type. */
const unquoted = (tc: ToolbarContext): void => void tc.run(registry.liftOutOfBlockquote);

export const BLOCK_TYPES: readonly BlockTypeOption[] = [
    { value: 'paragraph', label: 'Text', active: (tb) => tb.blockType === 'paragraph' && !tb.inBlockquote, run: (tc) => (unquoted(tc), void tc.run(registry.setParagraph)) },
    { value: 'h1', label: 'Heading 1', active: (tb) => headingDepth(tb) === 1, run: (tc) => (unquoted(tc), void tc.run(registry.setHeading1)) },
    { value: 'h2', label: 'Heading 2', active: (tb) => headingDepth(tb) === 2, run: (tc) => (unquoted(tc), void tc.run(registry.setHeading2)) },
    { value: 'h3', label: 'Heading 3', active: (tb) => headingDepth(tb) === 3, run: (tc) => (unquoted(tc), void tc.run(registry.setHeading3)) },
    { value: 'quote', label: 'Quote', active: (tb) => tb.inBlockquote, run: (tc) => void tc.run(registry.wrapInBlockquote) },
    { value: 'code', label: 'Code block', active: (tb) => tb.blockType === 'code', run: (tc) => (unquoted(tc), void tc.run(commands.setBlockType('code'))) },
];

/** The value the block-type select shows: the first active option, else none (a mixed range). */
export function blockTypeOf(state: ToolbarState): string {
    return BLOCK_TYPES.find((o) => o.active(state))?.value ?? '';
}

/** The option the select just picked; the item's `run` consumes it in the same call. */
let picked: BlockTypeOption | null = null;

/**
 * The block-type item: a zero `Select` in the main toolbar (drawn by
 * `renderZeroToolbarItem`). Choosing a type runs its command on the selection.
 */
export const blockTypeItem: ToolbarItem = {
    id: BLOCK_TYPE_ID,
    label: 'Block type',
    group: 'type',
    isEnabled: (state) => state.mode === 'text',
    run: (tc) => {
        const option = picked;
        picked = null;
        option?.run(tc);
    },
};

function renderBlockType(info: ToolbarItemInfo): JSXElement {
    const holder = { get value() { return blockTypeOf(info.tb); } };
    const value = createModel<string>([holder, 'value'], (next) => {
        picked = BLOCK_TYPES.find((o) => o.value === next) ?? null;
        info.run();
        picked = null;
    });
    return (
        <Select.Root key={BLOCK_TYPE_ID} model={value} placeholder="Block type" size="sm" disabled={!info.enabled}>
            {/* asChild: the trigger takes the core's roving `tabIndex` (zero parts forward no tabIndex). */}
            <Select.Trigger label="Block type" asChild>
                {(trigger: Record<string, unknown>) => (
                    <button type="button" {...mergeProps(trigger, roving(info.attrs))}>
                        <Select.Value />
                        <Select.Indicator />
                    </button>
                )}
            </Select.Trigger>
            <Select.Popup>
                {BLOCK_TYPES.map((o) => (
                    <Select.Item key={o.value} value={o.value}>
                        {o.label}
                    </Select.Item>
                ))}
            </Select.Popup>
        </Select.Root>
    );
}

/** The ids the block-type select replaces in the default item set. */
const REPLACED = new Set(['h1', 'h2', 'h3', 'paragraph', 'codeBlock']);

/**
 * The main toolbar of the design: history, block type, marks, lists, then
 * blocks. Plugin items follow (pass them in; `RichTextEditor`'s `toolbarItems`
 * replaces the defaults and the plugins' both).
 */
export function zeroToolbarItems(extra: readonly ToolbarItem[] = []): ToolbarItem[] {
    const by = (group: string) => defaultToolbarItems.filter((i) => i.group === group && !REPLACED.has(i.id));
    return [
        ...by('history'),
        blockTypeItem,
        ...by('inline'),
        ...by('block').map((i) => ({ ...i, group: i.id === 'quote' ? 'blocks' : 'lists' })),
        ...by('insert').map((i) => ({ ...i, group: 'blocks' })),
        ...extra,
    ];
}
