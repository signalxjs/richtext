/**
 * Key names — the platform-neutral spelling a keymap is written in.
 *
 * A name is `[Mod-][Ctrl-|Meta-][Alt-][Shift-]Key`: `Mod` is Meta on a mac
 * and Ctrl elsewhere (the *other* one is spelled literally), `Key` is
 * `KeyboardEvent.key` with `' '` spelled `Space` and single letters
 * lower-cased. `Shift` is dropped for printable non-letter characters —
 * the character already carries it (`Shift-*` is just `*`) — and kept for
 * named keys (`Shift-Enter`) and letters (`Mod-Shift-z`).
 *
 * The view builds the name with `keyName()` from a real event; a keymap is
 * normalised with `normalizeKeyName()` so `shift-mod-Z` and `Mod-Shift-z`
 * bind the same key.
 */

export type KeyName = string;

export interface KeyEventLike {
    key: string;
    /** `KeyboardEvent.code` (`Digit7`, `KeyS`, `Period`, …); lets `keyNames()` recover the base key under Shift/Alt. */
    code?: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
}

export interface KeyPlatform {
    isMac: boolean;
}

const NAMED_KEYS: Record<string, string> = {
    enter: 'Enter',
    tab: 'Tab',
    escape: 'Escape',
    esc: 'Escape',
    backspace: 'Backspace',
    delete: 'Delete',
    del: 'Delete',
    space: 'Space',
    arrowup: 'ArrowUp',
    up: 'ArrowUp',
    arrowdown: 'ArrowDown',
    down: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    left: 'ArrowLeft',
    arrowright: 'ArrowRight',
    right: 'ArrowRight',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    insert: 'Insert',
};

/** Base characters for the `KeyboardEvent.code` values whose `key` changes under Shift/Alt. */
const CODE_KEYS: Record<string, string> = {
    Period: '.',
    Comma: ',',
    Slash: '/',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
};

function isLetter(ch: string): boolean {
    return ch.toLowerCase() !== ch.toUpperCase();
}

/** Canonical spelling of a key: `Space`, lower-cased letters, `ArrowUp`-style named keys. */
export function canonicalKey(key: string): string {
    if (key === ' ') return 'Space';
    if (key.length === 1) return isLetter(key) ? key.toLowerCase() : key;
    const named = NAMED_KEYS[key.toLowerCase()];
    if (named) return named;
    return key.length ? key[0].toUpperCase() + key.slice(1) : key;
}

function baseKeyOfCode(code: string | undefined): string | undefined {
    if (!code) return undefined;
    if (code.length === 6 && code.startsWith('Digit')) return code[5];
    if (code.length === 4 && code.startsWith('Key')) return code[3].toLowerCase();
    return CODE_KEYS[code];
}

function join(e: KeyEventLike, platform: KeyPlatform, key: string, shift: boolean): KeyName {
    const parts: string[] = [];
    const mod = platform.isMac ? e.metaKey : e.ctrlKey;
    const other = platform.isMac ? e.ctrlKey : e.metaKey;
    if (mod) parts.push('Mod');
    if (other) parts.push(platform.isMac ? 'Ctrl' : 'Meta');
    if (e.altKey) parts.push('Alt');
    if (shift) parts.push('Shift');
    parts.push(key);
    return parts.join('-');
}

/** The key name of an event. */
export function keyName(e: KeyEventLike, platform: KeyPlatform): KeyName {
    const key = canonicalKey(e.key);
    // A printable non-letter character already reflects Shift (`*`, `&`, `>`).
    const shifted = e.key.length === 1 && e.key !== ' ' && !isLetter(e.key);
    return join(e, platform, key, !!e.shiftKey && !shifted);
}

/**
 * Every name an event can answer to, most specific first: the `key`-based
 * name, then — when Shift or Alt changed the character and `code` is known —
 * the name built from the physical key (`Mod-Shift-7` for `Mod-&`,
 * `Mod-Alt-1` for the mac's `Mod-Alt-¡`). A keymap lookup tries them in order.
 */
export function keyNames(e: KeyEventLike, platform: KeyPlatform): KeyName[] {
    const names = [keyName(e, platform)];
    if (e.shiftKey || e.altKey) {
        const base = baseKeyOfCode(e.code);
        if (base !== undefined && base !== canonicalKey(e.key)) {
            const alt = join(e, platform, base, !!e.shiftKey);
            if (!names.includes(alt)) names.push(alt);
        }
    }
    return names;
}

const MODIFIER_ALIASES: Record<string, 'Mod' | 'Ctrl' | 'Meta' | 'Alt' | 'Shift'> = {
    mod: 'Mod',
    ctrl: 'Ctrl',
    control: 'Ctrl',
    meta: 'Meta',
    cmd: 'Meta',
    command: 'Meta',
    alt: 'Alt',
    option: 'Alt',
    shift: 'Shift',
};

const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'] as const;

/** Canonical order and casing: `shift-mod-Z` → `Mod-Shift-z`, `ctrl-space` → `Ctrl-Space`. */
export function normalizeKeyName(name: string): KeyName {
    let key: string;
    let modsText: string;
    if (name.endsWith('-')) {
        // The key itself is `-` (`-`, `Mod--`).
        key = '-';
        modsText = name.slice(0, -1);
    } else {
        const i = name.lastIndexOf('-');
        key = i >= 0 ? name.slice(i + 1) : name;
        modsText = i >= 0 ? name.slice(0, i + 1) : '';
    }
    const mods = new Set<string>();
    for (const part of modsText.split('-')) {
        if (!part) continue;
        const mod = MODIFIER_ALIASES[part.toLowerCase()];
        if (!mod) throw new Error(`Unknown modifier "${part}" in key name "${name}".`);
        mods.add(mod);
    }
    const parts: string[] = [];
    for (const mod of MODIFIER_ORDER) if (mods.has(mod)) parts.push(mod);
    parts.push(canonicalKey(key));
    return parts.join('-');
}

const MAC_SYMBOLS: Record<string, string> = { Mod: '⌘', Meta: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' };
const KEY_LABELS: Record<string, string> = {
    Enter: '↵',
    Escape: 'Esc',
    Backspace: '⌫',
    Delete: 'Del',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    PageUp: 'PgUp',
    PageDown: 'PgDn',
};

/**
 * The keys of a key name as a user reads them, one entry per key — a skin
 * renders each as a `<kbd>`. `Mod-Shift-z` is `['⌘', '⇧', 'Z']` on a mac
 * and `['Ctrl', 'Shift', 'Z']` elsewhere.
 */
export function formatKeyName(name: KeyName, platform: KeyPlatform): string[] {
    const parts = normalizeKeyName(name).split('-');
    // `Mod--` splits into a trailing pair of empties: the key is `-`.
    const key = name.endsWith('-') ? '-' : parts.pop()!;
    const mods = name.endsWith('-') ? parts.filter(Boolean) : parts;
    const out = mods.map((m) => (platform.isMac ? MAC_SYMBOLS[m] : m === 'Mod' ? 'Ctrl' : m) ?? m);
    out.push(KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key));
    return out;
}
