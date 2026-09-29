/**
 * The view columns. The streamed view renders the tree the Lab's own engine
 * parsed (`root`), so it can mark every top-level block with its state:
 * **final** (parsed once, reused by reference, never re-rendered) or the
 * **open tail** (re-parsed on every tick). The static view renders the whole
 * source through the view's own engine.
 */
import type { JSXElement } from 'sigx';
import type { RenderChild } from '@sigx/richtext';
import { partAttrs, RichTextView, type DomComponents } from '@sigx/richtext/dom';
import { blockIndex, type Lab } from './lab';

/**
 * A `root` slot that wraps each top-level block in a gutter element saying
 * whether it is final. The wrapper takes the block's own reconciliation key,
 * so a block that turns final is patched in place, never remounted, and the
 * state is read from the key — a block that renders to nothing shifts
 * nothing.
 */
function markedRoot(id: string, finalized: number, classPrefix: string | undefined): DomComponents['root'] {
    return ({ children }) => (
        <div id={id} {...partAttrs('root', classPrefix)} data-block-states="">
            {children.map((child: RenderChild<JSXElement>) => {
                const key = (child as { key?: string } | null)?.key;
                const state = blockIndex(key) < finalized ? 'final' : 'open';
                return (
                    <div key={key} class="block-gutter" data-block-state={state} data-key={key} title={`${key} · ${state}`}>
                        {child}
                    </div>
                );
            })}
        </div>
    );
}

export function renderStreamedView(lab: Lab): JSXElement {
    const { state } = lab;
    const parsed = lab.parsed();
    const prefix = lab.classPrefix();
    const components: Partial<DomComponents> = state.blockStates
        ? { ...lab.components(), root: markedRoot('streamed', parsed.finalized, prefix) }
        : lab.components();

    return (
        <section class="col" key="streamed">
            <header class="col-head">
                <h2>Streamed view</h2>
                {state.blockStates ? (
                    <span class="legend">
                        <span class="swatch" data-block-state="final" /> final
                        <span class="swatch" data-block-state="open" /> open tail
                    </span>
                ) : null}
            </header>
            <div class="col-body">
                {state.status === 'idle' ? <p class="empty">Press Stream to replay the source token by token.</p> : null}
                <RichTextView
                    format={lab.format()}
                    id="streamed"
                    root={parsed.root}
                    plugins={lab.plugins()}
                    components={components}
                    onLink={lab.onLink}
                    classPrefix={prefix}
                />
            </div>
        </section>
    );
}

export function renderStaticView(lab: Lab): JSXElement {
    return (
        <section class="col" key="static">
            <header class="col-head">
                <h2>View</h2>
                <span class="col-note">RichTextView · whole source</span>
            </header>
            <div class="col-body">
                <RichTextView
                    format={lab.format()}
                    id="static"
                    value={lab.state.source}
                    plugins={lab.plugins()}
                    components={lab.components()}
                    onLink={lab.onLink}
                    classPrefix={lab.classPrefix()}
                />
            </div>
        </section>
    );
}
