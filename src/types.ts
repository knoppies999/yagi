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
