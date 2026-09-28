/**
 * The link popover's body as zero parts: an `Input` and `Button`s in the
 * form, the URL and `Button`s in the view bubble. The core's popover keeps
 * its placement, Enter / Escape, the outside click and `sanitizeUrl` — the
 * view links only the sanitised `info.href`.
 */

import { mergeProps, type JSXElement } from '@sigx/runtime-core';
import type {} from '@sigx/runtime-dom';
import { Button, Input } from '@sigx/zero';
import type { LinkPopoverRender } from '@sigx/richtext/editor/dom';
import { zeroPart } from './anatomy.js';
import { ZeroIcon } from './icons.js';

/** A zero `Button` whose press keeps the caret in the text (view mode). */
function keepCaretButton(label: string, onPointerDown: (e: PointerEvent) => void, onClick: () => void, variant: string, children: JSXElement): JSXElement {
    return (
        <Button.Root asChild size="sm" variant={variant}>
            {(bag: Record<string, unknown>) => (
                <button type="button" aria-label={label} {...mergeProps(bag, { onPointerDown, onClick })}>
                    {children}
                </button>
            )}
        </Button.Root>
    );
}

/** `renderLinkPopover` for `RichTextEditor`. */
export const renderZeroLinkPopover: LinkPopoverRender = (info) => {
    if (info.mode === 'edit') {
        return (
            <div {...zeroPart('link-form')} role="group" aria-label="Link">
                <Input.Root type="url" defaultValue={info.link?.url ?? ''} spellcheck={false} size="sm">
                    <Input.Label visuallyHidden>Link URL</Input.Label>
                    <Input.Control>
                        <Input.Input placeholder={info.inputAttrs.placeholder} />
                    </Input.Control>
                </Input.Root>
                <Button.Root size="sm" color="primary" onClick={() => info.apply()}>
                    Apply
                </Button.Root>
                {info.link ? (
                    <Button.Root size="sm" variant="ghost" onClick={() => info.remove()}>
                        Remove
                    </Button.Root>
                ) : null}
            </div>
        );
    }
    const keep = info.buttonAttrs.onPointerDown;
    return (
        <div {...zeroPart('link-view')}>
            <ZeroIcon name="link" />
            <a href={info.href} target="_blank" rel="noopener noreferrer" title={info.link?.title}>
                {info.link?.url}
            </a>
            {info.readOnly ? null : (
                <>
                    {keepCaretButton('Edit link', keep, () => info.edit(), 'ghost', <>Edit</>)}
                    {keepCaretButton('Remove link', keep, () => info.remove(), 'ghost', <>Remove</>)}
                </>
            )}
        </div>
    );
};
