# Changelog

All notable changes to YAGI are documented here.

## 0.1.0 — Initial release

The first public build of YAGI: a graphical Git client that lives inside VS
Code, in the spirit of Fork/GitKraken.

**History & staging**
- Commit graph with colored lanes, virtualized for large histories, with
  incremental "load more" paging past the initial 200 commits.
- Commit details panel — metadata, full message, and changed files, each
  opening a native VS Code diff.
- Staging area with native diffs and VS Code's 3-way merge editor for
  conflicts.

**Git operations**
- Cherry-pick, revert, merge, and rebase, including an interactive rebase
  UI (reorder, squash, fixup, drop).
- Conflict-aware operation banner with Continue / Skip / Abort.
- Remotes: fetch, pull, push with ahead/behind tracking, and optional
  auto-pull after operations (`yagi.pullAfterOperations`).

**Workspace integration**
- Activity Bar sidebar: current branch, changed files, and a branch tree
  with checkout / merge / rebase / delete actions.
- Status bar item showing the current branch.
- Automatic repository discovery in subfolders, with a repo switcher when
  a folder holds more than one.
- Resizable and collapsible panes, persisted per-user, plus a branch
  filter for repositories with many branches.
