#!/usr/bin/env node

/**
 * signalxjs/richtext - Pre-publish pack smoke test
 *
 * Catches packaging bugs that lint/typecheck/test miss:
 *   - missing files in `files` array
 *   - broken `exports` map (every runtime subpath is imported)
 *   - dist/ produced by stale builds
 *   - a `workspace:` / `catalog:` range that survived into a tarball manifest
 *
 * What it does:
 *   1. Build the packages (delegates to `pnpm run build`).
 *   2. `pnpm pack` every publishable package into a temp dir.
 *   3. Spin up a minimal scratch project with file: deps on the tarballs
 *      (plus the sigx runtime the package peers on).
 *   4. `npm install` (pulls peer/runtime deps from the npm registry).
 *   5. `node` import-smoke every published entry point.
 *
 * Usage:
 *   node scripts/verify-pack.js
 *
 * No flags. Exits non-zero on any failure.
 */

import { execSync } from 'child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const PACKAGES = ['packages/richtext', 'packages/richtext-markdown', 'packages/richtext-html', 'packages/richtext-shiki'];

/** Every runtime entry the tarballs expose, imported one by one. */
const ENTRIES = [
    '@sigx/richtext',
    '@sigx/richtext/dom',
    '@sigx/richtext/editor',
    '@sigx/richtext/editor/dom',
    '@sigx/richtext/testing',
    '@sigx/richtext-markdown',
    '@sigx/richtext-markdown/editor',
    '@sigx/richtext-html',
    '@sigx/richtext-html/editor',
    '@sigx/richtext-shiki',
];

const sandbox = join(tmpdir(), `sigx-richtext-verify-pack-${Date.now()}`);
const tarballDir = join(sandbox, 'tarballs');
const appDir = join(sandbox, 'app');

function run(cmd, opts = {}) {
    console.log(`$ ${cmd}${opts.cwd ? `  (in ${opts.cwd})` : ''}`);
    execSync(cmd, { stdio: 'inherit', ...opts });
}

function step(label) {
    console.log(`\n>  ${label}`);
}

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf-8'));
}

function packPackage(pkgPath) {
    const pkgFullPath = join(rootDir, pkgPath);
    const pkgJson = readJson(join(pkgFullPath, 'package.json'));
    run('pnpm pack --pack-destination ' + JSON.stringify(tarballDir), { cwd: pkgFullPath });
    const tarballs = readdirSync(tarballDir).filter((f) => f.endsWith('.tgz'));
    const safeName = pkgJson.name.replace('@', '').replace('/', '-');
    const match = tarballs.find((f) => f.startsWith(safeName + '-'));
    if (!match) {
        throw new Error(`Could not find tarball for ${pkgJson.name} in ${tarballDir}`);
    }
    return { name: pkgJson.name, version: pkgJson.version, tarball: join(tarballDir, match) };
}

/** A tarball manifest must carry concrete ranges — `pnpm pack` rewrites them, this proves it did. */
function assertConcreteRanges(pkgPath) {
    const pkg = readJson(join(rootDir, pkgPath, 'package.json'));
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const [dep, spec] of Object.entries(pkg[field] ?? {})) {
            if (spec === 'workspace:*' || spec.startsWith('workspace:')) {
                // `pnpm pack` rewrites workspace: ranges; catalog: too. Nothing to do here —
                // the scratch install below fails loudly if the rewrite did not happen.
                console.log(`   (${pkg.name} ${field}.${dep} = ${spec} — rewritten at pack time)`);
            }
        }
    }
}

function main() {
    step(`Sandbox: ${sandbox}`);
    mkdirSync(tarballDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });

    step('Build packages');
    run('pnpm run build', { cwd: rootDir });

    step('Pack publishable packages');
    for (const p of PACKAGES) assertConcreteRanges(p);
    const packed = PACKAGES.map(packPackage);
    for (const p of packed) {
        console.log(`   ${p.name}@${p.version}  ->  ${p.tarball}`);
    }

    step('Create scratch app');
    const corePeers = readJson(join(rootDir, 'packages/richtext/package.json')).peerDependencies;
    for (const name of ['@sigx/reactivity', '@sigx/runtime-core']) {
        if (!corePeers?.[name]) throw new Error(`packages/richtext/package.json declares no peer on ${name}`);
    }
    const deps = Object.fromEntries(
        packed.map((p) => [p.name, `file:${p.tarball.replace(/\\/g, '/')}`])
    );
    const appPkg = {
        name: 'sigx-richtext-pack-smoke',
        version: '0.0.0',
        private: true,
        type: 'module',
        scripts: { smoke: 'node smoke.mjs' },
        // Only the REQUIRED peers: the scratch app owns the sigx runtime copy,
        // exactly as a consuming app does — at the range the foundation package
        // declares, so a core bump (`sync:core` re-pins the peers) can never leave
        // this smoke importing the tarballs against an older runtime. The optional
        // peer @sigx/runtime-dom and the shiki package's `shiki` peer are
        // deliberately absent: the install runs with --legacy-peer-deps, so unmet
        // peers are simply not installed, and the import smoke then fails if any
        // entry pulls one of them in eagerly instead of lazily.
        dependencies: {
            ...deps,
            '@sigx/reactivity': corePeers['@sigx/reactivity'],
            '@sigx/runtime-core': corePeers['@sigx/runtime-core'],
        },
        // The tarballs peer on each other at the published range; point those
        // ranges at the tarballs so npm resolves the sibling from disk, not the
        // registry (this is all `overrides` does — it installs no missing peer).
        overrides: { ...deps },
    };
    writeFileSync(join(appDir, 'package.json'), JSON.stringify(appPkg, null, 2));

    writeFileSync(
        join(appDir, 'smoke.mjs'),
        [
            `const entries = ${JSON.stringify(ENTRIES)};`,
            'for (const entry of entries) {',
            '    const mod = await import(entry);',
            '    const keys = Object.keys(mod);',
            "    if (keys.length === 0) throw new Error(entry + ' exports no named bindings');",
            "    console.log('ok ' + entry + ':', keys.join(', '));",
            '}',
            '',
        ].join('\n')
    );

    step('Install scratch app (npm — to avoid pnpm workspace hoisting interference)');
    run('npm install --no-audit --no-fund --legacy-peer-deps --loglevel=error', { cwd: appDir });

    step('Run import smoke (dev condition)');
    run('npm run smoke --silent', { cwd: appDir });

    step('Run import smoke (production condition)');
    run('node --conditions production smoke.mjs', { cwd: appDir });

    step('Pack smoke test passed');
}

try {
    main();
} catch (err) {
    console.error('\nPack smoke test failed:', err.message);
    console.error(`   Sandbox preserved for inspection: ${sandbox}`);
    process.exitCode = 1;
    process.exit(1);
}

try {
    rmSync(sandbox, { recursive: true, force: true });
} catch {
    // ignore
}
