import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const __dirname = import.meta.dirname;

export default defineConfig({
    // `__DEV__` is the compile-time dev flag package sources guard on; the build
    // (vite.config.ts) replaces it in the dists, so tests must define it too.
    define: {
        __DEV__: 'true'
    },
    oxc: {
        jsx: {
            runtime: 'automatic',
            importSource: 'sigx'
        }
    },
    test: {
        environment: 'happy-dom',
        include: ['packages/**/__tests__/**/*.test.{ts,tsx}'],
        exclude: ['**/node_modules/**'],
        globals: true,
        typecheck: {
            enabled: true,
            include: ['packages/**/__tests__/**/*.test-d.ts']
        },
        coverage: {
            provider: 'v8',
            include: ['packages/*/src/**/*.{ts,tsx}'],
            exclude: ['**/*.d.ts', '**/index.ts']
        }
    },
    resolve: {
        // Subpaths before the bare name: vitest matches aliases in order and a
        // bare `@sigx/richtext` entry first would swallow `@sigx/richtext/dom`
        // (and `@sigx/richtext-markdown`, hence the anchored regexes).
        alias: [
            { find: '@sigx/richtext/dom', replacement: resolve(__dirname, 'packages/richtext/src/dom/index.ts') },
            { find: '@sigx/richtext/editor/dom', replacement: resolve(__dirname, 'packages/richtext/src/editor/dom/index.ts') },
            { find: '@sigx/richtext/editor', replacement: resolve(__dirname, 'packages/richtext/src/editor/index.ts') },
            { find: '@sigx/richtext/testing', replacement: resolve(__dirname, 'packages/richtext/src/testing/index.ts') },
            { find: '@sigx/richtext-markdown/editor', replacement: resolve(__dirname, 'packages/richtext-markdown/src/editor/index.ts') },
            { find: /^@sigx\/richtext-markdown$/, replacement: resolve(__dirname, 'packages/richtext-markdown/src/index.ts') },
            { find: '@sigx/richtext-html/editor', replacement: resolve(__dirname, 'packages/richtext-html/src/editor/index.ts') },
            { find: /^@sigx\/richtext-html$/, replacement: resolve(__dirname, 'packages/richtext-html/src/index.ts') },
            { find: /^@sigx\/richtext-zero$/, replacement: resolve(__dirname, 'packages/richtext-zero/src/index.ts') },
            { find: /^@sigx\/richtext-shiki$/, replacement: resolve(__dirname, 'packages/richtext-shiki/src/index.ts') },
            { find: /^@sigx\/richtext$/, replacement: resolve(__dirname, 'packages/richtext/src/index.ts') }
        ]
    }
});
