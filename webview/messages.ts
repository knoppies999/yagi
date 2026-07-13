import type {
  Branch,
  Commit,
  CommitDetails,
  FileChange,
  Operation,
} from "../src/types";

/** Messages the webview sends to the extension host. */
export type OutMsg =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "stage"; path: string }
  | { type: "unstage"; path: string }
  | { type: "commit"; message: string }
  | { type: "checkout"; branch: string }
  | { type: "openDiff"; path: string; staged: boolean }
  | { type: "openConflict"; path: string }
  | { type: "commitDetails"; hash: string }
  | { type: "openCommitDiff"; hash: string; path: string }
  | { type: "cherryPick"; hash: string }
  | { type: "revert"; hash: string }
  | { type: "merge"; branch: string }
  | { type: "rebase"; branch: string }
  | { type: "continueOp"; op: Operation["type"] }
  | { type: "abortOp"; op: Operation["type"] }
  | { type: "skipOp"; op: Operation["type"] }
  | { type: "createBranch"; startPoint: string }
  | { type: "deleteBranch"; branch: string }
  | { type: "reset"; hash: string; mode: "soft" | "mixed" | "hard" }
  | { type: "fetch" }
  | { type: "pull" }
  | { type: "push" }
  | { type: "requestRebase"; base: string }
  | { type: "applyRebase"; base: string; todo: string[] }
  | { type: "saveLayout"; layout: Layout }
  | { type: "loadMore" }
  | { type: "resolveConflicts"; paths: string[]; resolution: "ours" | "theirs" }
  | { type: "undoMerge" }
  | { type: "undoResolution"; path: string }
  | { type: "forcePush" };

export interface RebaseEntry {
  hash: string;
  subject: string;
}

/** Persisted pane sizes (px) + collapse flags. Middle graph column is flexible. */
export interface Layout {
  sidebar: number;
  changes: number;
  details: number;
  collapsedSidebar?: boolean;
  collapsedChanges?: boolean;
  collapsedDetails?: boolean;
}

/** Messages the extension host sends to the webview. */
export type InMsg =
  | {
      type: "state";
      commits: Commit[];
      status: FileChange[];
      branches: Branch[];
      operation: Operation | null;
      hasMore: boolean;
      forcePush: { branch: string; ahead: number; behind: number } | null;
    }
  | { type: "commitDetails"; details: CommitDetails }
  | { type: "rebaseTodo"; base: string; entries: RebaseEntry[] }
  | { type: "layout"; layout: Layout | null }
  | { type: "notRepo"; path?: string }
  | { type: "error"; message: string };
