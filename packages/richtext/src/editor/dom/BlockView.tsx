/**
 * `<BlockView>` — one editor block, dispatched on its schema role:
 *
 * - `textblock` → `<InlineBlock>` (a contenteditable surface)
 * - `code` → `<CodeBlockEditor>` (a textarea surface)
 * - `table` → `<TableBlock>` (a grid of inline surfaces)
 * - `container` → its container view (`./containers.tsx`: list, list item,
 *   blockquote, plugin views, else a plain div) around `<BlockView>`s for
 *   its children
 * - anything else → `<VoidBlock>` (rendered read-only, selectable as a block)
 *
 * Every block sits in a `data-part="block"` wrapper that carries the key,
 * the type, the block-selection flag and the block handle; a container view
 * may make that wrapper its own element (a list item is its `<li>`, so lists
 * stay real lists).
 */

import { component, type Define, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import type { BlockContent, Table, TableRow } from '../../ast/index.js';
import { renderBlock, type RenderContext } from '../../render/index.js';
import { selectBlock } from '../commands.js';
import type { EditorBlock } from '../state.js';
import { editorPart, flag } from './anatomy.js';
import { defaultContainerView } from './containers.js';
import { useEditorView, type EditorView } from './context.js';
import { InlineBlock } from './InlineBlock.js';
import { CodeBlockEditor } from './CodeBlockEditor.js';

export type BlockViewProps = Define.Prop<'block', EditorBlock, true>;

/** The handle button at the left of a block (opens the block menu). */
const BlockHandle = component<{ blockKey: string }>(({ props }) => {
    const view = useEditorView();
    const onPointerDown = (e: PointerEvent): void => {
        // Keep the caret where it is; the menu acts on the block, not on focus.
        e.preventDefault();
    };
    const onClick = (e: MouseEvent): void => {
        e.preventDefault();
        view.openBlockMenu(props.blockKey, e.currentTarget as HTMLElement);
    };
    return () => (
        <button {...editorPart('handle')} type="button" tabIndex={-1} contentEditable="false" aria-label="Block options" aria-haspopup="menu" onPointerDown={onPointerDown} onClick={onClick}>
            <span aria-hidden="true">⋮⋮</span>
        </button>
    );
});

function wrapperAttrs(view: EditorView, node: EditorBlock): Record<string, unknown> {
    return {
        ...editorPart('block'),
        'data-type': node.type,
        'data-key': node.key,
        'data-selected': flag(view.selectedKeys.value.has(node.key!)),
        'data-in-range': flag(view.rangeKeys.value.has(node.key!)),
    };
}

/** A void block: rendered by the read-only components, focusable, selected as a block on click. Labelled by its menu entry. */
const VoidBlock = component<{ block: EditorBlock }>(({ props }) => {
    const view = useEditorView();
    const { editor } = view;
    const key = props.block.key!;
    const onPointerDown = (e: PointerEvent): void => {
        if (view.readOnly()) return;
        e.preventDefault();
        editor.run(selectBlock(key));
        view.focusRoot();
    };
    return () => {
        const node = props.block as BlockContent;
        const ctx: RenderContext<JSXElement> = { components: view.components(), schema: editor.schema };
        const rendered = renderBlock(node, ctx, key);
        const label = editor.schema.get(node.type)?.menu?.label ?? node.type;
        return (
            <div {...editorPart('void')} data-type={node.type} data-key={key} role="group" aria-label={label} contentEditable="false" onPointerDown={onPointerDown}>
                {rendered ?? <span>{node.type}</span>}
            </div>
        );
    };
});

const TableBlock = component<{ block: Table }>(({ props }) => {
    const view = useEditorView();
    return () => {
        const table = props.block;
        const align = table.align ?? [];
        return (
            <div {...wrapperAttrs(view, table)}>
                {view.handles() ? <BlockHandle blockKey={table.key!} /> : null}
                <table {...editorPart('table')} data-key={table.key}>
                    <tbody>
                        {table.children.map((row: TableRow, r) => (
                            <tr key={row.key} {...editorPart('table-row')} data-key={row.key} data-header={flag(r === 0)}>
                                {row.children.map((cell, c) => (
                                    <td key={cell.key} {...editorPart('table-cell')} data-key={cell.key} data-align={align[c] ?? undefined}>
                                        <InlineBlock block={cell} tag="div" />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };
});

export const BlockView = component<BlockViewProps>(({ props }) => {
    const view = useEditorView();
    const { editor } = view;

    return (): JSXElement => {
        const node = props.block;
        const role = editor.schema.role(node.type) ?? 'void';
        const handle = view.handles() ? <BlockHandle blockKey={node.key!} /> : null;

        switch (role) {
            case 'textblock':
                return (
                    <div {...wrapperAttrs(view, node)}>
                        {handle}
                        <InlineBlock block={node} />
                    </div>
                );
            case 'code':
                return (
                    <div {...wrapperAttrs(view, node)}>
                        {handle}
                        <CodeBlockEditor block={node} />
                    </div>
                );
            case 'table':
                return <TableBlock block={node as Table} />;
            case 'container': {
                const children = ((node as { children?: EditorBlock[] }).children ?? []).map((child) => <BlockView key={child.key} block={child} />);
                const render = view.containers.get(node.type) ?? defaultContainerView;
                return render({ node, children, wrapperAttrs: wrapperAttrs(view, node), handle, view });
            }
            default:
                return (
                    <div {...wrapperAttrs(view, node)}>
                        {handle}
                        <VoidBlock block={node} />
                    </div>
                );
        }
    };
});
