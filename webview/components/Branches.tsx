import { useState } from "react";
import type { Branch } from "../../src/types";
import { post } from "../vscodeApi";
import type { MenuItem } from "./ContextMenu";

export function Branches({
  branches,
  onMenu,
  onCollapse,
}: {
  branches: Branch[];
  onMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
  onCollapse: () => void;
}) {
  const current = branches.find((b) => b.current)?.name ?? "";
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? branches.filter((b) => b.name.toLowerCase().includes(q))
    : branches;

  const menuFor = (b: Branch): MenuItem[] => {
    if (b.current) return [{ label: "(current branch)" }];
    return [
      {
        label: `Checkout ${b.name}`,
        onClick: () => post({ type: "checkout", branch: b.name }),
      },
      {
        label: `Merge ${b.name} into ${current}`,
        onClick: () => post({ type: "merge", branch: b.name }),
      },
      {
        label: `Rebase ${current} onto ${b.name}`,
        onClick: () => post({ type: "rebase", branch: b.name }),
      },
      { separator: true },
      {
        label: `Delete ${b.name}`,
        danger: true,
        onClick: () => post({ type: "deleteBranch", branch: b.name }),
      },
    ];
  };

  return (
    <aside className="sidebar">
      <div className="pane-header">
        <h2>Branches ({branches.length})</h2>
        <button className="collapse-btn" title="Collapse" onClick={onCollapse}>
          «
        </button>
      </div>
      <input
        className="filter"
        placeholder="Filter branches…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="branch-list">
        {shown.map((b) => (
          <li
            key={b.name}
            className={"branch" + (b.current ? " current" : "")}
            title={b.upstream ? `tracks ${b.upstream}` : "no upstream"}
            onClick={() =>
              !b.current && post({ type: "checkout", branch: b.name })
            }
            onContextMenu={(e) => onMenu(e, menuFor(b))}
          >
            <span className="branch-icon">{b.current ? "●" : "○"}</span>
            <span className="branch-name">{b.name}</span>
            {(b.ahead > 0 || b.behind > 0) && (
              <span className="branch-track">
                ↑{b.ahead} ↓{b.behind}
              </span>
            )}
          </li>
        ))}
      </ul>
      {q && shown.length === 0 && (
        <div className="pane-empty">No branches match “{query}”.</div>
      )}
    </aside>
  );
}
