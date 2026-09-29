/**
 * The inspector column. **Engine** (Streaming tab only) shows what
 * `engine.inspect()` reports and every top-level block with its key, type,
 * source lines and state. **Markdown**, **HTML** and **JSON** show the tree
 * serialized — the streamed tree on the Streaming tab, the whole source
 * elsewhere. On the Round-trip tab a badge says whether serializing is
 * stable: `serialize(parse(serialize(tree)))` equals `serialize(tree)`.
 */
import type { JSXElement } from 'sigx';
import { toJSON, type Root } from '@sigx/richtext';
import { toMarkdown } from '@sigx/richtext-markdown';
import { toHtml } from '@sigx/richtext-html';
import { blockKey, type InspectorTab, type Lab } from './lab';

const TABS: readonly { id: InspectorTab; label: string }[] = [
    { id: 'engine', label: 'Engine' },
    { id: 'markdown', label: 'Markdown' },
    { id: 'html', label: 'HTML' },
    { id: 'json', label: 'JSON' }
];

function stat(label: string, value: string | number, testId: string, tone?: 'final' | 'open'): JSXElement {
    return (
        <div class="stat" data-tone={tone}>
            <span class="stat-label">{label}</span>
            <span class="stat-value" data-testid={testId}>
                {value}
            </span>
        </div>
    );
}

function renderEngine(lab: Lab): JSXElement {
    const parsed = lab.parsed();
    const blocks = parsed.root.children;
    return (
        <div class="engine">
            <div class="stats">
                {stat('Finalized blocks', parsed.finalized, 'engine-finalized', 'final')}
                {stat('Open tail', blocks.length - parsed.finalized, 'engine-open', 'open')}
                {stat('Cut offset', parsed.cut, 'engine-cut')}
                {stat('Parse per tick', `${parsed.ms.toFixed(2)} ms`, 'engine-ms')}
            </div>
            {parsed.incremental ? null : (
                <p class="note-box">
                    This format has no incremental engine: <code>createReparseEngine</code> re-parses the whole source on every tick, so nothing is
                    finalized.
                </p>
            )}
            <table class="blocks" data-testid="engine-blocks">
                <thead>
                    <tr>
                        <th>Key</th>
                        <th>Type</th>
                        <th>Source</th>
                        <th>State</th>
                    </tr>
                </thead>
                <tbody>
                    {blocks.map((node, i) => {
                        const key = blockKey(node, i);
                        const final = i < parsed.finalized;
                        const pos = node.position;
                        return (
                            <tr key={key}>
                                <td class="mono">{key}</td>
                                <td class="mono">{node.type}</td>
                                <td class="mono muted">{pos ? `L${pos.start.line}–${pos.end.line}` : '—'}</td>
                                <td>
                                    <span class="pill" data-block-state={final ? 'final' : 'open'}>
                                        {final ? 'final' : 'open'}
                                    </span>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

/** Serialized once more through the source format: equal means the round trip is a fixed point. */
function roundTrips(lab: Lab, root: Root): boolean {
    const format = lab.format();
    const opts = { plugins: lab.plugins() };
    const once = format.serialize(root, opts);
    return format.serialize(format.parse(once, opts), opts) === once;
}

export function renderInspector(lab: Lab): JSXElement {
    const { state } = lab;
    const streaming = state.tab === 'streaming';
    const tabs = streaming ? TABS : TABS.filter((t) => t.id !== 'engine');
    const active = tabs.some((t) => t.id === state.inspector) ? state.inspector : tabs[0].id;
    const root = streaming ? lab.parsed().root : lab.full();
    const opts = { plugins: lab.plugins() };

    let body: JSXElement;
    switch (active) {
        case 'engine':
            body = renderEngine(lab);
            break;
        case 'markdown':
            body = (
                <pre class="out" data-testid="serialized-md">
                    {toMarkdown(root, opts)}
                </pre>
            );
            break;
        case 'html':
            body = (
                <pre class="out" data-testid="serialized-html">
                    {toHtml(root, opts)}
                </pre>
            );
            break;
        case 'json':
            body = (
                <pre class="out" data-testid="serialized-json">
                    {JSON.stringify(toJSON(root), null, 2)}
                </pre>
            );
            break;
    }

    const stable = state.tab === 'roundtrip' ? roundTrips(lab, root) : null;

    return (
        <section class="col" key="inspector">
            <header class="col-head tabs-head">
                <h2>Inspector</h2>
                <div class="subtabs" role="tablist" aria-label="Inspector">
                    {tabs.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            role="tab"
                            data-testid={`inspector-${t.id}`}
                            aria-selected={String(active === t.id)}
                            onClick={() => {
                                state.inspector = t.id;
                            }}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
                {stable === null ? null : (
                    <span class="pill" data-testid="roundtrip" data-ok={stable ? '' : undefined}>
                        {stable ? 'round-trips' : 'drifts'}
                    </span>
                )}
            </header>
            <div class="col-body">{body}</div>
        </section>
    );
}
