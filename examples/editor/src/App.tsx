/**
 * The zero editor showcase: a slim bar that picks the design system (and its
 * light or dark theme), and below it the `@sigx/richtext-zero` editor
 * filling the page. A zero skin is one global stylesheet, which is why the
 * editor has this page to itself — the core-only Lab lives in
 * `examples/playground`.
 */
import { component } from 'sigx';
import { markdownFormat } from '@sigx/richtext-markdown';
import { htmlFormat } from '@sigx/richtext-html';
import { ZeroRichTextEditor } from '@sigx/richtext-zero';
import { EDITOR_PLUGINS } from './plugins';
import { SAMPLE } from './sample';
import { activateSkin, SKINS, type SkinId } from './zero-skins';

/** Where "Open the Lab" goes: the Lab's dev server unless the deploy says otherwise. */
const LAB_URL: string = import.meta.env.VITE_LAB_URL ?? 'http://localhost:5173/';

/** `?doc=<markdown>` seeds the document (handy by hand, and for the e2e suite). */
const initialSource = (): string => new URLSearchParams(location.search).get('doc') ?? SAMPLE;

const prefersDark = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

export const App = component(({ signal }) => {
    const state = signal({
        source: initialSource(),
        skin: 'basic' as SkinId,
        dark: prefersDark()
    });

    const skin = () => SKINS.find((s) => s.id === state.skin) ?? SKINS[0];

    /** The skin and its theme are page-wide: stamp them on `<html>`, where zero's selectors look. */
    const applyTheme = (): void => {
        const root = document.documentElement;
        root.dataset.theme = state.dark ? skin().themes.dark : skin().themes.light;
        root.style.colorScheme = state.dark ? 'dark' : 'light';
    };

    const setSkin = (id: SkinId): void => {
        state.skin = id;
        const next = skin();
        void activateSkin(next).then(() => {
            if (state.skin !== next.id) return;
            applyTheme();
            document.documentElement.dataset.skin = next.id;
        });
    };

    const toggleDark = (): void => {
        state.dark = !state.dark;
        applyTheme();
    };

    setSkin(state.skin);

    return () => (
        <div class="showcase">
            <header class="bar">
                <span class="wordmark">@sigx/richtext-zero</span>
                <span class="badge">Showcase</span>
                <span class="spacer" />
                <span class="label" id="ds-label">
                    Design system
                </span>
                <div class="skins" role="radiogroup" aria-labelledby="ds-label">
                    {SKINS.map((s) => (
                        <label key={s.id} class="skin" data-checked={state.skin === s.id ? '' : undefined}>
                            <input
                                type="radio"
                                name="skin"
                                value={s.id}
                                data-testid={`skin-${s.id}`}
                                checked={state.skin === s.id}
                                onChange={() => setSkin(s.id)}
                            />
                            <span class="skin-name">{s.label}</span>
                            <span class="skin-pkg">{s.pkg.replace('@sigx/', '')}</span>
                        </label>
                    ))}
                </div>
                <button
                    type="button"
                    class="theme"
                    data-testid="toggle-dark"
                    aria-pressed={String(state.dark)}
                    title={state.dark ? 'Switch to the light theme' : 'Switch to the dark theme'}
                    onClick={toggleDark}
                >
                    {state.dark ? 'Dark' : 'Light'}
                </button>
                <span class="divider" />
                <a class="lab" href={LAB_URL}>
                    Open the Lab
                </a>
            </header>

            <ZeroRichTextEditor
                id="zero-editor"
                class="editor"
                title="Streaming renderer — design notes"
                format={markdownFormat}
                formats={[markdownFormat, htmlFormat]}
                model:source={[state, 'source']}
                plugins={EDITOR_PLUGINS}
                placeholder="Write, or type / for blocks and @ to mention…"
                statusBar
            />

            {/* The bound source, for the e2e suite: what the editor wrote back. */}
            <output class="sr-only" data-testid="serialized-md">
                {state.source}
            </output>
        </div>
    );
});
