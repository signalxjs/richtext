/**
 * The package's own parts — the layout zero has no component for (the
 * header, the panes, the source view, the status bar, icons). They sit in
 * one `data-scope="richtext-zero"`; every control inside is a zero part and
 * carries zero's own scope, so the loaded design system styles it.
 */

import { scopedPart, type ScopedPartAttrs } from '@sigx/richtext/editor/dom';

export const ZERO_SCOPE = 'richtext-zero';

export type ZeroPart =
    | 'root'
    | 'header'
    | 'title'
    | 'switches'
    | 'toolbar'
    | 'separator'
    | 'panes'
    | 'rich'
    | 'source'
    | 'source-header'
    | 'source-title'
    | 'source-badge'
    | 'source-body'
    | 'line'
    | 'line-number'
    | 'token'
    | 'status'
    | 'icon'
    | 'item-text'
    | 'item-label'
    | 'item-description'
    | 'item-hint'
    | 'link-form'
    | 'link-view';

export const zeroPart = (part: ZeroPart): ScopedPartAttrs => scopedPart(ZERO_SCOPE, part);
