/**
 * The source column: an editable textarea over a mirror of the same text.
 * The mirror draws the line numbers, and while a stream runs it shows how
 * far the stream got: the streamed part in full colour, a cursor at the cut,
 * the rest greyed out. The textarea on top keeps its caret and selection
 * but draws no text of its own, so both wrap identically (same font, width
 * and `pre-wrap`).
 */
import type { JSXElement } from 'sigx';
import type { Lab } from './lab';

export function renderSource(lab: Lab): JSXElement {
    const { state } = lab;
    const source = state.source;
    const live = state.status === 'streaming' || state.status === 'paused';
    // The stream replays the source it started with; while it runs, the cut is how much of it went out.
    const cut = live ? lab.streamed().length : source.length;

    let offset = 0;
    const rows = source.split('\n').map((line, i) => {
        const start = offset;
        offset += line.length + 1;
        const done = cut >= start + line.length ? line : cut <= start ? '' : line.slice(0, cut - start);
        const caret = live && cut >= start && cut <= start + line.length;
        return (
            <div class="src-row" key={i}>
                <span class="ln" aria-hidden="true">
                    {i + 1}
                </span>
                <span class="txt">
                    {done}
                    {caret ? <span class="cut" data-testid="source-cut" /> : null}
                    <span class="pending">{line.slice(done.length)}</span>
                    {line === '' ? '​' : ''}
                </span>
            </div>
        );
    });

    return (
        <section class="col" key="source">
            <header class="col-head">
                <h2>Source</h2>
                <span class="chip">{state.format === 'html' ? 'HTML' : 'Markdown'}</span>
                <span class="col-note">editable</span>
            </header>
            <div class="col-body flush">
                <div class="src">
                    <pre class="src-mirror" aria-hidden="true">
                        {rows}
                    </pre>
                    <textarea
                        class="src-input"
                        data-testid="source"
                        aria-label={state.format === 'html' ? 'HTML source' : 'Markdown source'}
                        spellCheck={false}
                        value={source}
                        onInput={(e) => {
                            state.source = (e.target as HTMLTextAreaElement).value;
                        }}
                    />
                </div>
            </div>
        </section>
    );
}
