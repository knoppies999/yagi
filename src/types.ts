// Shared data shapes. Imported by both the extension host (src/) and the
// webview (webview/). Keep this file free of any Node/vscode imports so it
// bundles cleanly into the browser-side code.

export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: number; // unix seconds
  subject: string;
  refs: string[];
}

export interface FileChange {
  path: string;
  index: string;
  worktree: string;
  staged: boolean;
  conflicted: boolean;
  /** Already resolved during the current operation, but its pre-resolution
   *  conflict state was remembered — "Undo Resolution" can restore it. */
  resolvable: boolean;
}

export type OperationType = "merge" | "rebase" | "cherry-pick" | "revert";

export interface Operation {
  type: OperationType;
  conflicted: string[];
}

export interface Branch {
  name: string;
  current: boolean;
  /** A remote-tracking branch (refs/remotes/*, e.g. "origin/main") rather than
   *  a local head. Remote branches never have an upstream/ahead/behind here. */
  remote: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
}

/**
 * A branch whose work is already present on a target branch (typically the
 * checked-out one) even though it shares NO commit ancestry with it — the
 * result of a squash or rebase merge, which replays the changes under new
 * SHAs. The graph can't draw a real merge line for this (there's no parent
 * link), so it draws a synthetic one from `mergeCommit` down to `tip`.
 * Detected via patch-id equivalence; see GitService.detectMerged.
 */
export interface MergedBranch {
  /** The merged branch's local head name (e.g. "feature/x"). */
  branch: string;
  /** Its tip commit hash — one end of the synthetic edge. */
  tip: string;
  /** The branch it merged into (the target, e.g. "main"). */
  into: string;
  /** The squash (or last replayed) commit on the target — the other end. */
  mergeCommit: string;
  /** How the work landed: one squashed commit, or commits replayed by rebase. */
  kind: "squash" | "rebase";
}

/**
 * How one side's commit relates to the *content* of the other branch:
 * - "unique"     — the change exists only on this side.
 * - "equivalent" — the same change exists on the other branch under a different
 *                  SHA: a cherry-pick, a rebase replay, or one topic squashed
 *                  into each branch separately. git's own patch-id says so.
 * - "squashed"   — the commit belongs to a topic that was merged normally into
 *                  this branch but landed on the other one collapsed into a
 *                  single squash commit, so no per-commit patch-id matches.
 * - "merged"     — a merge commit whose merged-in topic (its second parent) was
 *                  merged into the other branch too. Its SHA is unique, but the
 *                  work it absorbed is shared. Detected structurally from the
 *                  shared second parent, not by patch-id, so it holds even when
 *                  the two branches diverged near the merged code (where
 *                  patch-id equivalence silently misses — the context lines it
 *                  hashes no longer match).
 *
 * Only "unique" is a real difference between the branches; the rest are the
 * same work wearing a different hash.
 */
export type CompareRelation =
  | "unique"
  | "equivalent"
  | "squashed"
  | "merged";

export interface CompareCommit extends Commit {
  relation: CompareRelation;
  /** The commit on the other branch carrying the same change, when identified. */
  counterpart?: string;
}

/**
 * A comparison of exactly two branches: the commits reachable from one but not
 * the other (git's `A...B` symmetric difference), with anything whose content
 * is already on the other side flagged rather than silently dropped. Commits
 * reachable from *both* — the ordinary "merged one into the other" case — never
 * appear here at all; the range excludes them by construction.
 */
export interface CompareResult {
  /** Branch on the left of the range (its exclusive commits are `leftCommits`). */
  left: string;
  right: string;
  leftCommits: CompareCommit[];
  rightCommits: CompareCommit[];
  /** The walk hit its cap — the lists are incomplete. */
  truncated: boolean;
  /** The squash-detection pass has run. False in the first (fast) result, true
   *  in the refined one that follows; the UI says "checking…" until then. */
  squashChecked: boolean;
}

/** A file touched by a single commit. status is git's A/M/D/R/C code. */
export interface CommitFile {
  status: string;
  path: string;
}

/** Full detail for one commit, shown when it's selected. */
export interface CommitDetails {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: number;
  subject: string;
  body: string;
  files: CommitFile[];
}
