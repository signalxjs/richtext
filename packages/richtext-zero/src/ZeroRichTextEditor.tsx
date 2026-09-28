/**
 * `<ZeroRichTextEditor>` — `RichTextEditor` with its chrome drawn as
 * `@sigx/zero` parts, plus what the core has no view for: a header with a
 * rich / split / source view switch and a format switch, a read-only
 * highlighted source pane, and a status bar.
 *
 * ```tsx
 * <ZeroRichTextEditor format={markdownFormat} formats={[markdownFormat, htmlFormat]} plugins={[markdownPreset, htmlPreset]} />
 * ```
 *
 * The look is the loaded `@sigx/zero-*` design system's; the package's own
 * stylesheet (`@sigx/richtext-zero/css`) only lays the parts out.
 */

import { component, createModel, type Define, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import { ToggleGroup } from '@sigx/zero';
import { plainTextFormat, type DocumentFormat, type RichTextPlugin, type Root } from '@sigx/richtext';
import { toolbarState, type EditorSelection, type ToolbarItem } from '@sigx/richtext/editor';
import { RichTextEditor, type RichTextEditorChange, type RichTextEditorController } from '@sigx/richtext/editor/dom';
import { zeroPart } from './anatomy.js';
import { ZeroIcon } from './icons.js';
import { renderZeroLinkPopover } from './link.js';
import { renderZeroBlockMenuItem, renderZeroSuggestion } from './menus.js';
import { formatName, SourcePane } from './SourcePane.js';
import { BLOCK_TYPES, blockTypeOf, renderZeroToolbarGroup, renderZeroToolbarItem, zeroToolbarItems } from './toolbar.js';

export type EditorViewMode = 'rich' | 'split' | 'source';

const VIEW_LABELS: Record<EditorViewMode, { label: string; icon: string }> = {
    rich: { label: 'Rich text', icon: 'pilcrow' },
    split: { label: 'Split', icon: 'columns' },
    source: { label: 'Source', icon: 'file-code' },
};

export type ZeroRichTextEditorProps = Define.WithAttrs<
    /** The format the `source` model reads and writes. */
    & Define.Prop<'format', DocumentFormat, true>
    /** The formats the source pane can show (the format switch); `format` is added when missing. Default: `[format]`. */
    & Define.Prop<'formats', readonly DocumentFormat[]>
    /** The views the switch offers, in order. Default `['rich', 'split', 'source']`; one view hides the switch. */
    & Define.Prop<'views', readonly EditorViewMode[]>
    /** Two-way bound current view. */
    & Define.Model<'view', EditorViewMode>
    & Define.Prop<'defaultView', EditorViewMode>
    /** Two-way bound source in `format`. */
    & Define.Model<'source', string>
    & Define.Prop<'defaultSource', string>
    & Define.Prop<'plugins', readonly RichTextPlugin[]>
    /** The document title in the header. */
    & Define.Prop<'title', string>
    /** `'top'` (default), `'bottom'` or `false`. */
    & Define.Prop<'toolbar', boolean | 'top' | 'bottom'>
    /** The main toolbar's items. Default: `zeroToolbarItems()` (history, block type, marks, lists, blocks). */
    & Define.Prop<'toolbarItems', readonly ToolbarItem[]>
    /** A toolbar over the text selection. Default `true`. */
    & Define.Prop<'floatingToolbar', boolean | readonly ToolbarItem[]>
    & Define.Prop<'blockHandles', boolean>
    /** The document face: the design system's own (`'skin'`, default) or a serif. */
    & Define.Prop<'docFont', 'skin' | 'serif'>
    /** The status bar under the editor. Default `true`. */
    & Define.Prop<'statusBar', boolean>
    & Define.Prop<'readOnly', boolean>
    & Define.Prop<'placeholder', string>
    & Define.Prop<'autofocus', boolean>
    & Define.Prop<'onChange', (e: RichTextEditorChange) => void>
    & Define.Event<'ready', RichTextEditorController>
>;

const ALL_VIEWS: readonly EditorViewMode[] = ['rich', 'split', 'source'];

const OWN_PROPS = new Set(['format', 'formats', 'views', 'view', 'defaultView', 'source', 'defaultSource', 'plugins', 'title', 'toolbar', 'toolbarItems', 'floatingToolbar', 'blockHandles', 'docFont', 'statusBar', 'readOnly', 'placeholder', 'autofocus', 'onChange', 'onReady', 'children', 'slots']);

/** What the component was given beyond its own props (`id`, `class`, `data-*`, …): it lands on the root. */
function restAttrs(props: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(props)) if (!OWN_PROPS.has(key) && !key.startsWith('model')) out[key] = props[key];
    return out;
}

function wordCount(doc: Root): number {
    return plainTextFormat.serialize(doc).match(/\S+/g)?.length ?? 0;
}

export const ZeroRichTextEditor = component<ZeroRichTextEditorProps>(({ props, emit, signal }) => {
    const views = (): readonly EditorViewMode[] => (props.views?.length ? props.views : ALL_VIEWS);
    const formats = (): readonly DocumentFormat[] => {
        const list = props.formats ?? [];
        return list.some((f) => f.id === props.format.id) ? list : [props.format, ...list];
    };
    const state = signal({
        view: props.view?.value ?? props.defaultView ?? views()[0],
        shown: props.format.id,
        /** Bumped on every change and selection change: the source pane and status bar re-read. */
        rev: 0,
    });
    let controller: RichTextEditorController | null = null;

    const view = (): EditorViewMode => {
        const v = props.view?.value ?? state.view;
        return views().includes(v) ? v : views()[0];
    };
    const setView = (v: EditorViewMode): void => {
        state.view = v;
        if (props.view) props.view.value = v;
    };

    const viewModel = createModel<string>([{ get value() { return view(); } }, 'value'], (v) => setView(v as EditorViewMode));
    const formatModel = createModel<string>([{ get value() { return state.shown; } }, 'value'], (id) => (state.shown = id));

    const onReady = (c: RichTextEditorController): void => {
        controller = c;
        // `ready` fires while this component's first render is still running: re-read after it.
        queueMicrotask(() => state.rev++);
        emit('ready', c);
    };
    const onChange = (e: RichTextEditorChange): void => {
        state.rev++;
        props.onChange?.(e);
    };
    const onSelectionChange = (_sel: EditorSelection): void => {
        state.rev++;
    };

    const header = (): JSXElement => {
        const list = views();
        const fmts = formats();
        return (
            <div {...zeroPart('header')}>
                {props.title ? <span {...zeroPart('title')}>{props.title}</span> : <span />}
                <div {...zeroPart('switches')}>
                    {list.length > 1 ? (
                        <ToggleGroup.Root model={viewModel} deselectable={false} label="View" size="sm">
                            {list.map((v) => (
                                <ToggleGroup.Item key={v} value={v} aria-label={VIEW_LABELS[v].label}>
                                    <ZeroIcon name={VIEW_LABELS[v].icon} />
                                    {VIEW_LABELS[v].label}
                                </ToggleGroup.Item>
                            ))}
                        </ToggleGroup.Root>
                    ) : null}
                    {fmts.length > 1 ? (
                        <ToggleGroup.Root model={formatModel} deselectable={false} label="Source format" size="sm">
                            {fmts.map((f) => (
                                <ToggleGroup.Item key={f.id} value={f.id}>
                                    {formatName(f).title}
                                </ToggleGroup.Item>
                            ))}
                        </ToggleGroup.Root>
                    ) : null}
                </div>
            </div>
        );
    };

    const status = (): JSXElement => {
        void state.rev;
        const c = controller;
        if (!c) return null;
        const doc = c.getDocument();
        const editor = c.editor;
        const tb = toolbarState(editor.state, editor.ctx, editor.history);
        const type = BLOCK_TYPES.find((o) => o.value === blockTypeOf(tb))?.label ?? (tb.blockType ?? '');
        const shown = formats().find((f) => f.id === state.shown) ?? props.format;
        const words = wordCount(doc);
        return (
            <footer {...zeroPart('status')}>
                <span data-status="block">{type}</span>
                <span data-status="words">{`${words} word${words === 1 ? '' : 's'}`}</span>
                <span data-status="format">{formatName(shown).title}</span>
            </footer>
        );
    };

    return () => {
        const v = view();
        const fmts = formats();
        const shown = fmts.find((f) => f.id === state.shown) ?? props.format;
        void state.rev;
        const source = v !== 'rich' && controller ? controller.getSource(shown.id) : '';
        const editorProps: Record<string, unknown> = {
            format: props.format,
            formats: fmts.filter((f) => f.id !== props.format.id),
            plugins: props.plugins,
            defaultSource: props.defaultSource,
            toolbar: props.toolbar ?? 'top',
            toolbarItems: props.toolbarItems ?? zeroToolbarItems(),
            floatingToolbar: props.floatingToolbar ?? true,
            blockHandles: props.blockHandles,
            readOnly: props.readOnly,
            placeholder: props.placeholder,
            autofocus: props.autofocus,
            renderToolbarItem: renderZeroToolbarItem,
            renderToolbarGroup: renderZeroToolbarGroup,
            renderSuggestion: renderZeroSuggestion,
            renderLinkPopover: renderZeroLinkPopover,
            renderBlockMenuItem: renderZeroBlockMenuItem,
            onChange,
            onSelectionChange,
            onReady,
        };
        if (props.source) editorProps['model:source'] = props.source;
        return (
            <div {...restAttrs(props as Record<string, unknown>)} {...zeroPart('root')} data-view={v} data-doc-font={props.docFont ?? 'skin'}>
                {views().length > 1 || formats().length > 1 || props.title ? header() : null}
                <div {...zeroPart('panes')} data-view={v}>
                    <div {...zeroPart('rich')} hidden={v === 'source'}>
                        <RichTextEditor {...(editorProps as { format: DocumentFormat })} />
                    </div>
                    {v !== 'rich' ? <SourcePane source={source} format={shown} /> : null}
                </div>
                {props.statusBar === false ? null : status()}
            </div>
        );
    };
}, { name: 'ZeroRichTextEditor' });
