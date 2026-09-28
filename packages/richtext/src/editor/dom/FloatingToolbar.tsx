/**
 * `<FloatingToolbar>` — a toolbar over the text selection.
 *
 * Shows above a non-collapsed text selection (in one block or across
 * blocks) while the editor has focus; hidden for a caret, in a code block,
 * while read-only or composing, while the link popover is open and while
 * `suppressed` (a suggestion session). It is an `<EditorToolbar>` — same
 * items, roving focus, `data-state`, and buttons that keep the selection —
 * inside an `editorPart('bubble')` wrapper positioned in the editor root.
 */

import { component, type Define, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import { isCrossBlock } from '../state.js';
import { defaultToolbarItems, type ToolbarItem } from '../toolbar.js';
import { editorPart } from './anatomy.js';
import { useEditorView } from './context.js';
import { track } from './context.js';
import { selectionBox } from './popup.js';
import { EditorToolbar, type ToolbarRenderGroup, type ToolbarRenderItem } from './Toolbar.js';

/** The default floating items: inline formatting and the link. */
export const FLOATING_TOOLBAR_ITEMS: readonly string[] = ['bold', 'italic', 'strike', 'code', 'link'];

export type FloatingToolbarProps = Define.Prop<'items', readonly ToolbarItem[]> & Define.Prop<'renderItem', ToolbarRenderItem> & Define.Prop<'renderGroup', ToolbarRenderGroup> & Define.Prop<'suppressed', boolean>;

export const FloatingToolbar = component<FloatingToolbarProps>(({ props }) => {
    const view = useEditorView();
    const { editor } = view;
    const defaults = defaultToolbarItems.filter((i) => FLOATING_TOOLBAR_ITEMS.includes(i.id));

    return (): JSXElement | undefined => {
        track(editor.rev.value, editor.selRev.value, view.linkRev.value, view.focusRev.value);
        const state = editor.state;
        const sel = state.selection;
        const root = view.root();
        if (!root || !sel || sel.mode !== 'text' || props.suppressed) return undefined;
        if (!view.hasFocus() || view.readOnly() || state.composing || view.linkEditing()) return undefined;
        const cross = isCrossBlock(sel);
        if (!cross) {
            if (sel.anchor.offset === sel.head.offset) return undefined;
            const node = state.index().get(sel.anchor.key)?.node;
            if (!node || editor.schema.role(node.type) !== 'textblock') return undefined;
        }
        const surface = view.surfaces.get(sel.head.key) as { caretRect?: () => { x: number; y: number; height: number } | null } | undefined;
        // No geometry (not laid out yet, or a DOM without layout): the root's origin.
        const box = selectionBox(root, () => surface?.caretRect?.() ?? null) ?? { left: 0, top: 0, bottom: 0 };
        return (
            <div {...editorPart('bubble')} style={`position:absolute;left:${Math.max(0, box.left)}px;top:${box.top - 6}px;transform:translateY(-100%)`}>
                <EditorToolbar items={props.items ?? defaults} renderItem={props.renderItem} renderGroup={props.renderGroup} label="Selection formatting" />
            </div>
        );
    };
});
