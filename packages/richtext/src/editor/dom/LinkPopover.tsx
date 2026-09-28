/**
 * `<LinkPopover>` — links under the caret, and the URL form.
 *
 * - **View** (`data-mode="view"`): the caret sits in a link — the URL (opens
 *   in a new tab, sanitised like the view's links), Edit and Remove. Its
 *   buttons never take the caret away from the text.
 * - **Edit** (`data-mode="edit"`): Mod-k, the toolbar's link item, or Edit —
 *   a URL field prefilled with the link under the caret. Enter applies (an
 *   empty URL unlinks), Remove unlinks, Escape cancels; an outside click
 *   closes it. Focus and the selection go back to the text. Over a range
 *   across blocks it links every block's text.
 *
 * Positioned under the selection inside the editor root (scope `richtext-link`).
 * A skin draws the body with `render`: the popover keeps the root, its
 * placement, Enter / Escape, the outside click and `sanitizeUrl`.
 */

import { component, type Define, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import { sanitizeUrl } from '../../render/index.js';
import { linkAt, setLink, unsetLink } from '../commands-standard.js';
import { flag, linkPart, type ScopedPartAttrs } from './anatomy.js';
import { useEditorView, type EditorView } from './context.js';
import { track } from './context.js';
import { selectionBox } from './popup.js';

/** What the popover hands a skin's `render`. */
export interface LinkPopoverInfo {
    mode: 'edit' | 'view';
    /** The link under the caret (`null` when the form adds a new one). */
    link: { url: string; title?: string } | null;
    /** View mode: the sanitised URL to open, `undefined` when its scheme is rejected. */
    href: string | undefined;
    readOnly: boolean;
    /** Edit mode: link the selection to `url` (default: the form's `<input>` value); an empty URL unlinks. */
    apply(url?: string): void;
    remove(): void;
    /** View mode: open the form. */
    edit(): void;
    /** Edit mode: close the form and give the text its focus back. */
    cancel(): void;
    /** Edit mode: spread onto the URL `<input>` (it is focused on open and read by `apply()`). */
    inputAttrs: ScopedPartAttrs & { type: 'url'; value: string; placeholder: string; 'aria-label': string; spellCheck: false; ref: (el: HTMLInputElement | null) => void };
    /** View mode: spread onto buttons so a press keeps the caret in the text. */
    buttonAttrs: { onPointerDown: (e: PointerEvent) => void };
}

export type LinkPopoverRender = (info: LinkPopoverInfo) => JSXElement;

export type LinkPopoverProps = Define.Prop<'render', LinkPopoverRender>;

interface Place {
    left: number;
    top: number;
}

/** Just under the current selection, in the root's coordinates. */
function placeUnderSelection(view: EditorView): Place | null {
    const root = view.root();
    if (!root) return null;
    const sel = view.editor.state.selection;
    const surface = sel?.mode === 'text' ? (view.surfaces.get(sel.head.key) as { caretRect?: () => { x: number; y: number; height: number } | null } | undefined) : undefined;
    const box = selectionBox(root, () => surface?.caretRect?.() ?? null);
    return box ? { left: box.left, top: box.bottom + 4 } : { left: 0, top: 0 };
}

export const LinkPopover = component<LinkPopoverProps>(({ props, onUnmounted }) => {
    const view = useEditorView();
    const { editor } = view;
    let dispose: (() => void) | null = null;
    let input: HTMLInputElement | null = null;
    /** Where the open form sits: measured once, before the field takes the DOM selection. */
    let formPlace: Place | null = null;

    const cancel = (): void => {
        view.closeLinkEditor();
        view.restoreSelection();
    };

    const apply = (value?: string): void => {
        const url = (value ?? input?.value ?? '').trim();
        const current = linkAt(editor.state, editor.ctx);
        view.closeLinkEditor();
        if (url) editor.run(setLink(url, current?.title));
        else editor.run(unsetLink);
        view.restoreSelection();
    };

    const remove = (): void => {
        view.closeLinkEditor();
        editor.run(unsetLink);
        view.restoreSelection();
    };

    const attachForm = (node: HTMLElement | null): void => {
        dispose?.();
        dispose = null;
        if (!node) return;
        // A skin's field may not forward `ref`: fall back to the form's first input.
        queueMicrotask(() => {
            if (!input?.isConnected) input = node.querySelector('input');
        });
        // An outside click closes the form and leaves focus where the click put it (Escape is the field's: it restores focus).
        const d = node.ownerDocument;
        const onOutside = (e: PointerEvent): void => {
            if (!node.contains(e.target as Node | null)) view.closeLinkEditor();
        };
        d.addEventListener('pointerdown', onOutside, true);
        dispose = () => d.removeEventListener('pointerdown', onOutside, true);
        queueMicrotask(() => {
            if (!input?.isConnected) return;
            input.focus();
            input.select();
        });
    };

    const onKeydown = (e: KeyboardEvent): void => {
        if ((e.target as Element | null)?.tagName !== 'INPUT') return;
        if (e.key === 'Enter') {
            e.preventDefault();
            apply();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancel();
        }
    };

    // Buttons in the view bubble keep the caret in the text.
    const keepCaret = (e: PointerEvent): void => e.preventDefault();

    const inputAttrsFor = (link: LinkPopoverInfo['link']): LinkPopoverInfo['inputAttrs'] => ({
        ...linkPart('input'),
        type: 'url',
        value: link?.url ?? '',
        placeholder: 'Paste or type a link',
        'aria-label': 'Link URL',
        spellCheck: false,
        ref: (el: HTMLInputElement | null) => (input = el),
    });

    const info = (mode: 'edit' | 'view', link: LinkPopoverInfo['link'], href: string | undefined): LinkPopoverInfo => ({
        mode,
        link,
        href,
        readOnly: view.readOnly(),
        apply,
        remove,
        edit: () => view.openLinkEditor(),
        cancel,
        inputAttrs: inputAttrsFor(link),
        buttonAttrs: { onPointerDown: keepCaret },
    });

    onUnmounted(() => dispose?.());

    return (): JSXElement | undefined => {
        track(editor.rev.value, editor.selRev.value, view.linkRev.value, view.focusRev.value);
        const state = editor.state;
        const sel = state.selection;
        const editing = view.linkEditing();
        if (!editing) formPlace = null;
        if (!sel || sel.mode !== 'text' || !view.root()) return undefined;
        const link = linkAt(state, editor.ctx);
        if (editing) {
            formPlace ??= placeUnderSelection(view);
            const pos = formPlace!;
            const inputAttrs = inputAttrsFor(link);
            const body = props.render ? (
                props.render(info('edit', link, undefined))
            ) : (
                <div {...linkPart('form')} role="group" aria-label="Link">
                    <input {...inputAttrs} />
                    <button {...linkPart('apply')} type="button" onClick={() => apply()}>
                        Apply
                    </button>
                    {link ? (
                        <button {...linkPart('remove')} type="button" onClick={remove}>
                            Remove
                        </button>
                    ) : null}
                </div>
            );
            return (
                <div {...linkPart('root')} data-mode="edit" data-state="open" style={`position:absolute;left:${pos.left}px;top:${pos.top}px`} ref={attachForm} onKeyDown={onKeydown}>
                    {body}
                </div>
            );
        }
        // The view bubble: a collapsed caret in a link while the editor has focus.
        if (!link || sel.anchor.offset !== sel.head.offset || !view.hasFocus()) return undefined;
        const pos = placeUnderSelection(view)!;
        // A rejected scheme sanitises to '#': show the URL, never link it.
        const sanitized = sanitizeUrl(link.url, 'link');
        const href = sanitized && (sanitized !== '#' || link.url.trim() === '#') ? sanitized : undefined;
        const body = props.render ? (
            props.render(info('view', link, href))
        ) : (
            <>
                <a {...linkPart('url')} href={href} target="_blank" rel="noopener noreferrer" title={link.title}>
                    {link.url}
                </a>
                {view.readOnly() ? null : (
                    <>
                        <button {...linkPart('edit')} type="button" onPointerDown={keepCaret} onClick={() => view.openLinkEditor()}>
                            Edit
                        </button>
                        <button {...linkPart('remove')} type="button" onPointerDown={keepCaret} onClick={remove}>
                            Remove
                        </button>
                    </>
                )}
            </>
        );
        return (
            <div {...linkPart('root')} data-mode="view" data-state="open" data-readonly={flag(view.readOnly())} style={`position:absolute;left:${pos.left}px;top:${pos.top}px`}>
                {body}
            </div>
        );
    };
});
