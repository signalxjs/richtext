/**
 * Menu rows: the block menu's items (the handle's "Turn into", table and
 * block actions) and the suggestion rows (the slash menu, @mentions). The
 * core keeps the menus' roots, placement, focus and keyboard; these draw
 * what sits inside, with zero parts where zero has one (`Kbd`).
 */

import type { JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import { Kbd } from '@sigx/zero';
import type { BlockMenuRenderItem, SuggestionRenderItem } from '@sigx/richtext/editor/dom';
import { zeroPart } from './anatomy.js';
import { ZeroIcon, hasIcon } from './icons.js';

/** `renderBlockMenuItem` for `RichTextEditor`: an icon, then the label. */
export const renderZeroBlockMenuItem: BlockMenuRenderItem = (item, info) => (
    <button {...info.attrs} data-group={item.group}>
        {hasIcon(item.icon) ? <ZeroIcon name={item.icon} /> : null}
        <span {...zeroPart('item-label')}>{item.label}</span>
    </button>
);

/** What typing makes each block type — the markdown input rules — shown as a hint in the slash menu. */
export const BLOCK_HINTS: Readonly<Record<string, string>> = {
    heading: '#',
    blockquote: '>',
    list: '-',
    code: '```',
    thematicBreak: '---',
    table: '|',
};

const DESCRIPTIONS: Readonly<Record<string, string>> = {
    paragraph: 'Plain text',
    heading: 'Section heading',
    blockquote: 'Quote or callout',
    list: 'A simple list',
    code: 'Code with highlighting',
    thematicBreak: 'Horizontal rule',
    table: 'Rows and columns',
};

interface SuggestionLike {
    id: string;
    label: string;
    icon?: unknown;
    description?: unknown;
    spec?: { type?: string };
}

/** `renderSuggestion` for `RichTextEditor`: an icon tile, the label and a description, and the input rule as a `Kbd` hint. */
export const renderZeroSuggestion: SuggestionRenderItem = (raw) => {
    const item = raw as SuggestionLike;
    const type = item.spec?.type;
    const icon = typeof item.icon === 'string' && hasIcon(item.icon) ? item.icon : type ? undefined : 'mention';
    const description = typeof item.description === 'string' ? item.description : type ? DESCRIPTIONS[type] : undefined;
    const hint = type ? BLOCK_HINTS[type] : undefined;
    const tile: JSXElement = icon ? <ZeroIcon name={icon} /> : <span aria-hidden="true">{item.label.slice(0, 1)}</span>;
    return (
        <>
            <span {...zeroPart('icon')} data-tile="">
                {tile}
            </span>
            <span {...zeroPart('item-text')}>
                <span {...zeroPart('item-label')}>{item.label}</span>
                {description ? <span {...zeroPart('item-description')}>{description}</span> : null}
            </span>
            {hint ? (
                <span {...zeroPart('item-hint')}>
                    <Kbd size="xs">{hint}</Kbd>
                </span>
            ) : null}
        </>
    );
};
