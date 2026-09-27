/**
 * `<BlockMenu>` — the menu a block handle opens: turn the block into
 * another type, move it, duplicate it, delete it; on a table, add and
 * delete rows and columns and align the column. `role="menu"` with roving
 * focus; Escape or an outside pointer-down closes it and focus returns to
 * the editor.
 */

import { component, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import { deleteBlock, duplicateBlock, moveBlockDown, moveBlockUp, selectBlock, type Command } from '../commands.js';
import { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow, setColumnAlign } from '../commands-standard.js';
import { turnIntoCommand } from '../menu.js';
import { textSelection } from '../state.js';
import { blockMenuPart } from './anatomy.js';
import { useEditorView } from './context.js';
import { track } from './context.js';
import { anchoredPosition, onDismiss, roveList } from './popup.js';

interface MenuAction {
    id: string;
    label: string;
    icon?: string;
    command: Command;
    /** A table action: runs with the caret in a cell of the menu's table instead of on the block selection. */
    cell?: boolean;
}

const TABLE_ACTIONS: MenuAction[] = [
    { id: 'table:addRowBefore', label: 'Add row above', icon: 'row-insert-top', command: addRowBefore, cell: true },
    { id: 'table:addRowAfter', label: 'Add row below', icon: 'row-insert-bottom', command: addRowAfter, cell: true },
    { id: 'table:addColumnBefore', label: 'Add column left', icon: 'column-insert-left', command: addColumnBefore, cell: true },
    { id: 'table:addColumnAfter', label: 'Add column right', icon: 'column-insert-right', command: addColumnAfter, cell: true },
    { id: 'table:deleteRow', label: 'Delete row', icon: 'row-remove', command: deleteRow, cell: true },
    { id: 'table:deleteColumn', label: 'Delete column', icon: 'column-remove', command: deleteColumn, cell: true },
    { id: 'table:alignLeft', label: 'Align column left', icon: 'align-left', command: setColumnAlign('left'), cell: true },
    { id: 'table:alignCenter', label: 'Align column center', icon: 'align-center', command: setColumnAlign('center'), cell: true },
    { id: 'table:alignRight', label: 'Align column right', icon: 'align-right', command: setColumnAlign('right'), cell: true },
];

export const BlockMenu = component(({ onUnmounted }) => {
    const view = useEditorView();
    const { editor } = view;
    let el: HTMLElement | null = null;
    let dispose: (() => void) | null = null;

    const close = (): void => {
        const req = view.blockMenu();
        view.closeBlockMenu();
        if (req) view.focusRoot();
    };

    const attach = (node: HTMLElement | null): void => {
        dispose?.();
        dispose = null;
        el = node;
        if (!node) return;
        const req = view.blockMenu();
        dispose = onDismiss(node, close, req?.anchor);
        // The element is attached before it is inserted: focus once it is.
        queueMicrotask(() => node.isConnected && node.querySelector<HTMLElement>('[role=menuitem]')?.focus());
    };

    onUnmounted(() => dispose?.());

    /** Focus follows the selection the action left: the clicked menu item is gone with the menu. */
    const refocus = (): void => {
        const sel = editor.state.selection;
        if (sel?.mode === 'block') view.focusRoot();
        else if (sel?.mode === 'text' && sel.anchor.key === sel.head.key) view.focusBlock(sel.anchor.key, { offset: sel.head.offset });
    };

    const run = (action: MenuAction): void => {
        const req = view.blockMenu();
        if (!req) return;
        view.closeBlockMenu();
        if (action.cell) {
            // Table actions act on a cell: the one with the caret when it is in this table, else the first body cell.
            const sel = editor.state.selection;
            const inTable = sel?.mode === 'text' && sel.anchor.key === sel.head.key && sel.anchor.key.startsWith(req.key + '.');
            if (!inTable) {
                const rows = (editor.state.index().get(req.key)?.node as { children?: unknown[] } | undefined)?.children?.length ?? 0;
                editor.setSelection(textSelection(`${req.key}.${rows > 1 ? 1 : 0}.0`, 0));
            }
            editor.run(action.command);
            refocus();
            return;
        }
        // Commands act on the selection: select the block first.
        editor.run(selectBlock(req.key));
        editor.run(action.command);
        refocus();
    };

    const onKeydown = (e: KeyboardEvent): void => {
        if (!el) return;
        if (roveList(el, e, '[role=menuitem]')) return;
        if (e.key === 'Tab') {
            e.preventDefault();
            close();
        }
    };

    return (): JSXElement | undefined => {
        const req = view.blockMenu();
        const root = view.root();
        if (!req || !root) return undefined;
        track(editor.rev.value);
        const entry = editor.state.index().get(req.key);
        if (!entry) return undefined;
        const role = editor.schema.role(entry.node.type);
        const turnInto: MenuAction[] = editor.schema
            .menu()
            .filter((spec) => spec.type !== entry.node.type && spec.type !== 'table' && spec.type !== 'thematicBreak')
            .filter((spec) => role === 'textblock' || role === 'code' || spec.role === 'textblock')
            .map((spec) => ({ id: `turn:${spec.type}`, label: spec.menu!.label, icon: spec.menu!.icon, command: turnIntoCommand(spec) }));
        const actions: MenuAction[] = [
            { id: 'moveUp', label: 'Move up', icon: 'arrow-up', command: moveBlockUp },
            { id: 'moveDown', label: 'Move down', icon: 'arrow-down', command: moveBlockDown },
            { id: 'duplicate', label: 'Duplicate', icon: 'copy', command: duplicateBlock },
            { id: 'delete', label: 'Delete', icon: 'trash', command: deleteBlock },
        ];
        const table = role === 'table' ? TABLE_ACTIONS : [];
        const pos = anchoredPosition(req.anchor, root, table.length ? 520 : 280);
        const item = (a: MenuAction): JSXElement => (
            <button key={a.id} {...blockMenuPart('item')} type="button" role="menuitem" data-action={a.id} data-icon={a.icon} tabIndex={-1} onClick={() => run(a)}>
                {a.label}
            </button>
        );
        return (
            <div {...blockMenuPart('root')} role="menu" aria-label="Block options" data-state="open" style={`position:absolute;left:${pos.left}px;top:${pos.top}px`} ref={attach} onKeyDown={onKeydown}>
                {turnInto.length ? (
                    <>
                        <div {...blockMenuPart('label')} role="presentation">
                            Turn into
                        </div>
                        {turnInto.map(item)}
                        <div {...blockMenuPart('separator')} role="separator" />
                    </>
                ) : null}
                {table.length ? (
                    <>
                        <div {...blockMenuPart('label')} role="presentation">
                            Table
                        </div>
                        {table.map(item)}
                        <div {...blockMenuPart('separator')} role="separator" />
                    </>
                ) : null}
                {actions.map(item)}
            </div>
        );
    };
});
