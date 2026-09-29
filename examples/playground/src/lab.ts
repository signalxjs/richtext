/**
 * What the Lab's panes share: the state object, the derived values and the
 * actions. `App.tsx` builds it once; every pane is a plain render function
 * over it, so one reactive state drives the whole page.
 */
import { topKey, type DocumentFormat, type Root, type RichTextPlugin } from '@sigx/richtext';
import type { DomComponents } from '@sigx/richtext/dom';
import type { SampleId } from './samples';

export type TabId = 'streaming' | 'roundtrip' | 'editor';
export type FormatId = 'markdown' | 'html';
export type InspectorTab = 'engine' | 'markdown' | 'html' | 'json';
export type StreamStatus = 'idle' | 'streaming' | 'paused' | 'done';

export interface LabState {
    tab: TabId;
    sample: SampleId;
    format: FormatId;
    source: string;
    shiki: boolean;
    shikiReady: boolean;
    mention: boolean;
    htmlPaste: boolean;
    classPrefix: boolean;
    blockStates: boolean;
    dark: boolean;
    charsPerTick: number;
    tickMs: number;
    status: StreamStatus;
    /** Length of the text being streamed (the source when the stream started). */
    streamTotal: number;
    inspector: InspectorTab;
    lastLink: string;
}

/** One parse of the streamed text by the Lab's own engine. */
export interface Parsed {
    root: Root;
    /** How long `engine.parse` took for this tick. */
    ms: number;
    /** `engine.inspect()`: the cut offset and the number of finalized top-level blocks. */
    cut: number;
    finalized: number;
    /** Whether the format has an incremental engine (a re-parse engine finalizes nothing). */
    incremental: boolean;
}

export interface Lab {
    state: LabState;
    format(): DocumentFormat;
    /** Plugins for the view, the engine and the serializers. */
    plugins(): readonly RichTextPlugin[];
    /** The view's slot overrides: the mention chip, and Shiki's code block once loaded. */
    components(): Partial<DomComponents>;
    classPrefix(): string | undefined;
    /** The text streamed so far. */
    streamed(): string;
    parsed(): Parsed;
    /** The whole source, parsed. */
    full(): Root;
    toggleStream(): void;
    restartStream(): void;
    pickSample(id: SampleId): void;
    pickFormat(id: FormatId): void;
    setTab(id: TabId): void;
    toggleShiki(): void;
    toggleDark(): void;
    setTickMs(ms: number): void;
    onLink(url: string): void;
}

/** A top-level block's key: the engine's, or the positional one the render engine would use. */
export function blockKey(node: object, index: number): string {
    return (node as { key?: string }).key ?? topKey(index);
}

/** The index a top-level key (`b-<i>`) stands for, or -1. */
export function blockIndex(key: string | undefined): number {
    const m = key ? /^b-(\d+)$/.exec(key) : null;
    return m ? Number(m[1]) : -1;
}
