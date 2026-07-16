# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

YAGI is a VS Code extension: a Fork-style Git GUI (commit graph, staging, rebase, remotes). Every Git action shells out to the `git` CLI. The verification gates below (typecheck, lint, test) are the safety net. Run them.

## Verification gates (run after every code change, in order)

1. `npm run compile` — typechecks the extension host (`src/` → `out/`) AND bundles the webview. Must exit 0.
2. `npm run check:webview` — typechecks `webview/` (esbuild in step 1 does NOT typecheck it; skipping this ships type errors silently). Must exit 0.
3. `npm run lint` — ESLint (type-aware) over `src` and `webview`. Must exit 0 (warnings are allowed; errors are not).
4. `npm run test` — Vitest, both projects (host + webview). Must exit 0.
5. Manual smoke test when behavior changed: F5 in VS Code ("Run YAGI Extension") → run "YAGI: Open Git Interface" → exercise the changed feature.

`npm run check` runs steps 1–4 in one go. A change is complete only when steps 1–4 all exit 0. If you edited `webview/` and only ran step 1, the task is NOT verified.

## Commands

- `npm run check` — the full gate: compile + check:webview + lint + test
- `npm run compile` — full build (host tsc + webview esbuild)
- `npm run compile:host` / `npm run compile:webview` — one half only
- `npm run check:webview` — typecheck webview (required; not part of `compile`)
- `npm run lint` — ESLint flat config (`eslint.config.mjs`), type-aware
- `npm run test` — Vitest once; `npm run test:watch` for watch mode
- `npm run watch` — esbuild watch for the webview only (does not watch `src/`)
- `npx vsce package` — build the .vsix

## Testing

- Vitest, two projects in `vitest.config.ts`: **host** (`environment: node`, `src/**/*.test.ts`) and **webview** (`environment: jsdom`, `webview/**/*.test.{ts,tsx}`). Tests are colocated (`foo.test.ts` next to `foo.ts`).
- Import vitest APIs explicitly (`import { describe, it, expect } from "vitest"`) — globals are off, so neither tsconfig needs vitest type injection.
- The `vscode` module can't be imported in a test (it only exists in the extension host). Keep test targets pure. Git-output parsing lives in `src/gitParsing.ts` (pure string→type functions, no `spawn`/`fs`); `GitService` delegates to it. New parsing logic goes there so it stays testable with fixture strings.
- Root `tsconfig.json` **excludes** `**/*.test.ts`/`src/test/**` so tests don't emit into `out/`. Test files are also excluded from lint (the excluded build tsconfig can't type them); Vitest validates them instead.

## Architecture (two compilation worlds, one message protocol)

- `src/` — extension host (CommonJS, Node, `tsconfig.json`). Entry: `extension.ts`.
- `webview/` — React UI (browser, `webview/tsconfig.json`), bundled by `esbuild.js` into `media/webview.js`. Never edit `media/webview.js` directly — it is build output.
- The two halves communicate only via `postMessage`. The full protocol is `OutMsg`/`InMsg` in `webview/messages.ts`. Adding a UI action = add an `OutMsg` variant there, send it from a component, handle it in `YagiPanel`'s message switch (`src/yagiPanel.ts`).
- Shared domain types live in `src/types.ts` (the webview tsconfig includes it). Put anything both worlds use there — do not duplicate types.
- `src/gitService.ts` — all git CLI invocation/parsing, using `\x1f`/`\x1e` field separators. New git functionality belongs here, not inline in panel/sidebar code.
- `src/activeRepo.ts` — single source of truth for which repo is shown. Panel (`yagiPanel.ts`) and sidebar (`sidebar.ts`) both resolve through it and refresh via `onActiveRepoChange`; never track the active repo elsewhere.
- Diffs/merges open in VS Code's native editors via `src/diffProvider.ts` (custom `yagi:` scheme) — don't render diffs in the webview.
- Mutating operations should honor `yagi.pullAfterOperations` by calling `autoPullIfEnabled` (`src/gitOps.ts`), like existing ones do.
- **Refresh strategy — optimize for responsiveness.** `yagiPanel.ts` has two refresh paths: `sendState()` (full snapshot — status, branches incl. remotes, operation, force-push, graph) and `sendGraph()` (graph-only). A full snapshot re-scans every local+remote ref (`git for-each-ref --sort=-committerdate`), which is slow on big repos, so use the lightweight `sendGraph()` for **view-only** changes that cannot alter repo state (e.g. branch-filter toggles). Anything that **changes repo state** — checkout, commit, stage, **fetch, pull**, push, rebase/merge/revert — must go through `sendState()` so branches, remotes, and ahead/behind counts all refresh. Never run the same expensive git query twice in one snapshot (e.g. pass an already-fetched branch list to `checkNeedsForcePush` instead of re-calling `getBranches`). Both paths share `stateGeneration` so a stale in-flight result never clobbers a newer one.
- New commands must be registered in BOTH `src/extension.ts` and the `contributes.commands` section of `package.json`.

## Operating Rules (behavioral gates — check these before writing code and before declaring done)

1. **Before writing code**: state which world(s) the change touches — `src/` (host), `webview/` (UI), or both. If both, the message protocol in `webview/messages.ts` almost certainly needs a new variant; check it first.
2. **Before writing code**: if adding a command, setting, or menu item, open `package.json` `contributes` — code-only registration will not appear in VS Code.
3. **Cross-boundary changes**: any edit to `src/types.ts` or `webview/messages.ts` requires BOTH verification gates 1 and 2, because each tsconfig compiles it independently.
4. **Before declaring done**: paste the actual exit-0 output of `npm run compile` and `npm run check:webview`. No output shown = not done. "It should compile" is not verification.
5. **Never claim runtime behavior works** (graph rendering, git operations, conflict flow) unless it was exercised in the Extension Development Host — typechecking alone proves nothing about `postMessage` wiring or git output parsing.
6. Windows dev environment: paths in `src/` must go through `path.join`/`path.sep`-safe code; never hardcode `/` when touching filesystem logic (`repoFinder.ts`, `gitService.ts`).
