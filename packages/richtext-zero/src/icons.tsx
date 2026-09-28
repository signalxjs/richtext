/**
 * The editor's icon set — 24px stroke glyphs in `currentColor`, keyed by the
 * names `ToolbarItem.icon`, the block menu and the slash menu use. A stand-in
 * until `@sigx/zero` ships an `Icon` part (signalxjs/zero#462); the names are
 * the vocabulary that registry will take.
 */

import { component, type Define } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import { zeroPart } from './anatomy.js';

/** Path data per icon name (one `d` per stroke, drawn on a 24×24 grid). */
export const ICONS: Readonly<Record<string, readonly string[]>> = {
    undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
    redo: ['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
    bold: ['M7 5h6a3.5 3.5 0 0 1 0 7H7z', 'M7 12h7a3.5 3.5 0 0 1 0 7H7z'],
    italic: ['M19 4h-9', 'M14 20H5', 'M15 4 9 20'],
    strikethrough: ['M4 12h16', 'M16 7c-.6-1.3-2-2-4-2-2.5 0-4 1.3-4 3 0 1.3.9 2.3 2.6 3', 'M8 17c.6 1.3 2 2 4 2 2.5 0 4-1.3 4-3 0-.5-.1-1-.4-1.4'],
    code: ['m8 7-5 5 5 5', 'm16 7 5 5-5 5'],
    link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
    pilcrow: ['M13 4v16', 'M17 4v16', 'M19 4H9.5a4.5 4.5 0 0 0 0 9H13'],
    heading: ['M6 4v16', 'M18 4v16', 'M6 12h12'],
    'heading-1': ['M4 5v14', 'M12 5v14', 'M4 12h8', 'm17 10 3-2v11'],
    'heading-2': ['M4 5v14', 'M12 5v14', 'M4 12h8', 'M16 10a2.5 2.5 0 1 1 4.3 1.8L16 19h5'],
    'heading-3': ['M4 5v14', 'M12 5v14', 'M4 12h8', 'M16.5 8.5a2.5 2.5 0 1 1 2 4', 'M18.5 12.5a2.5 2.5 0 1 1-2 4'],
    list: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4.5 6h.01', 'M4.5 12h.01', 'M4.5 18h.01'],
    'list-ordered': ['M10 6h10', 'M10 12h10', 'M10 18h10', 'M4 5l1.5-1v5', 'M3.5 14.5a1.5 1.5 0 1 1 2.6 1L3.5 19h3'],
    'list-checks': ['M11 6h9', 'M11 12h9', 'M11 18h9', 'm3 6 1.5 1.5 3-3', 'm3 12.5 1.5 1.5 3-3', 'M3.5 16.5h3v3h-3z'],
    quote: ['M4 18c3 0 5-2 5-6V6H4v6h5', 'M14 18c3 0 5-2 5-6V6h-5v6h5'],
    'code-block': ['M4 4h16v16H4z', 'm10 9-3 3 3 3', 'm14 9 3 3-3 3'],
    table: ['M3 4h18v16H3z', 'M3 10h18', 'M3 15h18', 'M9 10v10', 'M15 10v10'],
    image: ['M3 4h18v16H3z', 'm3 16 5-5 5 5', 'm13 14 3-3 5 5', 'M15.5 8.5h.01'],
    minus: ['M4 12h16'],
    mention: ['M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z', 'M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1'],
    more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
    'arrow-up': ['M12 19V5', 'm5 12 7-7 7 7'],
    'arrow-down': ['M12 5v14', 'm19 12-7 7-7-7'],
    copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
    trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'm6 7 1 13h10l1-13', 'M9 7V4h6v3'],
    check: ['m5 12 5 5L20 7'],
    'chevron-down': ['m6 9 6 6 6-6'],
    'align-left': ['M4 6h16', 'M4 12h10', 'M4 18h14'],
    'align-center': ['M4 6h16', 'M7 12h10', 'M5 18h14'],
    'align-right': ['M4 6h16', 'M10 12h10', 'M6 18h14'],
    'row-insert-top': ['M3 10h18v10H3z', 'M3 15h18', 'M12 3v4', 'M10 5h4'],
    'row-insert-bottom': ['M3 4h18v10H3z', 'M3 9h18', 'M12 17v4', 'M10 19h4'],
    'column-insert-left': ['M10 3h10v18H10z', 'M15 3v18', 'M5 10v4', 'M3 12h4'],
    'column-insert-right': ['M4 3h10v18H4z', 'M9 3v18', 'M19 10v4', 'M17 12h4'],
    'row-remove': ['M3 4h18v16H3z', 'M3 12h18', 'm9 14 6 4', 'm15 14-6 4'],
    'column-remove': ['M3 4h18v16H3z', 'M12 4v16', 'm14 9 4 6', 'm18 9-4 6'],
    columns: ['M3 4h18v16H3z', 'M12 4v16'],
    'file-code': ['M6 2h9l5 5v15H6z', 'M14 2v6h6', 'm10 13-2 2 2 2', 'm14 13 2 2-2 2'],
};

/** Whether the set has a glyph for `name`. */
export function hasIcon(name: string | undefined): name is string {
    return !!name && Object.prototype.hasOwnProperty.call(ICONS, name);
}

export type ZeroIconProps = Define.Prop<'name', string, true>;

/**
 * One glyph, sized by the `richtext-zero` stylesheet (1.25em by default) and
 * hidden from assistive technology — the control around it carries the name.
 * An unknown name renders nothing.
 */
export const ZeroIcon = component<ZeroIconProps>(({ props }) => () => {
    const paths = hasIcon(props.name) ? ICONS[props.name] : null;
    if (!paths) return null;
    return (
        <svg {...zeroPart('icon')} data-icon={props.name} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            {paths.map((d) => (
                <path key={d} d={d} />
            ))}
        </svg>
    );
}, { name: 'ZeroIcon' });
