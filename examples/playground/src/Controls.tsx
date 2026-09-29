/**
 * The left control panel: the document (sample and source format), the
 * plugins, the stream's speed and transport, and the view's rendering
 * options.
 */
import type { JSXElement } from 'sigx';
import type { FormatId, Lab } from './lab';
import { SAMPLES, type SampleId } from './samples';

const FORMAT_OPTIONS: readonly { id: FormatId; label: string }[] = [
    { id: 'markdown', label: 'Markdown' },
    { id: 'html', label: 'HTML' }
];

const number = (e: Event): number => Number((e.target as HTMLInputElement).value);

/** A checkbox row: label on the left, the package it exercises on the right. */
function toggle(testId: string, label: string, hint: string, checked: boolean, onChange: () => void): JSXElement {
    return (
        <label class="check">
            <input type="checkbox" data-testid={testId} checked={checked} onChange={onChange} />
            <span>{label}</span>
            <span class="hint">{hint}</span>
        </label>
    );
}

export function renderControls(lab: Lab): JSXElement {
    const { state } = lab;
    const streamed = lab.streamed().length;
    const total = state.status === 'idle' ? state.source.length : state.streamTotal;
    const percent = total === 0 ? 0 : Math.round((streamed / total) * 100);
    const transport = state.status === 'streaming' ? 'Pause' : state.status === 'paused' ? 'Resume' : 'Stream';

    return (
        <aside class="controls" aria-label="Lab controls">
            <section>
                <h3>Document</h3>
                <label class="field">
                    <span>Sample</span>
                    <select data-testid="sample" value={state.sample} onChange={(e) => lab.pickSample((e.target as HTMLSelectElement).value as SampleId)}>
                        {SAMPLES.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.label}
                            </option>
                        ))}
                    </select>
                </label>
                <div class="field">
                    <span id="format-label">Source format</span>
                    <div class="segmented" role="radiogroup" aria-labelledby="format-label">
                        {FORMAT_OPTIONS.map((f) => (
                            <button
                                key={f.id}
                                type="button"
                                role="radio"
                                data-testid={`format-${f.id}`}
                                aria-checked={String(state.format === f.id)}
                                onClick={() => lab.pickFormat(f.id)}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>
            </section>

            <section>
                <h3>Plugins</h3>
                {toggle('toggle-shiki', 'Shiki', 'richtext-shiki', state.shiki, lab.toggleShiki)}
                {toggle('toggle-mention', 'Mentions', 'mentionPlugin', state.mention, () => {
                    state.mention = !state.mention;
                })}
                {toggle('toggle-html-paste', 'HTML paste', 'htmlPreset', state.htmlPaste, () => {
                    state.htmlPaste = !state.htmlPaste;
                })}
            </section>

            <section>
                <h3>Streaming</h3>
                <label class="field">
                    <span class="row">
                        Chars per tick <output class="mono">{state.charsPerTick}</output>
                    </span>
                    <input
                        type="range"
                        min="1"
                        max="40"
                        data-testid="chars-per-tick"
                        value={state.charsPerTick}
                        onInput={(e) => {
                            state.charsPerTick = number(e);
                        }}
                    />
                </label>
                <label class="field">
                    <span class="row">
                        Tick interval <output class="mono">{state.tickMs} ms</output>
                    </span>
                    <input type="range" min="1" max="200" data-testid="tick-ms" value={state.tickMs} onInput={(e) => lab.setTickMs(number(e))} />
                </label>
                <div class="transport">
                    <button type="button" class="primary" data-testid="stream-start" onClick={lab.toggleStream}>
                        {transport}
                    </button>
                    <button type="button" class="icon" data-testid="stream-restart" title="Restart the stream" aria-label="Restart the stream" onClick={lab.restartStream}>
                        ↻
                    </button>
                </div>
                <progress data-testid="stream-progress" max={total || 1} value={streamed} aria-label="Streamed characters" />
                <div class="row mono muted">
                    <span data-testid="stream-count">
                        {streamed} / {total} chars
                    </span>
                    <span>{percent}%</span>
                </div>
            </section>

            <section>
                <h3>Rendering</h3>
                {toggle('toggle-class-prefix', 'Class prefix', 'rt-', state.classPrefix, () => {
                    state.classPrefix = !state.classPrefix;
                })}
                {toggle('toggle-block-states', 'Mark block states', 'final / open', state.blockStates, () => {
                    state.blockStates = !state.blockStates;
                })}
            </section>
        </aside>
    );
}
