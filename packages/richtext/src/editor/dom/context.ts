/**
 * The view context every block component reads: the editor instance, the
 * surface registry, focus tracking, the last arrow goal-x, and the options
 * that reach the surfaces and block views (atom renderers, container views,
 * placeholder, read-only).
 *
 * Provided by `<RichTextEditor>` through an injectable so nested blocks
 * (list items in quotes in lists) need no prop drilling.
 */

import { computed, signal, type Computed, type PrimitiveSignal } from '@sigx/reactivity';
import { defineInjectable } from '@sigx/runtime-core';
import type { Editor } from '../editor.js';
import { selectedBlockKeys } from '../commands.js';
import { rangeBlocks } from '../range.js';
import { isCrossBlock } from '../state.js';
import type { AnySurface } from '../surface.js';
import type { ContainerView } from './containers.js';
import type { AtomRenderer } from './inline-dom.js';
import type { DomComponents } from '../../dom/index.js';

/** Read signals for dependency tracking only (a render that depends on `rev` without using its value). */
export function track(..._values: unknown[]): void {}

export interface BlockMenuRequest {
    key: string;
    anchor: HTMLElement;
}

export interface EditorView {
    readonly editor: Editor;
    /** The editor root element once mounted. */
    root(): HTMLElement | null;
    /** Mounted surfaces by block key. */
    readonly surfaces: Map<string, AnySurface>;
    register(key: string, surface: AnySurface): () => void;
    /** Whether keyboard focus is inside the editor (a surface, the root, a void block). Stays true across a synchronous DOM swap. */
    hasFocus(): boolean;
    /** The x-goal of the last ArrowUp/Down boundary, for the neighbour to land under. */
    goalX: number | undefined;
    readonly atoms: ReadonlyMap<string, AtomRenderer>;
    /** Container views by block type (the standard ones plus the plugins'). */
    readonly containers: ReadonlyMap<string, ContainerView>;
    /** Keys of the blocks in the current block selection (empty for a text selection). */
    readonly selectedKeys: Computed<ReadonlySet<string>>;
    /** Keys of the code, void and table blocks inside a cross-block text range — they show no native highlight (`data-in-range`). */
    readonly rangeKeys: Computed<ReadonlySet<string>>;
    readOnly(): boolean;
    /** The placeholder for the single empty first block. */
    placeholder(): string | undefined;
    /** Whether block handles render. */
    handles(): boolean;
    /** The read-only component map void blocks render with. */
    components(): DomComponents;
    /** Focus the surface of a block (a no-op when it is not mounted). */
    focusBlock(key: string, target?: { edge: 'start' | 'end' } | { offset: number }): boolean;
    /** Move keyboard focus to the editor root (block selections live there). */
    focusRoot(): void;
    /** The open block menu (key + anchor element), or null. Reactive through `blockMenuRev`. */
    blockMenu(): BlockMenuRequest | null;
    readonly blockMenuRev: PrimitiveSignal<number>;
    openBlockMenu(key: string, anchor: HTMLElement): void;
    closeBlockMenu(): void;
    /** Wired to the root's `focusin` / `focusout` by the editor component. */
    focusIn(): void;
    focusOut(): void;
}

export const useEditorView = defineInjectable<EditorView>('RichTextEditorView', {
    hint: 'Editor block components render inside <RichTextEditor>.',
});

export interface CreateViewOptions {
    editor: Editor;
    atoms: ReadonlyMap<string, AtomRenderer>;
    containers: ReadonlyMap<string, ContainerView>;
    root(): HTMLElement | null;
    readOnly(): boolean;
    placeholder(): string | undefined;
    handles(): boolean;
    components(): DomComponents;
}

export function createEditorView(opts: CreateViewOptions): EditorView {
    const { editor } = opts;
    const surfaces = new Map<string, AnySurface>();
    let focusWithin = false;
    let blurTimer: ReturnType<typeof setTimeout> | null = null;

    const selectedKeys = computed<ReadonlySet<string>>(() => {
        track(editor.selRev.value);
        const sel = editor.state.selection;
        if (!sel || sel.mode !== 'block') return new Set();
        return new Set(selectedBlockKeys(editor.state));
    });

    const rangeKeys = computed<ReadonlySet<string>>(() => {
        track(editor.selRev.value, editor.rev.value);
        const state = editor.state;
        const sel = state.selection;
        if (!sel || sel.mode !== 'text' || !isCrossBlock(sel)) return new Set();
        return new Set(rangeBlocks(state, sel, editor.ctx).filter((b) => b.role !== 'textblock').map((b) => b.key));
    });

    let blockMenu: BlockMenuRequest | null = null;
    const blockMenuRev = signal(0);

    const view: EditorView = {
        editor,
        blockMenu: () => {
            track(blockMenuRev.value);
            return blockMenu;
        },
        blockMenuRev,
        openBlockMenu(key, anchor) {
            blockMenu = { key, anchor };
            blockMenuRev.value++;
        },
        closeBlockMenu() {
            if (!blockMenu) return;
            blockMenu = null;
            blockMenuRev.value++;
        },
        root: opts.root,
        surfaces,
        register(key, surface) {
            surfaces.set(key, surface);
            return () => {
                if (surfaces.get(key) === surface) surfaces.delete(key);
            };
        },
        hasFocus: () => focusWithin,
        goalX: undefined,
        atoms: opts.atoms,
        containers: opts.containers,
        selectedKeys,
        rangeKeys,
        readOnly: opts.readOnly,
        placeholder: opts.placeholder,
        handles: opts.handles,
        components: opts.components,
        focusBlock(key, target) {
            const s = surfaces.get(key);
            if (!s) return false;
            s.focus(target);
            return true;
        },
        focusRoot() {
            const el = opts.root();
            if (!el) return;
            if (el.ownerDocument.activeElement !== el) el.focus({ preventScroll: true });
            // A DOM range left inside a surface would keep reporting (and, in some
            // browsers, keep the caret painted there): drop it.
            const sel = el.ownerDocument.getSelection();
            if (sel && sel.rangeCount && el.contains(sel.anchorNode)) sel.removeAllRanges();
        },
        // Focus tracking: `focusout` fires before the next `focusin` (and before a
        // replaced element's successor mounts), so clearing is deferred a task.
        focusIn() {
            if (blurTimer !== null) {
                clearTimeout(blurTimer);
                blurTimer = null;
            }
            focusWithin = true;
        },
        focusOut() {
            if (blurTimer !== null) clearTimeout(blurTimer);
            blurTimer = setTimeout(() => {
                blurTimer = null;
                const root = opts.root();
                focusWithin = !!root && root.contains(root.ownerDocument.activeElement);
            }, 0);
        },
    };

    return view;
}
