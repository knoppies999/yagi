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
}

export type OperationType = "merge" | "rebase" | "cherry-pick" | "revert";

export interface Operation {
  type: OperationType;
  conflicted: string[];
}

export interface Branch {
  name: string;
  current: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
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
