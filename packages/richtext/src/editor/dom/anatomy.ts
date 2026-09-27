/**
 * The styling seam of the DOM editor, following the zero conventions
 * without depending on `@sigx/zero`: every element carries
 * `data-scope="<scope>"` and `data-part="<part>"`, state goes in
 * `data-state` (`on` / `off`, `open` / `closed`) and boolean flags in bare
 * `data-*` attributes (`data-selected`, `data-focused`, `data-empty`,
 * `data-disabled`). No classes are shipped; a stylesheet targets the
 * attributes (the playground's `editor.css` is the reference).
 */

export const EDITOR_SCOPE = 'richtext-editor';
export const TOOLBAR_SCOPE = 'richtext-toolbar';
export const BLOCK_MENU_SCOPE = 'richtext-block-menu';
export const SUGGEST_SCOPE = 'richtext-suggest';
export const LINK_SCOPE = 'richtext-link';

export type EditorPart =
    | 'root'
    | 'content'
    | 'block'
    | 'handle'
    | 'inline'
    | 'code'
    | 'code-header'
    | 'code-lang'
    | 'code-body'
    | 'void'
    | 'blockquote'
    | 'container'
    | 'list'
    | 'list-item'
    | 'task-check'
    | 'table'
    | 'table-row'
    | 'table-cell'
    | 'live'
    | 'bubble'
    | 'drop-indicator';

export type ToolbarPart = 'root' | 'group' | 'item';
export type BlockMenuPart = 'root' | 'item' | 'label' | 'separator';
export type SuggestPart = 'root' | 'list' | 'item' | 'empty' | 'loading';
export type LinkPart = 'root' | 'form' | 'input' | 'apply' | 'remove' | 'edit' | 'url';

export interface ScopedPartAttrs {
    'data-scope': string;
    'data-part': string;
}

export function scopedPart(scope: string, part: string): ScopedPartAttrs {
    return { 'data-scope': scope, 'data-part': part };
}

export const editorPart = (part: EditorPart): ScopedPartAttrs => scopedPart(EDITOR_SCOPE, part);
export const toolbarPart = (part: ToolbarPart): ScopedPartAttrs => scopedPart(TOOLBAR_SCOPE, part);
export const blockMenuPart = (part: BlockMenuPart): ScopedPartAttrs => scopedPart(BLOCK_MENU_SCOPE, part);
export const suggestPart = (part: SuggestPart): ScopedPartAttrs => scopedPart(SUGGEST_SCOPE, part);
export const linkPart = (part: LinkPart): ScopedPartAttrs => scopedPart(LINK_SCOPE, part);

/** `''` renders a bare boolean attribute; `undefined` omits it. */
export const flag = (on: boolean): '' | undefined => (on ? '' : undefined);
