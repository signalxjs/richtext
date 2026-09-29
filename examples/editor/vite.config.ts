/**
 * A plain client-side SignalX app, like the Lab next door. `sigx()` keeps
 * `@sigx/reactivity` a single module instance (it aliases every installed
 * `@sigx/*` package and its `exports` subpaths to one built copy — the
 * richtext packages resolve to their `dist/`, so run `pnpm build` at the repo
 * root first).
 */
import { defineConfig } from 'vite';
import sigx from '@sigx/vite';

export default defineConfig({
    // JSX compiles to sigx's runtime, not React's (see examples/playground/vite.config.ts).
    oxc: { jsx: { runtime: 'automatic', importSource: 'sigx' } },
    plugins: [sigx()],
    // One port above the Lab, so both run side by side and link to each other.
    server: { port: 5174 },
    // The Playwright suite (`playwright.config.ts`) serves the built app here.
    preview: { port: 4174, strictPort: true }
});
