/**
 * `<InlineBlock>` — a paragraph, heading, table cell or plugin inline block:
 * one contenteditable host owned by a `DomInlineSurface`, wired to the core
 * through the inline bridge.
 *
 * The host element renders once per element type (a heading depth change
 * swaps `h2` for `h3` and re-creates the surface); its content is never
 * touched by the reconciler. After every committed transaction the block
 * pushes the new flat model when its node identity changed (structural
 * sharing makes an untouched block free) and takes the caret when the
 * selection points at it and the editor has focus.
 */

import { toRaw } from '@sigx/reactivity';
import { component, jsx, type Define, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import { createInlineBridge } from '../bridge.js';
import type { EditorBlock, EditorState } from '../state.js';
import type { InlineSurfaceEvents } from '../surface.js';
import type { Transaction } from '../transaction.js';
import { editorPart, flag } from './anatomy.js';
import { useEditorView, type EditorView } from './context.js';
import { track } from './context.js';
import { createDomInlineSurface, type DomInlineSurface } from './inline-surface.js';
import { bridgeHost } from './bridge-host.js';

export type InlineBlockProps = Define.Prop<'block', EditorBlock, true> & Define.Prop<'tag', string>;

function attrsOf(node: EditorBlock): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) if (k !== 'type' && k !== 'children' && k !== 'position' && k !== 'key') out[k] = v;
    return out;
}

function tagOf(node: EditorBlock, override?: string): string {
    if (override) return override;
    if (node.type === 'heading') return `h${Math.min(6, Math.max(1, (node as { depth: number }).depth))}`;
    if (node.type === 'paragraph') return 'p';
    return 'div';
}

function rangeOf(state: EditorState, key: string): { start: number; end: number } | null {
    const sel = state.selection;
    // A cross-block range is painted by the editor, not restored into one surface.
    if (!sel || sel.mode !== 'text' || sel.anchor.key !== key || sel.head.key !== key) return null;
    const a = sel.anchor.offset;
    const h = sel.head.offset;
    return { start: Math.min(a, h), end: Math.max(a, h) };
}

export const InlineBlock = component<InlineBlockProps>(({ props, onUnmounted }) => {
    const view: EditorView = useEditorView();
    const { editor } = view;
    const key = props.block.key!;
    let host: HTMLElement | null = null;
    let surface: DomInlineSurface | null = null;
    let unregister: (() => void) | null = null;
    /** The node the surface last received (the listener's change detector; never touched by render). */
    let lastNode: EditorBlock = toRaw(props.block);

    const bridge = createInlineBridge(key, bridgeHost(view));
    const events: InlineSurfaceEvents = {
        ...bridge.events,
        boundary: (e) => {
            view.goalX = e.goalX;
            return bridge.events.boundary(e);
        },
    };

    const detach = (): void => {
        unregister?.();
        unregister = null;
        surface?.destroy();
        surface = null;
        host = null;
    };

    const attach = (el: HTMLElement | null): void => {
        if (!el || el === host) return;
        detach();
        host = el;
        const node = toRaw(props.block);
        surface = createDomInlineSurface(
            el,
            { key, blockType: node.type, schema: editor.schema, attrs: attrsOf(node), flat: editor.flatOf(key) ?? { text: '', spans: [] }, readOnly: view.readOnly(), events },
            { platform: editor.platform, atoms: view.atoms, origin: () => view.root() ?? el },
        );
        unregister = view.register(key, surface);
    };

    const syncSelection = (tr: Transaction, state: EditorState): void => {
        if (!surface || !host) return;
        const range = rangeOf(state, key);
        if (!range) return;
        if (tr.meta.origin === 'surface' && tr.meta.sourceKey === key) return;
        if (!view.hasFocus()) return;
        const current = surface.getSelection();
        if (host.ownerDocument.activeElement === host && current && current.start === range.start && current.end === range.end) return;
        surface.focus();
        surface.setSelection(range);
    };

    const stop = editor.listen((tr, state) => {
        const entry = state.index().get(key);
        if (!entry) return;
        if (entry.node !== lastNode) {
            lastNode = entry.node;
            if (surface && bridge.shouldPush(tr)) {
                const flat = editor.flatOf(key);
                if (flat) surface.setInline(flat, { rev: state.rev });
                surface.setAttrs(entry.node.type, attrsOf(entry.node));
            }
        }
        syncSelection(tr, state);
    });

    onUnmounted(() => {
        stop();
        detach();
    });

    return (): JSXElement => {
        // Props are reactive proxies; identity checks against the state need the raw node.
        const node = toRaw(props.block);
        const tag = tagOf(node, props.tag);
        track(editor.rev.value);
        const doc = editor.state.doc;
        const placeholder = doc.children.length === 1 && doc.children[0] === node ? view.placeholder() : undefined;
        const attrs: Record<string, unknown> = {
            ...editorPart('inline'),
            'data-type': node.type,
            'data-key': key,
            'data-depth': node.type === 'heading' ? (node as { depth: number }).depth : undefined,
            'data-placeholder': placeholder,
            'data-readonly': flag(view.readOnly()),
            ref: attach,
        };
        return jsx(tag, attrs) as JSXElement;
    };
});
