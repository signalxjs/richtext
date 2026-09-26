/**
 * Every command by name — the generic core plus the standard vocabulary —
 * for keymaps, toolbars and plugins, and the one place both modules are
 * re-exported from.
 */

import type { Command } from './commands.js';
import * as core from './commands.js';
import * as standard from './commands-standard.js';

export * from './commands.js';
export * from './commands-standard.js';

/** All commands by name, for keymaps and plugins. */
export const commands = {
    insertHardBreak: core.insertHardBreak,
    splitBlock: standard.splitBlock,
    splitTextBlock: core.splitTextBlock,
    splitListItem: standard.splitListItem,
    joinBackward: standard.joinBackward,
    joinTextBackward: core.joinTextBackward,
    joinBackwardInList: standard.joinBackwardInList,
    joinForward: core.joinForward,
    indentListItem: standard.indentListItem,
    outdentListItem: standard.outdentListItem,
    toggleStrong: standard.toggleStrong,
    toggleEmphasis: standard.toggleEmphasis,
    toggleDelete: standard.toggleDelete,
    toggleInlineCode: standard.toggleInlineCode,
    unsetLink: standard.unsetLink,
    setParagraph: standard.setParagraph,
    setHeading1: standard.setHeading(1),
    setHeading2: standard.setHeading(2),
    setHeading3: standard.setHeading(3),
    setHeading4: standard.setHeading(4),
    setHeading5: standard.setHeading(5),
    setHeading6: standard.setHeading(6),
    setCodeBlock: standard.setCodeBlock,
    toggleBulletList: standard.toggleBulletList,
    toggleOrderedList: standard.toggleOrderedList,
    toggleTaskList: standard.toggleTaskList,
    toggleTaskChecked: standard.toggleTaskChecked(),
    wrapInBlockquote: standard.wrapInBlockquote,
    liftOutOfBlockquote: standard.liftOutOfBlockquote,
    liftOutOfBlockquoteAtStart: standard.liftOutOfBlockquoteAtStart,
    liftOutOfBlockquoteAtEnd: standard.liftOutOfBlockquoteAtEnd,
    insertThematicBreak: standard.insertThematicBreak,
    addRowAfter: standard.addRowAfter,
    addRowBefore: standard.addRowBefore,
    deleteRow: standard.deleteRow,
    addColumnAfter: standard.addColumnAfter,
    addColumnBefore: standard.addColumnBefore,
    deleteColumn: standard.deleteColumn,
    deleteRange: core.deleteRange,
    cutSelection: core.cutSelection,
    deleteBlock: core.deleteBlock,
    duplicateBlock: core.duplicateBlock,
    moveBlockUp: core.moveBlockUp,
    moveBlockDown: core.moveBlockDown,
    exitCode: core.exitCode,
    escapeToBlockSelection: core.escapeToBlockSelection,
    escapeToText: core.escapeToText,
    extendBlockSelectionUp: core.extendBlockSelection('up'),
    extendBlockSelectionDown: core.extendBlockSelection('down'),
    extendSelectionUp: core.extendSelectionToNeighbour('up'),
    extendSelectionDown: core.extendSelectionToNeighbour('down'),
    selectAll: core.selectAll,
    focusUp: core.focusNeighbour('up'),
    focusDown: core.focusNeighbour('down'),
    focusStart: core.focusStart,
    focusEnd: core.focusEnd,
    clear: core.clear,
} satisfies Record<string, Command>;

export type CommandName = keyof typeof commands;
