import type { Commit } from "../src/types";
import { post } from "./vscodeApi";
import type { MenuItem } from "./components/ContextMenu";

/**
 * Right-click actions for a commit row. Shared by the graph and the compare
 * view so a commit offers the same operations wherever it's shown.
 */
export function commitMenuItems(
  c: Commit,
  currentBranch: string
): MenuItem[] {
  const isMerge = c.parents.length > 1;
  const isBranchTip = c.refs.includes(currentBranch);
  return [
    {
      label: "Cherry-pick onto current branch",
      onClick: () => post({ type: "cherryPick", hash: c.hash }),
    },
    {
      label: "Revert commit",
      onClick: () => post({ type: "revert", hash: c.hash }),
    },
    // Only offered on a merge that is the current branch's tip — that's the
    // one case where resetting to before it is unambiguous.
    ...(isMerge && isBranchTip
      ? [
          {
            label: "Undo This Merge (reset to before it)",
            danger: true,
            onClick: () => post({ type: "undoMerge" }),
          } satisfies MenuItem,
        ]
      : []),
    {
      label: "Rebase interactively from here…",
      onClick: () => post({ type: "requestRebase", base: c.hash }),
    },
    { separator: true },
    {
      label: "Create branch here…",
      onClick: () => post({ type: "createBranch", startPoint: c.hash }),
    },
    {
      label: `Reset ${currentBranch || "HEAD"} here (mixed)`,
      onClick: () => post({ type: "reset", hash: c.hash, mode: "mixed" }),
    },
    {
      label: `Reset ${currentBranch || "HEAD"} here (hard)`,
      danger: true,
      onClick: () => post({ type: "reset", hash: c.hash, mode: "hard" }),
    },
  ];
}

/** Commit timestamps are absolute (unix seconds); render them in the viewer's
 *  local timezone — same basis as the details panel, just without seconds. */
export const fmtWhen = (unixSec: number) =>
  new Date(unixSec * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
