# SignalX richtext — shared agent guide

> ⚠️ **BRANCH FIRST — never work on `main`.** Before touching ANY file, create a
> worktree (`pnpm wt new <N-short-slug>`) and do everything from
> `<repo>/branches/<N-short-slug>`. This applies to every change, however small —
> editing or committing in the primary checkout (`<repo>/main`) causes conflicts
> for parallel sessions. Check yourself before every commit:
> `git branch --show-current` must print your worktree's branch name — if it
> prints `main` or nothing (detached HEAD), stop.
> Already edited files in `main` by mistake? Move the work, don't commit it:
> `git stash -u` → `pnpm wt new <N-short-slug>` →
> `cd <repo>/branches/<N-short-slug>` → `git stash pop`.

Canonical guidance for **any** AI agent working in this repo (Claude Code, GitHub
Copilot CLI, work agents, …). Tool-specific notes live in `CLAUDE.md`; it defers
here for everything shared — when it conflicts with this file, the tool-specific
file wins for that tool only.

This is the sigx standard agent setup. The same pattern (this file +
`scripts/worktree.mjs` + a thin tool-specific file) is used across sigx repos —
it originates in [`signalxjs/repo-template`](https://github.com/signalxjs/repo-template).
See "Adopting this setup in another sigx repo" at the bottom.

SignalX Richtext (`signalxjs/richtext`) is the home of `@sigx/richtext` — rich
text for SignalX: a schema-driven, mdast-shaped document model where a
`DocumentFormat` is a codec into and out of one tree, a generic incremental
engine that keeps finalized blocks stable while a source string grows (built
for token-by-token AI output), a save-friendly JSON document,
`createTextStream()`, a renderer-neutral render engine with a DOM view
(`./dom`), and a block-tree editor core (`./editor`) with a DOM editor
(`./editor/dom`) — plus the formats and plugins on top of it:
`@sigx/richtext-markdown` (the CommonMark + GFM parser and serializer,
`markdownFormat`, the markdown editor preset), `@sigx/richtext-html` (a
platform-free HTML parser and serializer, `htmlFormat`, the `text/html`
clipboard preset) and `@sigx/richtext-shiki` (Shiki highlighting as a
plugin). One plugin
contract feeds every format, every renderer and the editor. Consumed by
`@sigx/lynx-markdown` (native rendering and editing on Lynx), `@sigx/ai` chat
UI on the web and, later, a terminal renderer. A pnpm workspace (ESM,
`"type": "module"`) with the published packages under `packages/` and demos
under `examples/`. Tech stack: TypeScript (strict), Vite, Vitest (happy-dom),
oxlint. Published to npm under the `@sigx` scope.

## Development workflow (issue → PR → Copilot review → merge)

**This is mandatory for EVERY agent-driven change — including one-line fixes.
Never commit straight to `main`.** Repo: `signalxjs/richtext`, base branch `main`.
(Human contributors follow `CONTRIBUTING.md`, where an issue is optional; for
agents the issue-first flow below is required.)

1. **Issue first.** If no GitHub issue already tracks the work, create one *before*
   writing code and put the plan in it:
   ```sh
   gh issue create --title "<concise title>" --body "<what & why, plus the plan/checklist>"
   ```
   If you worked in plan mode, the approved plan **is** the issue body. Note the
   number it returns (`#N`).

2. **Worktree, always.** Never work on `main`. Use the worktree flow (below):
   `pnpm wt new <N-short-slug>` gives an isolated checkout on branch
   `<N-short-slug>`. Don't substitute `git switch -c` in the primary checkout —
   it occupies `<repo>/main`, which parallel sessions share.

3. **Implement & verify.** For a **bug fix, write a failing unit test that
   reproduces the bug *first*** (red), then make the fix so that test passes
   (green) — see "Test-first bug fixes" under Conventions. Either way, prove the
   change: `pnpm typecheck` (always, for any `.ts`) plus the relevant `pnpm test`
   / `pnpm build`. Stage specific files (`git add <path>`), never `git add -A`.
   No co-author trailers.

4. **Open a PR with Copilot as the reviewer.** Reference the issue so it auto-closes
   on merge:
   ```sh
   gh pr create --base main --title "<title>" \
     --body "Closes #N. <short summary of the change>" --reviewer @copilot
   ```
   The PR description becomes the squash commit **body** verbatim, and the PR
   title (with ` (#<pr>)` appended) becomes its subject — see step 6. Write the
   description as the commit body you want on `main`.
   (On an already-open PR: `gh pr edit <pr> --add-reviewer @copilot`.) The bot
   `copilot-pull-request-reviewer` posts its review within a minute or two. If your
   `gh` is too old to resolve `@copilot` (error: `'@copilot' not found`), request it
   via the API instead — don't skip it:
   ```sh
   gh api --method POST repos/signalxjs/richtext/pulls/<pr>/requested_reviewers \
     -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
   ```
   (The reviewer-request API takes the `[bot]`-suffixed slug; the review author
   login in `.reviews[].author.login` appears *without* the suffix.)

5. **Wait for Copilot's review, then fix.** Do not merge before it has reviewed. Poll
   until a review by the bot appears, then read it:
   ```sh
   gh pr view <pr> --json reviews -q '.reviews[].author.login'   # wait for "copilot-pull-request-reviewer"
   gh pr view <pr> --json reviews,comments
   ```
   Address every actionable comment with follow-up commits and push. If the review
   doesn't re-trigger on its own, re-request it: `gh pr edit <pr> --add-reviewer @copilot`.
   Repeat until Copilot has no remaining actionable feedback.

   **Then resolve the threads.** The sigx-standard ruleset sets
   `required_review_thread_resolution`, so a PR with an unresolved **inline**
   comment cannot merge, even with every check green. It silently never enters
   the merge queue, and `gh pr checks` shows nothing wrong. Resolve each thread
   you address. For one you deliberately decline, reply with the reason, then
   resolve it. Pushing the fix does not resolve a thread, and neither does
   replying at PR level. There is no `gh pr` porcelain — reply on each thread
   and resolve it over GraphQL:
   ```sh
   # list the open threads
   gh api graphql -f query='query { repository(owner:"signalxjs", name:"richtext") {
     pullRequest(number:<pr>) { reviewThreads(first:100) { nodes {
       id isResolved comments(first:1){nodes{body}} } } } } }' \
     -q '.data.repository.pullRequest.reviewThreads.nodes[]
         | select(.isResolved==false) | "\(.id) \(.comments.nodes[0].body[0:60])"'

   # reply (say which commit fixed it), then resolve — pass the body as a
   # GraphQL variable, not string-interpolated: quotes and backslashes in a
   # review reply otherwise break the query
   gh api graphql -f query='mutation($t:ID!,$b:String!){
     addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$t, body:$b}){ comment { id } } }' \
     -f t="<thread-id>" -f b="Fixed in <sha>. <what changed>"
   gh api graphql -f query='mutation($t:ID!){
     resolveReviewThread(input:{threadId:$t}){ thread { isResolved } } }' -f t="<thread-id>"
   ```

6. **Queue the merge yourself.** Once Copilot's feedback is resolved (threads
   included), the PR's checks are green, and, for user-facing changes, the
   docs issue is filed on the docs repo and linked from the PR (see
   "Documentation"), add the PR to `main`'s **merge queue**:
   ```sh
   pr=123                                     # your PR number (digits only)
   gh pr checks "$pr"                         # must be all green first
   gh pr merge "$pr" --squash --auto          # NOT --delete-branch: rejected
                                              # outright when a queue is enabled.
                                              # The queue deletes the branch itself.
   ```
   Check the non-required jobs too (e.g. `coverage`, `e2e`). The queue waits
   only on the required checks, so it merges without them.

   Then confirm the PR actually entered the queue. Armed auto-merge is not the
   same thing:
   ```sh
   gh api graphql -f query='query { repository(owner:"signalxjs", name:"richtext") {
     pullRequest(number:'"$pr"') {
       mergeStateStatus mergeQueueEntry { state position } } } }'
   ```
   `mergeQueueEntry: null` with `mergeStateStatus: BLOCKED` and every check
   green means something the checks don't show is blocking it. In practice that
   is an unresolved review thread (step 5). The PR just sits there until you
   clear it.

   How the queue works:
   - It tests queued PRs in groups against the latest `main` and squash-merges
     them in order. That is why the required checks are not strict: there is
     no "update branch" step, so don't rebase a PR just to make it current, and
     don't race `main` with a plain `gh pr merge`.
   - `ci.yml`'s `merge_group` trigger is what makes the checks run on the
     queue's ref. Never remove it, or queued PRs wait forever.
   - The squash commit takes the PR title plus ` (#<pr>)` as its subject and
     the PR description as its body (repo settings). Write both as the commit
     you want on `main`. Explicit `--subject`/`--body` does not apply to queue
     merges.
   - If the queue evicts a PR, there is a real conflict (usually a CHANGELOG
     `[Unreleased]` entry). Rebase on `main`, keep both sides, push, and
     enqueue again. Making the CHANGELOG entry the PR's last commit keeps that
     window small.
   - GitHub writes the queue's commit message itself, and it appends
     `Co-authored-by:` trailers when a branch commit's author differs from the
     merging account. So keep every commit on your branch authored by you.

   If you used a worktree, remove it once the PR has landed: `pnpm wt rm <name>`.

## Build, Test, Lint

```bash
pnpm install
pnpm build       # every package in dependency order (vite dev + prod dists, then tsc declarations)
pnpm test        # vitest run (unit tests across packages)
pnpm test <path>                   # single test file/dir (substring match)
pnpm test -t "name of test"        # single test by name (vitest -t)
                                   # NB: no `--` — vitest discards operands
                                   # after it, so `pnpm test -- x` silently
                                   # runs the WHOLE suite. pnpm forwards
                                   # args natively; the `--` is npm-only.
pnpm test:watch
pnpm test:coverage
pnpm typecheck   # tsgo (a fast TS compiler) over the packages and tests, config: tsconfig.json
pnpm lint        # oxlint over every package's src and tests
pnpm lint:fix
pnpm size        # size-limit bundle-size check (.size-limit.json)
pnpm verify:catalog # every core dep flows through the single-minor catalog
pnpm verify:pack    # pack the published packages and import every entry from a scratch app
```

Shipped code is `node:`-free and imports `@sigx/runtime-core` / `@sigx/runtime-dom`
/ `@sigx/reactivity` directly, never the `sigx` umbrella — the same modules run
on the web, inside a Lynx app (`@sigx/lynx` re-exports the same runtime) and in
the terminal. Tests and examples may use `sigx`.

To run an example: `pnpm build` first (it resolves the packages from `dist/`
through the workspace links), then `pnpm --filter <example-name> dev`.

## Packages

- `packages/richtext` → `@sigx/richtext` — the foundation. Entries: `.` (the
  mdast-shaped AST, the schema — `NodeSpec` as data, `createSchema`,
  `standardNodes` — the `DocumentFormat` contract, `createLineEngine` /
  `createReparseEngine`, `plainTextFormat`, `toJSON` / `fromJSON`,
  `createTextStream`, the schema-driven `renderDocument` engine, the
  `RichTextPlugin` contract and `mentionNode` — platform-free, runs
  everywhere), `./dom` (`RichTextView` on `@sigx/runtime-dom`, the
  `CodeHighlighter` contract), `./editor` (the block-tree editor core: state,
  steps, history, commands, keymap, input rules, the `InlineSurface` /
  `CodeSurface` contracts a platform implements), `./editor/dom`
  (`RichTextEditor` for the web) and `./testing` (streaming harness,
  `strip()`, fake surfaces, the surface conformance suite). Peers on the sigx
  runtime only — never on a third-party library: a contract lives here, its
  implementation is a `richtext-*` plugin package.
- `packages/richtext-markdown` → `@sigx/richtext-markdown` — markdown as a
  format. Entries: `.` (the CommonMark + GFM parser, `createIncrementalEngine`,
  `toMarkdown`, `markdownFormat`, `markdownNodes` / `markdownSchema`, the
  `MarkdownPluginSlice` contract plugins fill under `formats.markdown`,
  `mentionPlugin`) and `./editor` (`markdownPreset`). Peers on `@sigx/richtext`.
  Its CommonMark / GFM conformance suites render through
  `@sigx/richtext-html`'s `toHtml` (one HTML writer in the repo).
- `packages/richtext-html` → `@sigx/richtext-html` — HTML as a format.
  Entries: `.` (`parseHtml` — a hand-written tokenizer and tree with browser
  style structure repair, no `DOMParser` — `toHtml` with the CommonMark
  reference layout, `htmlFormat`, the `HtmlPluginSlice` contract plugins fill
  under `formats.html` — `elements` by tag, `serialize` by node type —
  `mentionHtml`) and `./editor` (`htmlPreset`, the `text/html` clipboard
  writer). Peers on `@sigx/richtext`; only `href` / `src` survive parsing,
  through the core's `sanitizeUrl`.
- `packages/richtext-shiki` → `@sigx/richtext-shiki` — `shikiPlugin()` /
  `createShikiHighlighter()` behind the core's `CodeHighlighter` contract; the
  only package that imports `shiki`. Peers on `@sigx/richtext` and `shiki`.

Entries land one PR at a time; an entry exists once it is in `exports`.
Formats never import each other, and the core never imports a format.

Path aliases: `tsconfig.json` and `vitest.config.ts` map every package (and
its subpaths) to `packages/<name>/src`, so tests and typecheck run against
source, not dist — a test may import a sibling package through the alias (a
core test builds fixtures with `@sigx/richtext-markdown`, the markdown
conformance suite renders with `@sigx/richtext-html`) without a
`devDependencies` edge, which would make the workspace graph cyclic. A new
entry is added to BOTH maps (subpaths before
the bare name — vitest matches aliases in order), to `exports` in
`package.json` and `entry` in `vite.config.ts`, to `.size-limit.json`, and to
`ENTRIES` in `scripts/verify-pack.js`. A new package is also added to
`PACKAGES` in `scripts/publish.js` (dependency order) and
`scripts/verify-pack.js`, to the playground's dependencies and `paths`, and
to the issue-template dropdowns; the root `build` / `lint` scripts glob
`packages/*`.

Source layout (`packages/richtext/src`):

- **One folder per concern; its `index.ts` is the folder's public surface.**
  `utils/`, `ast/` (the node types), `schema/` (`NodeSpec` / `Schema` — the
  one table that says what every node type is; `standardNodes`), `plugin/`
  (the contract), `document/` (`DocumentFormat`, the incremental engines,
  `plainTextFormat`, `toJSON` / `fromJSON`), `render/`, `stream/`, `plugins/`
  (the reference plugin nodes, e.g. mention), `dom/`, `editor/` (with
  `editor/dom/`), `testing/`. Cross-folder imports go through
  `../<folder>/index.js`; inside a folder, siblings import each other
  directly. A file a folder's `index.ts` does not re-export is private to
  that folder.
- **Imports point one way**:
  `utils ← ast ← schema ← plugin ← document ← render ← plugins`; `stream/`
  depends on `@sigx/reactivity` only; `dom` and `editor ← editor/dom` sit on
  top of the root layers (`editor/dom` may import `dom` — void blocks render
  through the DOM components — never the reverse); `testing/` is on top of
  everything and nothing imports from it. No cycles.
- **`packages/richtext-html/src`**: `tokenizer.ts ← tree.ts ← parse.ts`,
  `serialize.ts`, `plugin.ts` / `resolve.ts`, `format.ts`, `mention.ts`,
  `editor/` (the preset). Same rule: the core through its entries only.
- **`packages/richtext-markdown/src`** mirrors the shape: `parser/`,
  `serializer/`, `plugin/` (the markdown slice contract and its resolver),
  `format.ts`, `nodes.ts`, `definitions.ts`, `mention.ts`, `editor/` (the
  preset). It imports the core through the package entries (`@sigx/richtext`,
  `@sigx/richtext/editor`) only — never a core file path.
- **Every entry point is a folder** — `src/index.ts` for `.`,
  `src/<entry>/index.ts` for a subpath — and those files are re-exports
  only, never implementation. `tsc` mirrors the tree, so a subpath's
  `types` in `package.json` is `./dist/<entry>/index.d.ts` while its JS
  stays flat (`./dist/<entry>.js`, vite names bundles by entry).
- **Tests mirror `src/`**: `__tests__/<folder>/<file>.test.ts` covers
  `src/<folder>/<file>.ts`; shared fixtures stay in `__tests__/helpers.ts`
  and `__tests__/fixtures/`.

## Parallel work with git worktrees

To work two things at once — each with its own checkout and its own agent
session — use a worktree instead of switching branches in place:

```sh
pnpm wt new <name> [--from <branch>]   # worktree at <repo>/branches/<name>: own branch + deps installed
pnpm wt list                           # show all worktrees
pnpm wt rm <name> [--force]            # remove a worktree
```

Layout convention (all sigx repos): the primary checkout lives at `<repo>/main`
and every worktree at `<repo>/branches/<name>`. `pnpm wt new` creates the
checkout there on a new branch `<name>` and runs `pnpm install` (pnpm hardlinks
from the global store — fast). Launch a **separate agent session from the
worktree directory**; sessions stay independent per directory. Names: letters,
digits, `.`, `_`, `-` only.

## Documentation

Docs are part of the change, not a follow-up — in-repo docs ship in the same
PR, and the docs-site update is queued (as a docs-repo issue) before merge. Two
surfaces, two rules:

**In-repo docs — update in *this* PR when you touch the matching thing:**

| When you… | Update… |
|---|---|
| add / rename / remove a package | `AGENTS.md` "Packages" and the README package table — plus, **whichever of these the repo has**: `CONTRIBUTING.md` layout, the issue-template package dropdowns, `.size-limit.json`, and the `tsconfig` / `vitest` path aliases |
| change a build / test / lint script | `AGENTS.md` "Build, Test, Lint", `CONTRIBUTING.md` "Common tasks", `package.json` |
| change or add public API / behaviour | the package's own `README.md` and `CHANGELOG.md` under `[Unreleased]` |
| change the workflow / process itself | `AGENTS.md` here — and, since it is the shared standard, upstream the same change to [`signalxjs/repo-template`](https://github.com/signalxjs/repo-template) |

**The docs *site* is separate — don't edit it from here.** User-facing changes
(new or changed public API, features, packages) must end up documented on the
docs site [`signalxjs/signalxjs.github.io`](https://github.com/signalxjs/signalxjs.github.io),
but that work belongs to the **docs agent**, which works through the docs repo's
issue queue. Don't open docs-site PRs from source repos — your job is to feed
the queue, in two moments:

- **Before merging a PR with user-facing changes, file an issue on the docs
  repo** describing what changed and what the docs need to cover, and link it
  from the PR:
  ```sh
  gh issue create --repo signalxjs/signalxjs.github.io \
    --title "richtext: <what changed>" \
    --body "Source: signalxjs/richtext#<pr>. <What needs documenting, and where on the site.> Not yet released."
  ```
  A user-facing PR isn't mergeable until its docs issue exists (see step 6 of
  the workflow).
- **When you cut a release** (push a `vX.Y.Z` tag), comment the release tag on
  every open docs issue covering a change shipped in that release:
  ```sh
  gh issue comment <n> --repo signalxjs/signalxjs.github.io \
    --body "Released in richtext vX.Y.Z."
  ```
  (Mention the published package version(s) too if they differ from the tag.)
  A docs issue without a release comment means *merged but not released — don't
  document yet*; the release comment is the docs agent's signal that the change
  is live and ready to document.

## Conventions & working principles

- **Plan first for non-trivial work.** Both Claude Code and Copilot CLI have a built-in plan mode; use it and let the CLI manage the plan file.
- **Verify before declaring done.** Run typecheck/tests for code changes; show evidence the change works.
- **Test-first bug fixes.** Reproduce the bug with a *failing* unit test first (red), then make the fix so the test goes green — the failing test proves both that the bug exists and that the fix actually addresses it, and it stays behind as a regression test. Never fix a bug without a test that would have caught it. While you're in the area, if you find behaviour that should be covered but isn't, add the missing tests in the same PR.
- **Minimal, surgical edits.** Don't refactor unrelated code. Don't add backward-compat shims for things that never shipped.
- **Cross-platform paths**: Contributors and CI can run on Windows, macOS or Linux (check this repo's CI matrix for what it actually covers) — use the path separator and shell syntax of the environment you're in, and prefer Node scripts over shell one-liners for anything committed to the repo.
- **Git hygiene**: Stage specific files (`git add <path>`), never `git add -A` / `git add .`. Run `pnpm typecheck` before any commit touching `.ts`. Do **not** add co-author trailers to commits (e.g. `Co-Authored-By: Claude …` / `Co-authored-by: Copilot …`).

## Adopting this setup in another sigx repo

This file, `scripts/worktree.mjs`, and `CLAUDE.md` are the portable sigx
standard, maintained in [`signalxjs/repo-template`](https://github.com/signalxjs/repo-template).
To adopt it in another repo:

1. Check the repo out using the standard layout: primary checkout at
   `<repo>/main`, worktrees under `<repo>/branches/`.
2. Copy `scripts/worktree.mjs` and `CLAUDE.md` verbatim; copy this `AGENTS.md` as a template.
3. Add `"wt": "node scripts/worktree.mjs"` to the repo's `package.json` scripts.
4. Adapt the repo-specific sections of `AGENTS.md`: the intro (what the repo is),
   "Build, Test, Lint", and "Packages". Replace every `richtext` with the repo name.
5. Keep the workflow, worktree, and conventions sections as-is — they are the
   shared standard.
6. Lock down `main`: `node scripts/apply-branch-protection.mjs signalxjs/richtext`.
