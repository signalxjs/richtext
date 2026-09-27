/**
 * `<EditorToolbar>` — `role="toolbar"` over the editor's toolbar items.
 * Buttons carry `data-state="on|off"` from `isActive` and `disabled` from
 * `isEnabled`; `pointerdown` is cancelled so the caret stays in the surface
 * while a button runs its command. Items with the same `group` sit in one
 * `data-part="group"`. Pass `renderItem` to draw items your way (icons).
 */

import { component, type Define, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import { defaultToolbarItems, toolbarState, type ToolbarContext, type ToolbarItem, type ToolbarState } from '../toolbar.js';
import { toolbarPart } from './anatomy.js';
import { useEditorView } from './context.js';
import { track } from './context.js';

export type ToolbarRenderItem = (item: ToolbarItem, tb: ToolbarState, run: () => void) => JSXElement;

export type EditorToolbarProps = Define.WithAttrs<
    & Define.Prop<'items', readonly ToolbarItem[]>
    & Define.Prop<'renderItem', ToolbarRenderItem>
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
        const buttons = Array.from(bar.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
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
        const id = (e.target as HTMLElement).getAttribute('data-item');
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
            if (props.renderItem) return props.renderItem(item, tb, run);
            return (
                <button
                    key={item.id}
                    {...toolbarPart('item')}
                    type="button"
                    data-item={item.id}
                    data-state={active ? 'on' : 'off'}
                    data-icon={item.icon}
                    aria-pressed={item.isActive ? (active ? 'true' : 'false') : undefined}
                    aria-label={item.label ?? item.id}
                    title={item.label ?? item.id}
                    disabled={!enabled}
                    tabIndex={item.id === tabStop ? 0 : -1}
                    onPointerDown={onPointerDown}
                    onClick={run}
                >
                    {item.label ?? item.id}
                </button>
            );
        };
        return (
            <div {...toolbarPart('root')} role="toolbar" aria-label={props.label ?? 'Formatting'} aria-orientation="horizontal" onKeyDown={onKeydown} onFocusIn={onFocusIn}>
                {groups.map((g, i) => (
                    <div key={g.name ?? String(i)} {...toolbarPart('group')} data-group={g.name}>
                        {g.items.map(renderItem)}
                    </div>
                ))}
            </div>
        );
    };
});
