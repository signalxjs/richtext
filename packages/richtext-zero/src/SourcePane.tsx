/**
 * `<SourcePane>` — the document's source in one format, read-only: a header
 * with the format's name, a badge and a copy button, then the highlighted
 * lines with a line-number gutter (not selectable, so a copy takes only the
 * source).
 */

import { component, type Define } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import { Badge, Button } from '@sigx/zero';
import { zeroPart } from './anatomy.js';
import { highlightSource } from './highlight.js';
import { ZeroIcon } from './icons.js';

/** How the pane names a format: its title and a badge. Unknown ids use the id and the format's first MIME type. */
export const FORMAT_NAMES: Readonly<Record<string, { title: string; badge: string }>> = {
    markdown: { title: 'Markdown', badge: 'CommonMark + GFM' },
    html: { title: 'HTML', badge: 'text/html' },
    text: { title: 'Plain text', badge: 'text/plain' },
};

export function formatName(format: { id: string; mime?: readonly string[] }): { title: string; badge: string } {
    return FORMAT_NAMES[format.id] ?? { title: format.id, badge: format.mime?.[0] ?? '' };
}

export type SourcePaneProps = Define.WithAttrs<
    & Define.Prop<'source', string, true>
    & Define.Prop<'format', { id: string; mime?: readonly string[] }, true>
>;

export const SourcePane = component<SourcePaneProps>(({ props, signal }) => {
    const copied = signal({ at: 0 });
    const copy = (): void => {
        const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
        if (!clip?.writeText) return;
        void clip.writeText(props.source).then(() => (copied.at = Date.now()));
    };
    return () => {
        const name = formatName(props.format);
        const lines = highlightSource(props.source.replace(/\n$/, ''), props.format.id);
        return (
            <section {...zeroPart('source')} data-format={props.format.id} aria-label={`${name.title} source`}>
                <header {...zeroPart('source-header')}>
                    <ZeroIcon name="file-code" />
                    <span {...zeroPart('source-title')}>{name.title}</span>
                    {name.badge ? (
                        <Badge.Root size="sm" variant="soft">
                            {name.badge}
                        </Badge.Root>
                    ) : null}
                    <Button.Root size="sm" variant="ghost" aria-label={`Copy ${name.title}`} onClick={copy}>
                        <ZeroIcon name={copied.at ? 'check' : 'copy'} />
                        {copied.at ? 'Copied' : 'Copy'}
                    </Button.Root>
                </header>
                <pre {...zeroPart('source-body')} tabIndex={0}>
                    <code>
                        {lines.map((line, i) => (
                            <span key={String(i)} {...zeroPart('line')}>
                                <span {...zeroPart('line-number')} aria-hidden="true">
                                    {String(i + 1)}
                                </span>
                                {line.map((t, j) => (
                                    <span key={String(j)} {...zeroPart('token')} data-kind={t.kind}>
                                        {t.text}
                                    </span>
                                ))}
                                {'\n'}
                            </span>
                        ))}
                    </code>
                </pre>
            </section>
        );
    };
}, { name: 'SourcePane' });
