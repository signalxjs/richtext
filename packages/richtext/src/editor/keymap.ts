/**
 * Keymaps — key names bound to commands. A binding is a `Command`, the name
 * of a registered command, or `'undo'` / `'redo'`, which live on the editor
 * instance rather than in the command registry and are handed back to the
 * editor by `runKeymap`.
 */

import type { Command, CommandContext, Dispatch } from './commands.js';
import { commands, type CommandName } from './registry.js';
import type { KeyName } from './keys.js';
import { normalizeKeyName } from './keys.js';
import type { EditorState } from './state.js';

export type { KeyName };

export type HistoryCommand = 'undo' | 'redo';
/** A command, the name of a built-in (or, in a plugin keymap, plugin) command, or `undo` / `redo`. */
export type KeymapBinding = Command | CommandName | HistoryCommand | (string & {});
export type Keymap = Record<KeyName, KeymapBinding>;
export type ResolvedKeymap = Map<KeyName, Command | HistoryCommand>;

/** The default bindings. Views layer their own maps on top (later maps win). */
export const baseKeymap: Keymap = {
    Enter: 'splitBlock',
    'Shift-Enter': 'insertHardBreak',
    'Mod-Enter': 'exitCode',
    Backspace: 'joinBackward',
    Delete: 'joinForward',
    Tab: 'indentOrNextCell',
    'Shift-Tab': 'outdentOrPrevCell',
    'Mod-b': 'toggleStrong',
    'Mod-i': 'toggleEmphasis',
    'Mod-e': 'toggleInlineCode',
    'Mod-Shift-x': 'toggleDelete',
    'Mod-z': 'undo',
    'Mod-Shift-z': 'redo',
    'Mod-y': 'redo',
    'Mod-Alt-0': 'setParagraph',
    'Mod-Alt-1': 'toggleHeading1',
    'Mod-Alt-2': 'toggleHeading2',
    'Mod-Alt-3': 'toggleHeading3',
    'Mod-Alt-4': 'toggleHeading4',
    'Mod-Alt-5': 'toggleHeading5',
    'Mod-Alt-6': 'toggleHeading6',
    'Mod-Shift-7': 'toggleOrderedList',
    'Mod-Shift-8': 'toggleBulletList',
    'Mod-Shift-9': 'toggleTaskList',
    'Mod-Shift-.': 'wrapInBlockquote',
    Escape: 'escapeToBlockSelection',
    'Mod-a': 'selectAll',
    ArrowUp: 'focusUp',
    ArrowDown: 'focusDown',
    'Shift-ArrowUp': 'extendBlockSelectionUp',
    'Shift-ArrowDown': 'extendBlockSelectionDown',
};

function resolveBinding(binding: KeymapBinding, registry: Readonly<Record<string, Command>>): Command | HistoryCommand {
    if (typeof binding === 'function') return binding;
    if (binding === 'undo' || binding === 'redo') return binding as HistoryCommand;
    const command = registry[binding];
    if (!command) throw new Error(`Unknown command "${binding}" in keymap.`);
    return command;
}

/**
 * Merge keymaps into one lookup table: names normalised, later maps override
 * earlier ones, command names resolved through `registry` (the built-in
 * commands by default; the editor passes built-ins plus plugin commands).
 */
export function resolveKeymap(maps: readonly Keymap[], registry: Readonly<Record<string, Command>> = commands): ResolvedKeymap {
    const out: ResolvedKeymap = new Map();
    for (const map of maps) {
        for (const [name, binding] of Object.entries(map)) out.set(normalizeKeyName(name), resolveBinding(binding, registry));
    }
    return out;
}

/**
 * Run the command bound to `name`: the command's own result, `false` when
 * nothing is bound, or `'undo'` / `'redo'` for the editor to handle.
 */
export function runKeymap(map: ResolvedKeymap, name: KeyName, state: EditorState, dispatch: Dispatch | undefined, ctx: CommandContext): boolean | HistoryCommand {
    const binding = map.get(normalizeKeyName(name));
    if (!binding) return false;
    if (typeof binding === 'string') return binding;
    return binding(state, dispatch, ctx);
}
