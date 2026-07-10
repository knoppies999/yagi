# YAGI — Yet Another Git Interface

A Fork-like graphical Git client that lives **inside VS Code**. YAGI renders the
commit graph, staging area, and branch/remote management as a webview, driven by
an extension host that shells out to the `git` CLI.

## Features

- **Commit graph** with colored lanes, virtualized for large histories and
  incremental **“load more”** paging.
- **Commit details** — click any commit for its metadata, message, and changed
  files; click a file to open a native diff.
- **Staging area** — stage/unstage files, view diffs in VS Code's diff editor,
  resolve conflicts in the 3-way merge editor, and commit.
- **History operations** — cherry-pick, revert, merge, and rebase (including an
  **interactive rebase** UI with reorder / squash / fixup / drop).
- **Conflict-aware operations** — a banner surfaces paused merge/rebase/
  cherry-pick with Continue / Skip / Abort.
- **Remotes** — fetch, pull, push with ahead/behind tracking, plus optional
  auto-pull after operations (`yagi.pullAfterOperations`).
- **Interactive sidebar** — current branch, changes, and a branch tree with
  checkout / merge / rebase / delete actions.
- **Resizable & collapsible panes**, persisted per-user, plus a branch filter.
- **Repository discovery** — finds a repo in subfolders of the opened folder,
  or prompts when several exist.

## Architecture

```
Extension host (Node)                Webview (React + esbuild)
  extension.ts   commands, sidebar     App.tsx        3-pane layout
  yagiPanel.ts   owns the webview      components/    Graph, Changes, …
  gitService.ts  wraps the git CLI     graph.ts       lane assignment
  diffProvider   virtual diff docs     messages.ts    typed postMessage
  sidebar.ts     Activity Bar tree
```

`src/types.ts` is shared by both sides, so every `postMessage` payload is typed
end-to-end.

## Develop

```bash
npm install
npm run compile      # tsc (host) + esbuild (webview bundle)
npm run watch        # rebuild the webview on change
```

Press **F5** to launch an Extension Development Host, open a Git repo, and run
**YAGI: Open Git Interface** (or click the YAGI icon in the Activity Bar).

## Requirements

- VS Code 1.90+
- `git` on your `PATH`
