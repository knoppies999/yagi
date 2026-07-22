# Changelog

All notable changes to YAGI are documented here.

## 1.2.1

**Branch comparison — fixes**
- A topic **merged (or PR-merged) into both branches** no longer shows up as a
  difference on each side. Both merge commits are now recognized as bringing in
  the same shared work — matched by their common merge parent — whichever branch
  you look from.
- The "same change landed on both branches under different hashes" detection is
  now robust when the two branches have **diverged near that change**. Git's
  patch-id folds in a few lines of surrounding context, so an edit either branch
  made next to a shared commit could make the *identical* code read as unique on
  both sides; comparison now also matches on a context-free patch-id, closing
  that gap for cherry-picks and squash-merges alike.

## 1.2.0

**Compare two branches**
- Check exactly two branches in the sidebar and hit **⇄ Compare** for a
  two-column view of what actually differs between them. Commits whose *code*
  already exists on the other side are folded away rather than listed twice:
  cherry-picks, rebase replays, and a topic squashed into each branch
  separately are all detected by patch-id, and a topic that was merged normally
  into one branch but **squash-merged** into the other is matched by hashing the
  whole topic range against the other branch's first-parent history. Shared
  commits are shown dimmed with an `=` marker (and a "Hide shared" toggle), so
  you can see the detection worked instead of wondering where a commit went.

**Branch-scoped graphs**
- Selecting branches in the sidebar now collapses the graph to **those
  branches' own lines**. Anything merged into a selected branch folds into its
  merge commit, instead of dragging in a separate lane for every topic branch
  ever merged. The unfiltered view is unchanged.
- New **⑂ Linking** toolbar toggle (off by default): when a selected branch only
  reaches another one *through* a branch you didn't select, that intermediate is
  pulled in and drawn dimmed so the connection is visible.

**Graph**
- **Hover any line in the graph to see which branch it belongs to.** Lines are
  named by the nearest branch tip at or above them; a merged-in topic keeps its
  own name, falling back to the merge commit's message when the branch has since
  been deleted.

## 1.1.0

**Squash / rebase-merge detection**
- YAGI now recognizes branches that were **squash- or rebase-merged** into the
  current branch even though they share no commit ancestry (their changes were
  replayed under new SHAs), and draws a solid merge line from the commit that
  absorbed them to the branch tip, plus a "merged" badge in the graph and the
  branch list. Detection uses patch-id equivalence and is cached per commit, so
  it stays cheap. New `yagi.showMergedBranches` setting (default on) turns it
  off for very large repositories.

**Branch panel**
- The **checked-out branch is pinned to the top** of the Local list, and its
  upstream to the top of the Remote list, so the branch you're on is always the
  first thing you see.

**Performance**
- Toggling the branch filter now recomputes only the graph instead of a full
  repository snapshot, so selecting branches stays responsive on large repos.
- Removed a redundant branch scan from every refresh (the force-push check now
  reuses the already-fetched branch list).

## 1.0.0

First stable release.

**Branch panel**
- New `yagi.branchLimit` setting (default 25): show only the newest branches
  by latest commit, with a "Show all" toggle; older branches stay searchable.
- Remote-tracking branches are now listed, grouped into Local / Remote
  sections. The limit applies to each section independently so many recent
  remotes can't crowd local branches out of the list.
- Click a branch to select it for the graph filter — the graph then shows only
  the selected branches and how they relate. Clicking no longer checks out
  (in the panel or the tree view), so branches can't be switched by accident;
  checkout moved to the hover button and context menu.

**Commit graph**
- Each row now shows the commit's date and time (in your local timezone)
  before the hash.
- Reworked lane assignment so branch lines no longer leak to the bottom of
  the graph.

**Changed files**
- Per-file actions in both the panel and the tree view: Stage, Unstage,
  Commit this file (with a message), and Discard changes (revert to HEAD).

**Interactive rebase**
- "Rebase current branch onto this (interactive)" added to both branch menus.
- Excludes merge commits from the generated todo, and drops commits that
  become empty, so scripted rebases no longer stall.

## 0.1.2

**Docs**
- Added a screenshot of the commit graph to the Marketplace README.

## 0.1.1

**Fixes**
- Fixed a race condition where the commit graph could keep showing a
  previously-active repository's history after switching repos, if that
  repo's `git log`/status calls happened to resolve after the newly
  selected repo's. The panel now discards stale in-flight responses
  instead of letting them overwrite newer state.

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
