import { describe, expect, it } from 'vitest';
import { canonicalKey, formatKeyName, keyName, keyNames, normalizeKeyName } from '../../src/editor/keys.js';

const mac = { isMac: true };
const pc = { isMac: false };

describe('keyName', () => {
    it('spells Mod as Meta on a mac and Ctrl elsewhere', () => {
        expect(keyName({ key: 'b', metaKey: true }, mac)).toBe('Mod-b');
        expect(keyName({ key: 'b', ctrlKey: true }, pc)).toBe('Mod-b');
        expect(keyName({ key: 'b', ctrlKey: true }, mac)).toBe('Ctrl-b');
        expect(keyName({ key: 'b', metaKey: true }, pc)).toBe('Meta-b');
    });

    it('orders modifiers Mod, Ctrl/Meta, Alt, Shift', () => {
        expect(keyName({ key: 'Z', metaKey: true, ctrlKey: true, altKey: true, shiftKey: true }, mac)).toBe('Mod-Ctrl-Alt-Shift-z');
        expect(keyName({ key: 'Z', metaKey: true, ctrlKey: true, altKey: true, shiftKey: true }, pc)).toBe('Mod-Meta-Alt-Shift-z');
    });

    it('lower-cases letters, spells Space, keeps named keys', () => {
        expect(keyName({ key: 'B' }, pc)).toBe('b');
        expect(keyName({ key: ' ' }, pc)).toBe('Space');
        expect(keyName({ key: ' ', ctrlKey: true }, pc)).toBe('Mod-Space');
        expect(keyName({ key: 'Enter' }, pc)).toBe('Enter');
        expect(keyName({ key: 'ArrowUp' }, pc)).toBe('ArrowUp');
        expect(keyName({ key: 'Backspace' }, pc)).toBe('Backspace');
        expect(keyName({ key: 'Tab' }, pc)).toBe('Tab');
        expect(keyName({ key: 'Escape' }, pc)).toBe('Escape');
    });

    it('keeps Shift for named keys and letters, drops it for shifted punctuation', () => {
        expect(keyName({ key: 'Enter', shiftKey: true }, pc)).toBe('Shift-Enter');
        expect(keyName({ key: 'Tab', shiftKey: true }, pc)).toBe('Shift-Tab');
        expect(keyName({ key: 'Z', shiftKey: true, ctrlKey: true }, pc)).toBe('Mod-Shift-z');
        expect(keyName({ key: '*', shiftKey: true }, pc)).toBe('*');
        expect(keyName({ key: '>', shiftKey: true, ctrlKey: true }, pc)).toBe('Mod->');
        expect(keyName({ key: ' ', shiftKey: true }, pc)).toBe('Shift-Space');
    });
});

describe('keyNames', () => {
    it('adds the physical-key spelling when Shift or Alt changed the character', () => {
        expect(keyNames({ key: '&', code: 'Digit7', shiftKey: true, ctrlKey: true }, pc)).toEqual(['Mod-&', 'Mod-Shift-7']);
        expect(keyNames({ key: '¡', code: 'Digit1', altKey: true, metaKey: true }, mac)).toEqual(['Mod-Alt-¡', 'Mod-Alt-1']);
        expect(keyNames({ key: 'ß', code: 'KeyS', altKey: true, metaKey: true }, mac)).toEqual(['Mod-Alt-ß', 'Mod-Alt-s']);
        expect(keyNames({ key: '>', code: 'Period', shiftKey: true, ctrlKey: true }, pc)).toEqual(['Mod->', 'Mod-Shift-.']);
    });

    it('is just the key name when nothing changed the character', () => {
        expect(keyNames({ key: 'b', code: 'KeyB', ctrlKey: true }, pc)).toEqual(['Mod-b']);
        expect(keyNames({ key: 'Z', code: 'KeyZ', shiftKey: true, ctrlKey: true }, pc)).toEqual(['Mod-Shift-z']);
        expect(keyNames({ key: '&', shiftKey: true }, pc)).toEqual(['&']);
    });
});

describe('normalizeKeyName', () => {
    it('canonicalises modifier order, aliases and key casing', () => {
        expect(normalizeKeyName('shift-mod-Z')).toBe('Mod-Shift-z');
        expect(normalizeKeyName('Mod-Shift-z')).toBe('Mod-Shift-z');
        expect(normalizeKeyName('alt-ctrl-cmd-mod-shift-enter')).toBe('Mod-Ctrl-Meta-Alt-Shift-Enter');
        expect(normalizeKeyName('control-space')).toBe('Ctrl-Space');
        expect(normalizeKeyName('option-1')).toBe('Alt-1');
        expect(normalizeKeyName('up')).toBe('ArrowUp');
        expect(normalizeKeyName('esc')).toBe('Escape');
        expect(normalizeKeyName('Mod-Shift-.')).toBe('Mod-Shift-.');
        expect(normalizeKeyName('Mod--')).toBe('Mod--');
        expect(normalizeKeyName('-')).toBe('-');
        expect(normalizeKeyName('f1')).toBe('F1');
    });

    it('agrees with keyName', () => {
        expect(normalizeKeyName('SHIFT-Enter')).toBe(keyName({ key: 'Enter', shiftKey: true }, pc));
        expect(normalizeKeyName('mod-b')).toBe(keyName({ key: 'B', metaKey: true }, mac));
    });

    it('rejects unknown modifiers', () => {
        expect(() => normalizeKeyName('Super-a')).toThrow(/Unknown modifier/);
    });

    it('canonicalKey', () => {
        expect(canonicalKey('A')).toBe('a');
        expect(canonicalKey('arrowdown')).toBe('ArrowDown');
        expect(canonicalKey('pageDown')).toBe('PageDown');
    });
});

describe('formatKeyName', () => {
    it('spells Mod as ⌘ on a mac and Ctrl elsewhere, one entry per key', () => {
        expect(formatKeyName('Mod-b', { isMac: true })).toEqual(['⌘', 'B']);
        expect(formatKeyName('Mod-b', { isMac: false })).toEqual(['Ctrl', 'B']);
        expect(formatKeyName('shift-mod-Z', { isMac: true })).toEqual(['⌘', '⇧', 'Z']);
        expect(formatKeyName('Mod-Shift-z', { isMac: false })).toEqual(['Ctrl', 'Shift', 'Z']);
        expect(formatKeyName('Mod-Alt-1', { isMac: true })).toEqual(['⌘', '⌥', '1']);
    });

    it('names special keys and keeps punctuation, including a trailing -', () => {
        expect(formatKeyName('Shift-Enter', { isMac: false })).toEqual(['Shift', '↵']);
        expect(formatKeyName('Mod-Shift-.', { isMac: false })).toEqual(['Ctrl', 'Shift', '.']);
        expect(formatKeyName('Mod--', { isMac: false })).toEqual(['Ctrl', '-']);
        expect(formatKeyName('Escape', { isMac: true })).toEqual(['Esc']);
    });
});
