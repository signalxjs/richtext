/**
 * Shipped code is `node:`-free by contract: it runs in the browser, inside a
 * Lynx app, in the terminal runtime and on edge runtimes (workerd, Vercel
 * edge). This guard scans every source file for Node-only APIs.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
    }
    return out;
}

const FORBIDDEN: [RegExp, string][] = [
    [/from\s+['"]node:/, 'node: import'],
    [/require\(/, 'require()'],
    [/\bBuffer\b/, 'Buffer'],
    [/\bprocess\.(?!env\.NODE_ENV)/, 'process.*'],
    [/__dirname|__filename/, '__dirname / __filename'],
];

describe('shipped source is node:-free', () => {
    for (const file of walk(SRC)) {
        it(file.slice(SRC.length + 1).replace(/\\/g, '/'), () => {
            const text = readFileSync(file, 'utf8');
            for (const [re, label] of FORBIDDEN) {
                expect(re.test(text), `${label} found in ${file}`).toBe(false);
            }
        });
    }
});
