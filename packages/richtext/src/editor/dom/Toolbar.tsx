/**
 * `<EditorToolbar>` — `role="toolbar"` over the editor's toolbar items.
 * Buttons carry `data-state="on|off"` from `isActive` and `disabled` from
 * `isEnabled`; `pointerdown` is cancelled so the caret stays in the surface
 * while a button runs its command. Items with the same `group` sit in one
 * `data-part="group"`.
 *
 * Skins draw items with `renderItem` and groups with `renderGroup`. The
 * toolbar keeps the roving tab stop: a skin's item spreads `info.attrs`
 * onto its `<button>` (they carry `data-item`, `tabIndex`, `disabled` and
 * the `pointerdown` cancel) and calls `info.run` when pressed.
 */

import { component, type Define, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import { defaultToolbarItems, toolbarState, type ToolbarContext, type ToolbarItem, type ToolbarState } from '../toolbar.js';
import { toolbarPart, type ScopedPartAttrs } from './anatomy.js';
import { useEditorView } from './context.js';
import { track } from './context.js';

/** What the toolbar hands a skin for one item. */
export interface ToolbarItemInfo {
    tb: ToolbarState;
    /** `isEnabled` under the editor's read-only state; `run` does nothing when `false`. */
    enabled: boolean;
    /** `isActive`, `false` for items without one. */
    active: boolean;
    /** Run the item's command (a no-op while disabled). */
    run: () => void;
    /** Spread onto the item's `<button>`: the roving tab stop and the caret-keeping `pointerdown` depend on them. */
    attrs: ToolbarItemAttrs;
}

export type ToolbarItemAttrs = ScopedPartAttrs & {
    key: string;
    'data-item': string;
    'data-state': 'on' | 'off';
    'data-icon': string | undefined;
    tabIndex: number;
    disabled: boolean;
    onPointerDown: (e: PointerEvent) => void;
};

/** A group of adjacent items with the same `group`; `index` counts from 0 in toolbar order. */
export interface ToolbarGroupInfo {
    name: string | undefined;
    index: number;
    count: number;
    /** Spread onto the group's element. */
    attrs: ScopedPartAttrs & { key: string; 'data-group': string | undefined };
}

export type ToolbarRenderItem = (item: ToolbarItem, info: ToolbarItemInfo) => JSXElement;
export type ToolbarRenderGroup = (group: ToolbarGroupInfo, children: JSXElement[]) => JSXElement;

export type EditorToolbarProps = Define.WithAttrs<
    & Define.Prop<'items', readonly ToolbarItem[]>
    & Define.Prop<'renderItem', ToolbarRenderItem>
    & Define.Prop<'renderGroup', ToolbarRenderGroup>
    & Define.Prop<'label', string>
>;

export const EditorToolbar = component<EditorToolbarProps>(({ props, signal }) => {
    const view = useEditorView();
    const { editor } = view;
    /** Roving tabindex: one button is in the tab order (the last focused, else the first enabled). */
    const roving = signal<string | null>(null);

    const context = (): ToolbarContext => ({
        state: editor.state,
        dispatch: editor.dispatch,
        ctx: editor.ctx,
        run: (command) => editor.run(command),
        ui: { openLinkEditor: () => view.openLinkEditor() },
    });

    const onPointerDown = (e: PointerEvent): void => {
        e.preventDefault();
    };

    const onKeydown = (e: KeyboardEvent): void => {
        // Roving focus across the toolbar with the arrow keys.
        const bar = e.currentTarget as HTMLElement;
        const buttons = Array.from(bar.querySelectorAll<HTMLButtonElement>('button[data-item]:not([disabled])'));
        const i = buttons.indexOf(bar.ownerDocument.activeElement as HTMLButtonElement);
        if (i < 0 || !buttons.length) return;
        let next: HTMLButtonElement;
        if (e.key === 'ArrowRight') next = buttons[(i + 1) % buttons.length];
        else if (e.key === 'ArrowLeft') next = buttons[(i - 1 + buttons.length) % buttons.length];
        else if (e.key === 'Home') next = buttons[0];
        else if (e.key === 'End') next = buttons[buttons.length - 1];
        else return;
        e.preventDefault();
        next.focus();
    };

    const onFocusIn = (e: FocusEvent): void => {
        const id = (e.target as HTMLElement).closest?.('[data-item]')?.getAttribute('data-item');
        if (id) roving.value = id;
    };

    return () => {
        track(editor.selRev.value, editor.rev.value);
        const tb = toolbarState(editor.state, editor.ctx, editor.history);
        // The default set, then what plugins contribute; `items` replaces both.
        const items = props.items ?? [...defaultToolbarItems, ...editor.toolbarItems];
        const readOnly = view.readOnly();
        const groups: { name: string | undefined; items: ToolbarItem[] }[] = [];
        for (const item of items) {
            const last = groups[groups.length - 1];
            if (last && last.name === item.group) last.items.push(item);
            else groups.push({ name: item.group, items: [item] });
        }
        const enabledOf = (item: ToolbarItem): boolean => !readOnly && (item.isEnabled ? item.isEnabled(tb) : tb.mode !== 'none');
        const current = roving.value;
        const tabStop = items.find((i) => i.id === current && enabledOf(i))?.id ?? items.find(enabledOf)?.id ?? items[0]?.id;
        const renderItem = (item: ToolbarItem): JSXElement => {
            const enabled = enabledOf(item);
            const active = item.isActive?.(tb) ?? false;
            const run = (): void => {
                if (!enabled) return;
                item.run(context());
            };
            const attrs: ToolbarItemAttrs = {
                key: item.id,
                ...toolbarPart('item'),
                'data-item': item.id,
                'data-state': active ? 'on' : 'off',
                'data-icon': item.icon,
                tabIndex: item.id === tabStop ? 0 : -1,
                disabled: !enabled,
                onPointerDown,
            };
            if (props.renderItem) return props.renderItem(item, { tb, enabled, active, run, attrs });
            return (
                <button
                    {...attrs}
                    type="button"
                    aria-pressed={item.isActive ? (active ? 'true' : 'false') : undefined}
                    aria-label={item.label ?? item.id}
                    title={item.label ?? item.id}
                    onClick={run}
                >
                    {item.label ?? item.id}
                </button>
            );
        };
        return (
            <div {...toolbarPart('root')} role="toolbar" aria-label={props.label ?? 'Formatting'} aria-orientation="horizontal" onKeyDown={onKeydown} onFocusIn={onFocusIn}>
                {groups.map((g, i) => {
                    const attrs = { key: g.name ?? String(i), ...toolbarPart('group'), 'data-group': g.name };
                    const children = g.items.map(renderItem);
                    if (props.renderGroup) return props.renderGroup({ name: g.name, index: i, count: groups.length, attrs }, children);
                    return <div {...attrs}>{children}</div>;
                })}
            </div>
        );
    };
});
