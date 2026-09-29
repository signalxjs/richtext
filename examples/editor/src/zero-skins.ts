/**
 * The zero design systems the showcase switches between at runtime — the
 * published ones; a skin zero publishes later is one more entry in `SKINS`.
 * A design system is one compiled, global stylesheet, so switching is a
 * `<link>` swap: the incoming link arrives parked (`media="not all"`) and,
 * once loaded, is un-parked through the CSSOM in the same step that retires
 * the outgoing one, so no frame paints two skins or none (the zero
 * playground's `design-systems.ts` explains the details). The stylesheets
 * load only when a skin is activated.
 */
import basicCss from '@sigx/zero-basic/css?url';
import daisyuiCss from '@sigx/zero-daisyui/css?url';

export type SkinId = 'basic' | 'daisyui';

export interface Skin {
    id: SkinId;
    label: string;
    /** The npm package the stylesheet comes from. */
    pkg: string;
    href: string;
    /** The `data-theme` names of the skin's light and dark themes. */
    themes: { light: string; dark: string };
}

export const SKINS: readonly Skin[] = [
    { id: 'basic', label: 'Basic', pkg: '@sigx/zero-basic', href: basicCss, themes: { light: 'basic', dark: 'basic-dark' } },
    { id: 'daisyui', label: 'daisyUI', pkg: '@sigx/zero-daisyui', href: daisyuiCss, themes: { light: 'light', dark: 'dark' } },
];

/** Load `skin`'s stylesheet and retire the previous one; resolves once it applies. */
export function activateSkin(skin: Skin): Promise<void> {
    const previous = document.querySelector<HTMLLinkElement>('link[data-zero-ds]');
    if (previous?.dataset.zeroDs === skin.id) return Promise.resolve();
    return new Promise((resolve) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = skin.href;
        link.media = 'not all';
        link.dataset.zeroDs = skin.id;
        link.addEventListener('load', () => {
            if (link.sheet) link.sheet.media.mediaText = 'all';
            else link.media = 'all';
            previous?.remove();
            resolve();
        });
        link.addEventListener('error', () => resolve());
        document.head.appendChild(link);
    });
}
