# Handoff: Add tests and linting to YAGI

This is a self-contained implementation plan. Execute it phase by phase, in order. Decisions in the "Decisions" section are final — do not re-open them. Read CLAUDE.md first; this plan extends its verification gates.

## Context you must internalize first

YAGI is a VS Code extension with **two compilation worlds** that share one repo:

- `src/` — extension host code. CommonJS, Node, compiled by root `tsconfig.json` to `out/`. Imports `vscode` (only available inside the extension host — it does **not** exist as an npm module at test time).
- `webview/` — React 19 UI. ESM/browser, typechecked by `webview/tsconfig.json` (`noEmit`, `jsx: react-jsx`, `moduleResolution: Bundler`), bundled by `esbuild.js` into `media/webview.js`. esbuild does **not** typecheck.
- Shared types live in `src/types.ts`, which the webview tsconfig explicitly includes. Both tsconfigs compile it independently.
- There are currently **no tests, no linter, no CI**. CLAUDE.md documents the verification gates; you will be extending them.
- Dev environment is Windows (Node 24, git 2.49). Never assume `/` path separators in host-side code or tests.
- The working tree may have uncommitted changes (at plan time: `media/style.css`, `src/gitService.ts`, `src/yagiPanel.ts`, `webview/App.tsx`, `webview/components/Changes.tsx`, `webview/messages.ts`). Do not revert or clobber them; build your work on top of the current tree.

## Decisions (made — do not re-open)

1. **Test runner: Vitest** (single runner for both worlds via two projects in one config). Reasons: native TS/ESM, no ts-jest friction, `environment: "node"` for host tests and `environment: "jsdom"` for webview tests, trivial `vscode` module aliasing.
2. **Linter: ESLint 9 flat config** with `typescript-eslint` (type-aware, one project service covering both tsconfigs) plus `eslint-plugin-react-hooks` for `webview/`. No Prettier for now — formatting churn on a dirty working tree isn't worth it; add it later as a separate task if asked.
3. **No `@vscode/test-electron` integration tests in this pass.** They're slow, flaky on CI, and the highest-value logic (git output parsing, graph lane assignment) is testable as pure functions. Listed as an optional follow-up only.
4. **Strategy for testing `GitService`: extract the parsers, don't mock `spawn`.** The parsing logic (log records split on `\x1e`/`\x1f`, porcelain-v1 `-z` status including rename source-path consumption, branch parsing, etc.) currently lives inline in async methods. Extract each parser into a pure exported function in a new `src/gitParsing.ts` (string in → typed objects out), and have `GitService` methods call them. This is a behavior-preserving refactor that makes the highest-risk code directly testable with fixture strings.

## Phase 0 — Baseline

1. Run `npm run compile` and `npm run check:webview`. Both must exit 0 **before** you change anything, so you can distinguish pre-existing breakage (there may be uncommitted edits in the tree) from breakage you introduce. If either fails at baseline, stop and report; do not "fix" code you weren't asked to touch.

## Phase 1 — ESLint

1. Install dev deps: `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `globals`.
2. Create `eslint.config.mjs` at the repo root (flat config):
   - Global ignores: `out/`, `media/`, `node_modules/`, `*.vsix`, `esbuild.js` (plain JS build script — or lint it with the non-type-aware JS config if cheap).
   - Block for `src/**/*.ts`: `tseslint.configs.recommendedTypeChecked`, `languageOptions.parserOptions.projectService: true`, `globals.node`.
   - Block for `webview/**/*.{ts,tsx}`: same type-checked base plus `react-hooks` recommended rules, `globals.browser`.
   - Start from `recommendedTypeChecked`, not `strictTypeChecked`. The goal is a passing gate, not a style war.
3. Add script: `"lint": "eslint src webview"`.
4. Run it. Expect a wave of findings (`no-floating-promises` is the likely big one — the codebase fires off async git ops from event handlers). Triage rule:
   - Fix mechanically safe findings (unused imports/vars; `no-floating-promises` fixed with `void ` where fire-and-forget is intentional).
   - Do **not** restructure logic to satisfy a rule. If a rule produces widespread findings that would require behavioral changes, disable that rule in the config with a one-line comment saying why, and note it in your final report.
   - The gate is: `npm run lint` exits 0 at the end of this phase.

## Phase 2 — Vitest infrastructure

1. Install dev deps: `vitest`, `jsdom`, `@testing-library/react`. `@vitejs/plugin-react` is **not** needed — Vitest handles TSX via esbuild natively; verify a trivial TSX test renders before writing real ones.
2. Create `vitest.config.ts` at the root defining two projects:
   - **`host`**: include `src/**/*.test.ts`, `environment: "node"`. If a test target transitively imports `vscode`, add a resolve alias mapping `vscode` → `src/test/vscode-stub.ts` (a minimal stub exporting only the names actually needed). Prefer testing modules that never import `vscode` (that's most of the parsing surface after Phase 3) so the stub stays tiny or is unnecessary.
   - **`webview`**: include `webview/**/*.test.{ts,tsx}`, `environment: "jsdom"`.
3. Keep test files colocated (`foo.test.ts` next to `foo.ts`).
4. **Do not use vitest globals.** Import `describe/it/expect/vi` from `vitest` explicitly in every test file. This keeps both tsconfigs typechecking test files with zero type-injection config.
5. **Exclude tests from the production builds** — the step most likely to be forgotten:
   - Root `tsconfig.json`: add `"**/*.test.ts"` and `"src/test/**"` to `exclude` so `npm run compile` doesn't emit tests into `out/`.
   - `.vscodeignore` exists at the repo root — read it and extend it so test files and the new config files stay out of the `.vsix` (see Phase 5).
6. Add scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.
7. Write one trivial test per project (e.g., assert `assignLanes([])` returns an empty layout) and confirm `npm run test` passes **and** `npm run compile` + `npm run check:webview` still exit 0.

## Phase 3 — Extract and test the git parsers (highest value)

1. Re-read `src/gitService.ts` in full before extracting — it has recent uncommitted modifications; do not work from stale assumptions.
2. Create `src/gitParsing.ts`. Move the pure parsing logic out of `src/gitService.ts` into exported functions, each taking raw git stdout and returning the existing types from `src/types.ts`:
   - `parseLog(out: string): Commit[]` — the `\x1e`-record / `\x1f`-field splitting, parent list, `HEAD -> ` ref stripping.
   - `parseStatus(out: string): FileChange[]` — porcelain v1 `-z`, including the rename/copy case where the entry consumes the **next** NUL token as the source path.
   - Same treatment for the remaining parsers in `gitService.ts` (branches, commit details/file lists, operation/state detection — read the whole file and extract every `out.split(...)`-style block).
   - `GitService` methods become thin: `run(...)` then delegate to the parser. **No behavior change** — this is a mechanical extraction.
3. Write `src/gitParsing.test.ts` with fixture strings (build them with the real `\x1f`/`\x1e`/`\0` separators via template constants, not literal escapes sprinkled everywhere). Cover at minimum:
   - Log: linear history; merge commit (two parents); commit with refs including `HEAD -> main`, tags, remote branches; subject containing commas and quotes; empty output.
   - Status: modified, added, untracked (`??`), deleted; **renamed file (the `R` two-token case) — this is the subtle one**; filename containing spaces; empty output.
   - Branch parsing: local + remote, detached HEAD if the current parser handles it.
   - Any operation-state detection (merge/rebase in progress): if it reads `.git` files via `fs`, extract the *decision* logic (paths-present → Operation) into a pure function and test that; don't test `fs` itself.

## Phase 4 — Webview logic tests

1. `webview/graph.test.ts` for `assignLanes` (pure, zero dependencies — ideal):
   - Empty input; linear chain stays in lane 0; a branch commit opens lane 1; a merge commit's second parent gets its own lane; a lane is freed and reused after a branch tip is placed; `rowByHash` and `maxCol` correctness on a small diamond (branch + merge) history.
2. One or two `@testing-library/react` component tests to prove the jsdom project works end-to-end — pick low-dependency components: `ContextMenu.tsx` (renders items, fires callback on click) and/or `OpBanner.tsx`. Check how `webview/vscodeApi.ts` acquires the VS Code API and stub it via `vi.mock` where needed. Do **not** attempt to test `App.tsx`'s full postMessage lifecycle in this pass.
3. `webview/useResizableLayout.ts` is testable with `renderHook` if time permits — optional; note it as follow-up if skipped.

## Phase 5 — Wire into the project's contract

1. `package.json` scripts final state: `lint`, `test`, `test:watch`, plus `"check": "npm run compile && npm run check:webview && npm run lint && npm run test"` as the one-command full gate.
2. Update **CLAUDE.md**: extend the "Verification gates" section to four steps (compile, check:webview, lint, test) and update the "Commands" list. Keep its existing tone and rules intact.
3. Update `.vscodeignore`: ensure `**/*.test.*`, `vitest.config.ts`, `eslint.config.mjs`, `src/test/**` are excluded, then run `npx vsce ls` to confirm the package file list contains no test artifacts. `yagi-0.1.0.vsix` already sits in the repo root — leave it alone; delete any `.vsix` you generate yourself.
4. **CI (GitHub Actions)** — the repo's remote is `github.com/knoppies999/yagi`. Add `.github/workflows/ci.yml`: on push/PR to `main`, `ubuntu-latest`, Node 20, `npm ci`, then run `compile`, `check:webview`, `lint`, `test` as separate steps (separate steps = readable failures). Linux CI also catches Windows-path assumptions in reverse.

## Final verification (all must show actual exit-0 output — pasted, not claimed)

1. `npm run compile`
2. `npm run check:webview`
3. `npm run lint`
4. `npm run test`
5. Because Phase 3 refactored `gitService.ts` (runtime behavior surface): manual smoke test per CLAUDE.md — F5 → "YAGI: Open Git Interface" → confirm the commit graph renders, the Changes view shows the repo's dirty files correctly (including at least one rename if you can stage one), and a commit's details open. Typechecking proves nothing about the parser extraction being wired correctly.

## Known traps, restated

- esbuild does not typecheck the webview; only `check:webview` does. Editing anything under `webview/` or `src/types.ts` requires both gates.
- The `vscode` module cannot be imported in tests. Keep test targets pure; the stub is a last resort.
- Import vitest APIs explicitly — no globals, so neither tsconfig needs vitest type injection.
- Root tsconfig must `exclude` test files or they'll be emitted into `out/` and shipped.
- Windows: use `path.join` in any test fixtures touching filesystem paths; git output itself uses `/` even on Windows — don't "normalize" fixture paths that came from git.

## Out of scope (do not do these)

- Prettier / formatting changes.
- `@vscode/test-electron` integration tests.
- Restructuring app logic beyond the mechanical parser extraction in Phase 3.
