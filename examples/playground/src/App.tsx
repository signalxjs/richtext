/**
 * The Richtext Lab: the core only, no design system. Three tabs share one
 * frame — a control panel on the left, then source, view and inspector:
 *
 * - **Streaming** replays the source through `createTextStream` into the
 *   Lab's own incremental engine and shows which blocks are final and which
 *   are the open tail.
 * - **Round-trip** renders the whole source and checks that serializing it
 *   is stable.
 * - **Core editor** is `RichTextEditor` with the reference `editor.css`,
 *   two-way bound to the same source.
 *
 * The zero editor lives in `examples/editor`: a zero design system is one
 * global stylesheet, and this page proves the core needs none.
 */
import { component, computed } from 'sigx';
import { createReparseEngine, createTextStream, type IncrementalEngine, type RichTextPlugin } from '@sigx/richtext';
import { highlightedCodeBlock, type DomComponents } from '@sigx/richtext/dom';
import { RichTextEditor } from '@sigx/richtext/editor/dom';
import { markdownFormat, parseMarkdown, toMarkdown } from '@sigx/richtext-markdown';
import { htmlFormat, parseHtml, toHtml } from '@sigx/richtext-html';
import { renderControls } from './Controls';
import { renderInspector } from './Inspector';
import { renderSource } from './SourcePane';
import { renderStreamedView, renderStaticView } from './StreamedView';
import type { FormatId, Lab, LabState, Parsed, TabId } from './lab';
import { editorPluginKey, editorPlugins, MentionChip, VIEW_PLUGINS } from './plugins';
import { SAMPLES } from './samples';

/** Where the header's showcase link goes: the showcase's dev server unless the deploy says otherwise. */
const SHOWCASE_URL: string = import.meta.env.VITE_SHOWCASE_URL ?? 'http://localhost:5174/';

const FORMATS = { markdown: markdownFormat, html: htmlFormat };
const TABS: readonly { id: TabId; label: string }[] = [
    { id: 'streaming', label: 'Streaming' },
    { id: 'roundtrip', label: 'Round-trip' },
    { id: 'editor', label: 'Core editor' }
];

type CodeSlot = DomComponents['code'];

export const App = component(({ signal, onUnmounted }) => {
    const state = signal<LabState>({
        tab: 'streaming',
        sample: 'kitchen-sink',
        format: 'markdown',
        source: SAMPLES[0].source,
        shiki: false,
        shikiReady: false,
        mention: true,
        htmlPaste: true,
        classPrefix: false,
        blockStates: true,
        dark: false,
        charsPerTick: 3,
        tickMs: 16,
        status: 'idle',
        streamTotal: SAMPLES[0].source.length,
        inspector: 'engine',
        lastLink: ''
    });

    const format = computed(() => FORMATS[state.format]);
    const plugins = computed(() => (state.mention ? VIEW_PLUGINS.on : VIEW_PLUGINS.off));

    // ---- Shiki: loaded on first toggle so the initial bundle stays small ----
    let shikiCode: CodeSlot | null = null;
    let shikiLoading: Promise<void> | null = null;
    const loadShiki = (): Promise<void> => {
        shikiLoading ??= import('@sigx/richtext-shiki').then(({ createShikiHighlighter }) => {
            shikiCode = highlightedCodeBlock(createShikiHighlighter());
            state.shikiReady = true;
        });
        return shikiLoading;
    };

    const components = computed<Partial<DomComponents>>(() => {
        const slots: Partial<DomComponents> = { mention: MentionChip };
        if (state.shiki && state.shikiReady && shikiCode) slots.code = shikiCode;
        return slots;
    });

    // ---- Streaming: replay the source through createTextStream ----
    const stream = createTextStream({ flushIntervalMs: 16 });
    let timer: ReturnType<typeof setInterval> | null = null;
    /** The text being streamed (the source when the stream started) and how much of it went out. */
    let text = '';
    let cursor = 0;

    const clearTimer = (): void => {
        if (timer !== null) {
            clearInterval(timer);
            timer = null;
        }
    };

    const tick = (): void => {
        const step = Math.max(1, Math.floor(state.charsPerTick) || 1);
        const next = Math.min(text.length, cursor + step);
        stream.append(text.slice(cursor, next));
        cursor = next;
        if (cursor >= text.length) {
            clearTimer();
            stream.done();
            state.status = 'done';
        }
    };

    const run = (): void => {
        clearTimer();
        state.status = 'streaming';
        timer = setInterval(tick, Math.max(1, Math.floor(state.tickMs) || 1));
    };

    const startStream = (): void => {
        stream.reset();
        text = state.source;
        cursor = 0;
        state.streamTotal = text.length;
        run();
    };

    /** Back to idle with nothing streamed: the source, its format or the plugins changed under the stream. */
    const stopStream = (): void => {
        clearTimer();
        stream.reset();
        cursor = 0;
        state.status = 'idle';
    };

    onUnmounted(clearTimer);

    // ---- The Lab's own engine: the view renders the tree it produces, so the inspector sees what the view sees ----
    let engine: IncrementalEngine | null = null;
    let engineFormat = format.value;
    let enginePlugins: readonly RichTextPlugin[] = plugins.value;
    const parsed = computed<Parsed>(() => {
        const fmt = format.value;
        const pl = plugins.value;
        const src = stream.value.value;
        if (!engine || fmt !== engineFormat || pl !== enginePlugins) {
            engineFormat = fmt;
            enginePlugins = pl;
            engine = fmt.createIncrementalEngine?.({ plugins: pl }) ?? createReparseEngine((s) => fmt.parse(s, { plugins: pl }));
        }
        const t0 = performance.now();
        const root = engine.parse(src);
        const ms = performance.now() - t0;
        return { root, ms, ...engine.inspect(), incremental: !!fmt.createIncrementalEngine };
    });

    const full = computed(() => format.value.parse(state.source, { plugins: plugins.value }));

    /** Convert the source between the two formats through the tree. */
    const convert = (source: string, from: FormatId, to: FormatId): string => {
        if (from === to) return source;
        const opts = { plugins: plugins.value };
        return to === 'html' ? toHtml(parseMarkdown(source, opts), opts) : toMarkdown(parseHtml(source, opts), opts);
    };

    const lab: Lab = {
        state,
        format: () => format.value,
        plugins: () => plugins.value,
        components: () => components.value,
        classPrefix: () => (state.classPrefix ? 'rt' : undefined),
        streamed: () => stream.value.value,
        parsed: () => parsed.value,
        full: () => full.value,
        toggleStream: () => {
            if (state.status === 'streaming') {
                clearTimer();
                state.status = 'paused';
            } else if (state.status === 'paused') {
                run();
            } else {
                startStream();
            }
        },
        restartStream: startStream,
        pickSample: (id) => {
            stopStream();
            state.sample = id;
            const sample = SAMPLES.find((s) => s.id === id) ?? SAMPLES[0];
            state.source = convert(sample.source, 'markdown', state.format);
        },
        pickFormat: (id) => {
            if (id === state.format) return;
            stopStream();
            state.source = convert(state.source, state.format, id);
            state.format = id;
        },
        setTab: (id) => {
            state.tab = id;
            // The engine tab only exists while streaming; the other tabs open on the markdown out.
            if (id !== 'streaming' && state.inspector === 'engine') state.inspector = 'markdown';
            if (id === 'streaming') state.inspector = 'engine';
        },
        toggleShiki: () => {
            state.shiki = !state.shiki;
            if (state.shiki) void loadShiki();
        },
        toggleDark: () => {
            state.dark = !state.dark;
            document.documentElement.dataset.theme = state.dark ? 'dark' : 'light';
        },
        setTickMs: (ms) => {
            state.tickMs = ms;
            if (state.status === 'streaming') run();
        },
        onLink: (url) => {
            state.lastLink = url;
        }
    };

    const editorKey = computed(() => `${state.format}:${editorPluginKey(state.mention, state.htmlPaste)}`);

    const renderEditor = () => {
        const key = editorKey.value;
        const fmt = format.value;
        return (
            <section class="col col-wide" key={key}>
                <header class="col-head">
                    <h2>Core editor</h2>
                    <span class="chip">{fmt.id === 'html' ? 'HTML' : 'Markdown'}</span>
                    <span class="col-note">reference editor.css</span>
                </header>
                <div class="col-body">
                    {/* Two-way bound to the same source the other panes render. Remounted when its format or plugins change: it captures both. */}
                    <RichTextEditor
                        id="editor"
                        format={fmt}
                        formats={[fmt === markdownFormat ? htmlFormat : markdownFormat]}
                        model:source={[state, 'source']}
                        plugins={editorPlugins(key.split(':')[1])}
                        components={{ mention: MentionChip }}
                        placeholder="Write, or type / for blocks and @ to mention…"
                        floatingToolbar
                    />
                </div>
            </section>
        );
    };

    const renderColumns = () => {
        switch (state.tab) {
            case 'streaming':
                return [renderSource(lab), renderStreamedView(lab), renderInspector(lab)];
            case 'roundtrip':
                return [renderSource(lab), renderStaticView(lab), renderInspector(lab)];
            case 'editor':
                return [renderEditor(), renderStaticView(lab), renderInspector(lab)];
        }
    };

    const statusLine = () => {
        switch (state.status) {
            case 'streaming':
                return `Streaming · ${state.charsPerTick} chars every ${state.tickMs} ms`;
            case 'paused':
                return 'Paused';
            case 'done':
                return 'Stream done';
            default:
                return 'Idle';
        }
    };

    return () => (
        <div class="lab" data-tab={state.tab}>
            <header class="lab-bar">
                <span class="wordmark">@sigx/richtext</span>
                <span class="badge">Lab</span>
                <nav class="tabs" role="tablist" aria-label="Lab views">
                    {TABS.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            role="tab"
                            data-testid={`tab-${t.id}`}
                            aria-selected={String(state.tab === t.id)}
                            onClick={() => lab.setTab(t.id)}
                        >
                            {t.label}
                        </button>
                    ))}
                </nav>
                <span class="spacer" />
                <span class="note">Core only: no design system loaded</span>
                <button type="button" class="ghost" data-testid="toggle-dark" aria-pressed={String(state.dark)} onClick={lab.toggleDark}>
                    {state.dark ? 'Dark' : 'Light'}
                </button>
                <a class="ghost" href={SHOWCASE_URL}>
                    Zero editor showcase →
                </a>
            </header>

            <div class="lab-main">
                {renderControls(lab)}
                <main class="cols">{renderColumns()}</main>
            </div>

            <footer class="lab-foot">
                <span class="dot" data-status={state.status} />
                <span data-testid="stream-status" class="sr-only">
                    {state.status}
                </span>
                <span>{statusLine()}</span>
                <span class="mono">{parsed.value.incremental ? 'createIncrementalEngine' : 'createReparseEngine'}</span>
                <span class="mono muted">
                    last link: <span data-testid="last-link">{state.lastLink}</span>
                </span>
                <span class="spacer" />
                <span class="mono muted">@sigx/richtext · @sigx/richtext-markdown · @sigx/richtext-html · @sigx/richtext-shiki</span>
            </footer>
        </div>
    );
});
