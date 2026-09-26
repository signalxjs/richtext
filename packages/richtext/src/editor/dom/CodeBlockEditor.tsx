/**
 * `<CodeBlockEditor>` — a fenced code block (or an `html` block) in the
 * editor: a language field and a `<textarea>` owned by a `DomCodeSurface`.
 */

import { toRaw } from '@sigx/reactivity';
import { component, type Define, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import { createCodeBridge } from '../bridge.js';
import type { EditorBlock, EditorState } from '../state.js';
import type { CodeSurfaceEvents } from '../surface.js';
import type { Transaction } from '../transaction.js';
import { editorPart, flag } from './anatomy.js';
import { useEditorView, type EditorView } from './context.js';
import { createDomCodeSurface, type DomCodeSurface } from './code-surface.js';
import { bridgeHost } from './bridge-host.js';

export type CodeBlockEditorProps = Define.Prop<'block', EditorBlock, true>;

interface CodeLike {
    type: string;
    value: string;
    lang?: string | null;
    meta?: string | null;
}

export const CodeBlockEditor = component<CodeBlockEditorProps>(({ props, onUnmounted }) => {
    const view: EditorView = useEditorView();
    const { editor } = view;
    const key = props.block.key!;
    let surface: DomCodeSurface | null = null;
    let unregister: (() => void) | null = null;
    let lastNode: EditorBlock = toRaw(props.block);

    const bridge = createCodeBridge(key, bridgeHost(view));
    const events: CodeSurfaceEvents = {
        ...bridge.events,
        boundary: (e) => {
            view.goalX = e.goalX;
            return bridge.events.boundary(e);
        },
    };

    const attach = (el: HTMLTextAreaElement | null): void => {
        if (!el || el === surface?.textarea) return;
        unregister?.();
        surface?.destroy();
        const node = toRaw(props.block) as unknown as CodeLike;
        surface = createDomCodeSurface(el, { key, value: node.value, lang: node.lang ?? null, readOnly: view.readOnly(), events }, { platform: editor.platform });
        unregister = view.register(key, surface);
    };

    const syncSelection = (tr: Transaction, state: EditorState): void => {
        if (!surface) return;
        const sel = state.selection;
        if (!sel || sel.mode !== 'text' || sel.anchor.key !== key || sel.head.key !== key) return;
        if (tr.meta.origin === 'surface' && tr.meta.sourceKey === key) return;
        if (!view.hasFocus()) return;
        const range = { start: Math.min(sel.anchor.offset, sel.head.offset), end: Math.max(sel.anchor.offset, sel.head.offset) };
        const ta = surface.textarea;
        const current = surface.getSelection();
        if (ta.ownerDocument.activeElement === ta && current && current.start === range.start && current.end === range.end) return;
        surface.focus();
        surface.setSelection(range);
    };

    const stop = editor.listen((tr, state) => {
        const entry = state.index().get(key);
        if (!entry) return;
        if (entry.node !== lastNode) {
            lastNode = entry.node;
            if (surface && bridge.shouldPush(tr)) {
                surface.setValue((entry.node as CodeLike).value);
                surface.setLang((entry.node as CodeLike).lang ?? null);
            }
        }
        syncSelection(tr, state);
    });

    onUnmounted(() => {
        stop();
        unregister?.();
        surface?.destroy();
        surface = null;
    });

    const onLangInput = (e: Event): void => {
        const value = (e.target as HTMLInputElement).value.trim();
        events.langChange?.(value || null);
    };

    const onLangKeydown = (e: KeyboardEvent): void => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
            e.preventDefault();
            surface?.focus({ edge: 'start' });
        }
    };

    return (): JSXElement => {
        const node = props.block as CodeLike & EditorBlock;
        const lang = node.lang ?? null;
        const readOnly = view.readOnly();
        return (
            <div {...editorPart('code')} data-type={node.type} data-key={key} data-lang={lang ?? undefined} data-readonly={flag(readOnly)} contentEditable="false">
                {node.type === 'code' ? (
                    <div {...editorPart('code-header')}>
                        <input
                            {...editorPart('code-lang')}
                            type="text"
                            value={lang ?? ''}
                            placeholder="language"
                            aria-label="Code language"
                            spellCheck={false}
                            disabled={readOnly}
                            onInput={onLangInput}
                            onKeyDown={onLangKeydown}
                        />
                    </div>
                ) : null}
                <textarea {...editorPart('code-body')} aria-label={node.type === 'html' ? 'HTML block' : 'Code block'} ref={attach} />
            </div>
        );
    };
});
