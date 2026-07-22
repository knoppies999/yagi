import { useState } from "react";
import type { CompareCommit, CompareResult } from "../../src/types";
import { commitMenuItems, fmtWhen } from "../commitMenu";
import type { MenuItem } from "./ContextMenu";

/** Whether a commit is a real difference or the same work under another hash. */
const isShared = (c: CompareCommit) => c.relation !== "unique";

const SHARED_LABEL: Record<CompareCommit["relation"], string> = {
  unique: "",
  equivalent:
    "Same change exists on the other branch under a different hash " +
    "(cherry-pick, rebase, or squashed into both separately).",
  squashed:
    "Part of a topic that landed on the other branch as a single squash " +
    "commit — the code is on both sides.",
  merged:
    "A merge of the same commit the other branch also merged — the code is " +
    "on both sides, even if the branches diverged around it.",
};

export function Compare({
  compare,
  currentBranch,
  selected,
  onSelect,
  onMenu,
}: {
  compare: CompareResult;
  currentBranch: string;
  selected?: string;
  onSelect: (hash: string) => void;
  onMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
}) {
  const [hideShared, setHideShared] = useState(false);

  const column = (branch: string, commits: CompareCommit[], side: string) => {
    const unique = commits.filter((c) => !isShared(c));
    const shown = hideShared ? unique : commits;
    const sharedCount = commits.length - unique.length;

    return (
      <div className={"compare-col compare-" + side}>
        <div className="compare-col-head">
          <span
            className={
              "compare-branch" + (branch === currentBranch ? " current" : "")
            }
            title={branch}
          >
            {branch}
          </span>
          <span className="compare-count">
            {unique.length} unique
            {sharedCount > 0 && !hideShared && (
              <span className="compare-shared-count"> · {sharedCount} shared</span>
            )}
          </span>
        </div>
        <ul className="compare-list">
          {shown.map((c) => (
            <li
              key={c.hash}
              className={
                "compare-row" +
                (isShared(c) ? " shared" : "") +
                (selected === c.hash ? " selected" : "")
              }
              title={isShared(c) ? SHARED_LABEL[c.relation] : undefined}
              onClick={() => onSelect(c.hash)}
              onContextMenu={(e) =>
                onMenu(e, commitMenuItems(c, currentBranch))
              }
            >
              <span className="compare-mark">{isShared(c) ? "=" : "•"}</span>
              <div className="compare-body">
                <div className="compare-subject">
                  {c.refs.map((r) => (
                    <span key={r} className="ref">
                      {r}
                    </span>
                  ))}
                  {c.subject}
                </div>
                <div className="compare-meta">
                  {fmtWhen(c.date)} · {c.author} · {c.hash.slice(0, 7)}
                  {c.relation === "squashed" && c.counterpart && (
                    <> · squashed into {c.counterpart.slice(0, 7)}</>
                  )}
                  {c.relation === "merged" && c.counterpart && (
                    <> · also merged on the other branch ({c.counterpart.slice(0, 7)})</>
                  )}
                </div>
              </div>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="compare-empty">
              {commits.length === 0
                ? "Nothing here that isn't on the other branch."
                : "Only shared commits — nothing unique."}
            </li>
          )}
        </ul>
      </div>
    );
  };

  return (
    <div className="compare">
      <div className="compare-bar">
        <span className="compare-title">
          Comparing <strong>{compare.left}</strong> ↔{" "}
          <strong>{compare.right}</strong>
        </span>
        <label className="compare-toggle">
          <input
            type="checkbox"
            checked={hideShared}
            onChange={(e) => setHideShared(e.target.checked)}
          />
          Hide shared
        </label>
        {!compare.squashChecked && (
          <span
            className="compare-status"
            title="Looking for topics that were squash-merged into one side"
          >
            checking for squash merges…
          </span>
        )}
        {compare.truncated && (
          <span
            className="compare-status warn"
            title="The comparison hit its commit cap; older differences aren't listed."
          >
            truncated
          </span>
        )}
      </div>
      <div className="compare-cols">
        {column(compare.left, compare.leftCommits, "left")}
        {column(compare.right, compare.rightCommits, "right")}
      </div>
    </div>
  );
}
