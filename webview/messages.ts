import type {
  Branch,
  Commit,
  CommitDetails,
  CompareResult,
  FileChange,
  MergedBranch,
  Operation,
} from "../src/types";

/** Messages the webview sends to the extension host. */
export type OutMsg =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "stage"; path: string }
  | { type: "unstage"; path: string }
  | { type: "discardChanges"; path: string }
  | { type: "commitFile"; path: string }
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
  | { type: "setBranchFilter"; branches: string[] }
  | { type: "setCompare"; on: boolean }
  | { type: "setConnecting"; on: boolean }
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
      /** How many newest branches the sidebar shows before "Show all"
       *  (yagi.branchLimit). 0 means no limit. */
      branchLimit: number;
      /** Branch names the graph is currently restricted to (empty = all
       *  branches). Pruned to refs that still exist, so it's authoritative
       *  for the sidebar's selection checkboxes. */
      branchFilter: string[];
      /** Commits belonging to unselected branches, included only to show how
       *  two selected branches reach each other. Drawn dimmed. */
      connectors: string[];
      showConnecting: boolean;
    }
  | {
      // Lightweight graph-only update for a branch-filter change: only the
      // scoped commit walk is recomputed, so toggling branches doesn't trigger
      // a full repo snapshot (status/branches/operation/force-push are
      // unchanged by a selection). See sendGraph() in yagiPanel.ts.
      type: "graph";
      commits: Commit[];
      hasMore: boolean;
      branchFilter: string[];
      connectors: string[];
      showConnecting: boolean;
    }
  | {
      // Squash/rebase-merged branches detected out-of-band and sent AFTER the
      // graph (detection is expensive), so merge lines appear a beat later
      // without delaying the paint. Keyed to the branches currently in scope.
      type: "merged";
      mergedBranches: MergedBranch[];
    }
  | {
      // Two-branch comparison, sent whenever compare mode is on and exactly
      // two branches are selected. Arrives twice per refresh: first with
      // squashChecked=false (the fast cherry-mark result), then again once the
      // squash pass has run. null means compare mode is off or inapplicable.
      type: "compare";
      compare: CompareResult | null;
    }
  | { type: "commitDetails"; details: CommitDetails }
  | { type: "rebaseTodo"; base: string; entries: RebaseEntry[] }
  | { type: "layout"; layout: Layout | null }
  | { type: "notRepo"; path?: string }
  | { type: "error"; message: string };
