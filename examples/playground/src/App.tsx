/**
 * The playground: a source pane, the DOM view with its toggles, a streamed
 * copy of the view fed through `createTextStream`, and the serializer
 * output. One component, one reactive state object — the view re-renders
 * only the block a keystroke touches.
 */
import { component, computed, type JSXElement } from 'sigx';
import { createTextStream, toJSON, type RenderChild, type RichTextPlugin, type Mention, type NodeProps } from '@sigx/richtext';
import { RichTextView, highlightedCodeBlock, type DomComponents } from '@sigx/richtext/dom';
import { createSlashPlugin } from '@sigx/richtext/editor';
import { RichTextEditor, createDomMentionPlugin } from '@sigx/richtext/editor/dom';
import { markdownFormat, mentionMarkdown, mentionPlugin, parseMarkdown, toMarkdown } from '@sigx/richtext-markdown';
import { markdownPreset } from '@sigx/richtext-markdown/editor';
import { htmlFormat, mentionHtml } from '@sigx/richtext-html';
import { htmlPreset } from '@sigx/richtext-html/editor';

// Register the mention node with the AST and type its component slot: this
// is the consumer-side half of the plugin contract (the package does not do
// it itself so a plain tree stays exactly mdast).
declare module '@sigx/richtext' {
    interface PhrasingContentMap {
        mention: Mention;
    }
    interface PluginComponents<E> {
        mention(p: NodeProps<E, Mention>): RenderChild<E>;
    }
}

const SAMPLE = `# @sigx/richtext playground

Markdown for **SignalX** — an *incremental* parser that keeps finalized blocks
stable while the source grows, a serializer, and a DOM view styled through
\`data-part\` attributes. Read the [docs](https://sigx.dev/markdown/) or ping
@[Andy](u1) with questions.

## Lists

- Blocks keep their identity while streaming
- Inline: *emphasis*, **strong**, ~~strike~~, \`code\`, <https://sigx.dev>
  - Nested items work too
  - And a [relative link](/guide) that stays in the app
- Images: ![SignalX](/signalx-logo-150x119.png)

1. Parse
2. Render
3. Serialize

### Tasks

- [x] Parser
- [x] DOM view
- [ ] Editor

## Code

\`\`\`ts
export function greet(name: string): string {
    const now = new Date();
    return \`Hello, \${name}! It is \${now.toLocaleTimeString()}.\`;
}
\`\`\`

> A blockquote, with **strong** text inside it.
> It spans two lines.

## Table

| Entry | Runs on | Notes |
|:------|:-------:|------:|
| \`.\` | everywhere | parser, serializer, engine |
| \`./dom\` | web | \`RichTextView\` |
| \`./shiki\` | web | optional highlighting |

---

That's it. Edit the source on the left; hit **Stream** to replay it token by token.
`;

// Plugin arrays are captured by the view's incremental engine: keep both
// identities stable (a new array re-creates the engine and re-parses).
const NO_PLUGINS: readonly RichTextPlugin[] = [];
const WITH_MENTION: readonly RichTextPlugin[] = [mentionPlugin];

/** Who `@` can mention in the editor. */
const PEOPLE = [
    { id: 'u1', label: 'Andy' },
    { id: 'u2', label: 'Bea' },
    { id: 'u3', label: 'Chris' },
    { id: 'u4', label: 'Dana' }
];

/** The editor's plugins: the markdown preset (input rules, clipboard), the HTML preset (`text/html` on copy), the mention syntax + `@` trigger + chip, and `/` block commands. Captured at mount. */
const EDITOR_PLUGINS: readonly RichTextPlugin[] = [
    markdownPreset,
    htmlPreset,
    createDomMentionPlugin({
        onQuery: (q) => PEOPLE.filter((p) => p.label.toLowerCase().startsWith(q.toLowerCase())),
        formats: { markdown: mentionMarkdown, html: mentionHtml }
    }),
    createSlashPlugin()
];

/** The `mention` slot: a plain function, called by the render engine with the node. */
const MentionChip = ({ node }: NodeProps<JSXElement, Mention>): JSXElement => (
    <span data-scope="richtext" data-part="mention" title={node.id}>
        @{node.label}
    </span>
);

type CodeSlot = DomComponents['code'];

export const App = component(({ signal, onUnmounted }) => {
    const state = signal({
        source: SAMPLE,
        shiki: false,
        shikiReady: false,
        mention: true,
        classPrefix: false,
        dark: false,
        charsPerTick: 3,
        tickMs: 16,
        streaming: false,
        lastLink: '',
        editor: false
    });

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

    const toggleShiki = (): void => {
        state.shiki = !state.shiki;
        if (state.shiki) void loadShiki();
    };

    const toggleDark = (): void => {
        state.dark = !state.dark;
        document.documentElement.dataset.theme = state.dark ? 'dark' : 'light';
    };

    // ---- View inputs ----
    const plugins = computed<readonly RichTextPlugin[]>(() => (state.mention ? WITH_MENTION : NO_PLUGINS));

    const components = computed<Partial<DomComponents>>(() => {
        const slots: Partial<DomComponents> = { mention: MentionChip };
        if (state.shiki && state.shikiReady && shikiCode) slots.code = shikiCode;
        return slots;
    });

    const onLink = (url: string): void => {
        state.lastLink = url;
    };

    // ---- Streaming: replay the source through createTextStream ----
    const stream = createTextStream({ flushIntervalMs: 16 });
    let timer: ReturnType<typeof setInterval> | null = null;

    const clearTimer = (): void => {
        if (timer !== null) {
            clearInterval(timer);
            timer = null;
        }
    };

    const finishStream = (): void => {
        clearTimer();
        stream.done();
        state.streaming = false;
    };

    const startStream = (): void => {
        clearTimer();
        stream.reset();
        const text = state.source;
        const step = Math.max(1, Math.floor(state.charsPerTick) || 1);
        const every = Math.max(1, Math.floor(state.tickMs) || 1);
        let cursor = 0;
        state.streaming = true;
        timer = setInterval(() => {
            const next = Math.min(text.length, cursor + step);
            stream.append(text.slice(cursor, next));
            cursor = next;
            if (cursor >= text.length) finishStream();
        }, every);
    };

    const streamStatus = computed(() => (state.streaming ? 'streaming' : stream.finished.value ? 'done' : 'idle'));

    onUnmounted(clearTimer);

    // ---- Serializer output ----
    const root = computed(() => parseMarkdown(state.source, { plugins: plugins.value }));
    const serializedMarkdown = computed(() => toMarkdown(root.value, { plugins: plugins.value }));
    const serializedJson = computed(() => JSON.stringify(toJSON(root.value), null, 2));

    const number = (e: Event): number => Number((e.target as HTMLInputElement).value);

    return () => (
        <div class="app">
            <header class="toolbar">
                <h1>@sigx/richtext</h1>
                <label>
                    <input type="checkbox" data-testid="toggle-shiki" checked={state.shiki} onChange={toggleShiki} />
                    Shiki
                </label>
                <label>
                    <input
                        type="checkbox"
                        data-testid="toggle-mention"
                        checked={state.mention}
                        onChange={() => {
                            state.mention = !state.mention;
                        }}
                    />
                    Mention plugin
                </label>
                <label>
                    <input
                        type="checkbox"
                        data-testid="toggle-class-prefix"
                        checked={state.classPrefix}
                        onChange={() => {
                            state.classPrefix = !state.classPrefix;
                        }}
                    />
                    classPrefix
                </label>
                <label>
                    <input type="checkbox" data-testid="toggle-dark" checked={state.dark} onChange={toggleDark} />
                    Dark
                </label>
                <label>
                    <input
                        type="checkbox"
                        data-testid="toggle-editor"
                        checked={state.editor}
                        onChange={() => {
                            state.editor = !state.editor;
                        }}
                    />
                    Editor
                </label>
                <label>
                    chars/tick
                    <input
                        type="number"
                        min="1"
                        data-testid="chars-per-tick"
                        value={state.charsPerTick}
                        onInput={(e) => {
                            state.charsPerTick = number(e);
                        }}
                    />
                </label>
                <label>
                    tick ms
                    <input
                        type="number"
                        min="1"
                        data-testid="tick-ms"
                        value={state.tickMs}
                        onInput={(e) => {
                            state.tickMs = number(e);
                        }}
                    />
                </label>
                <button type="button" data-testid="stream-start" onClick={startStream}>
                    Stream
                </button>
                <button type="button" data-testid="stream-stop" disabled={!state.streaming} onClick={finishStream}>
                    {state.streaming ? 'Stop' : 'Done'}
                </button>
                <span class="status" data-testid="stream-status">
                    {streamStatus.value}
                </span>
                <span class="last-link">
                    last link: <span data-testid="last-link">{state.lastLink}</span>
                </span>
            </header>

            <main class="panes">
                {state.editor ? (
                    <section class="pane pane-editor">
                        <h2>Editor</h2>
                        <div class="body">
                            {/* Two-way bound to the same source the panes on the right render. */}
                            <RichTextEditor
                                id="editor"
                                format={markdownFormat}
                                formats={[htmlFormat]}
                                model:source={[state, 'source']}
                                plugins={EDITOR_PLUGINS}
                                components={{ mention: MentionChip }}
                                placeholder="Write, or type / for blocks and @ to mention…"
                                floatingToolbar
                            />
                        </div>
                    </section>
                ) : (
                    <section class="pane">
                        <h2>Source</h2>
                        <textarea
                            data-testid="source"
                            aria-label="Markdown source"
                            spellCheck={false}
                            value={state.source}
                            onInput={(e) => {
                                state.source = (e.target as HTMLTextAreaElement).value;
                            }}
                        />
                    </section>
                )}

                <section class="pane">
                    <h2>View</h2>
                    <div class="body">
                        <RichTextView format={markdownFormat}
                            id="static"
                            value={state.source}
                            plugins={plugins.value}
                            components={components.value}
                            onLink={onLink}
                            classPrefix={state.classPrefix ? 'md' : undefined}
                        />
                    </div>
                </section>

                <section class="pane">
                    <h2>Streamed</h2>
                    <div class="body">
                        <RichTextView format={markdownFormat}
                            id="streamed"
                            value={stream.value.value}
                            plugins={plugins.value}
                            components={components.value}
                            onLink={onLink}
                            classPrefix={state.classPrefix ? 'md' : undefined}
                        />
                    </div>
                </section>

                <section class="pane">
                    <h2>Serialized</h2>
                    <div class="body">
                        <h3>toMarkdown(parseMarkdown(source))</h3>
                        <pre class="out" data-testid="serialized-md">
                            {serializedMarkdown.value}
                        </pre>
                        <h3>toJSON(parseMarkdown(source))</h3>
                        <pre class="out" data-testid="serialized-json">
                            {serializedJson.value}
                        </pre>
                    </div>
                </section>
            </main>
        </div>
    );
});
