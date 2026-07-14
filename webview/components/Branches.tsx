import { useState } from "react";
import type { Branch } from "../../src/types";
import { post } from "../vscodeApi";
import type { MenuItem } from "./ContextMenu";

export function Branches({
  branches,
  limit,
  selected,
  onSelect,
  onMenu,
  onCollapse,
}: {
  branches: Branch[];
  /** Show only the newest `limit` branches by default (0 = no limit). */
  limit: number;
  /** Branch names the graph is restricted to (empty = show all branches). */
  selected: string[];
  /** Replace the graph's branch selection with `names`. */
  onSelect: (names: string[]) => void;
  onMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
  onCollapse: () => void;
}) {
  const current = branches.find((b) => b.current)?.name ?? "";
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const q = query.trim().toLowerCase();
  const selectedSet = new Set(selected);

  const toggle = (name: string) =>
    onSelect(
      selectedSet.has(name)
        ? selected.filter((n) => n !== name)
        : [...selected, name]
    );

  // Branches arrive newest-first (sorted by latest commit date). The cap is
  // applied to the local and remote lists *independently* — otherwise the many
  // recently-updated remote branches would crowd every local branch out of a
  // single combined window. The current branch and any branches feeding the
  // graph filter are always kept visible so they stay toggleable.
  const pinned = (b: Branch) => b.current || selectedSet.has(b.name);
  const capped = limit > 0 && !showAll;
  const capGroup = (list: Branch[]) => {
    if (!capped) return list;
    const head = list.slice(0, limit);
    const extra = list.filter((b) => pinned(b) && !head.includes(b));
    return [...head, ...extra];
  };
  const match = (b: Branch) => b.name.toLowerCase().includes(q);
  const allLocals = branches.filter((b) => !b.remote);
  const allRemotes = branches.filter((b) => b.remote);
  const locals = q ? allLocals.filter(match) : capGroup(allLocals);
  const remotes = q ? allRemotes.filter(match) : capGroup(allRemotes);
  const shown = [...locals, ...remotes];
  const hiddenCount = q ? 0 : Math.max(0, branches.length - shown.length);
  const overCap =
    limit > 0 && (allLocals.length > limit || allRemotes.length > limit);
  const showHeaders = locals.length > 0 && remotes.length > 0;

  // Checking out a remote-tracking branch means creating (or switching to) a
  // local branch that tracks it. Git's DWIM does this when given the branch's
  // short name with the remote stripped ("origin/feature" -> "feature").
  const localNameOf = (b: Branch) =>
    b.remote ? b.name.slice(b.name.indexOf("/") + 1) : b.name;

  const checkout = (b: Branch) =>
    post({ type: "checkout", branch: localNameOf(b) });

  const menuFor = (b: Branch): MenuItem[] => {
    const createBranch: MenuItem = {
      label: `Create Branch from ${b.name}…`,
      onClick: () => post({ type: "createBranch", startPoint: b.name }),
    };
    if (b.current) return [createBranch];
    const items: MenuItem[] = [
      {
        label: b.remote
          ? `Checkout ${localNameOf(b)} (tracking ${b.name})`
          : `Checkout ${b.name}`,
        onClick: () => checkout(b),
      },
      createBranch,
      { separator: true },
      {
        label: `Merge ${b.name} into ${current}`,
        onClick: () => post({ type: "merge", branch: b.name }),
      },
      {
        label: `Rebase ${current} onto ${b.name}`,
        onClick: () => post({ type: "rebase", branch: b.name }),
      },
      {
        label: `Rebase ${current} onto ${b.name} (interactive)…`,
        onClick: () => post({ type: "requestRebase", base: b.name }),
      },
    ];
    // Deleting a remote branch is a network/destructive push — leave that to
    // an explicit action rather than the sidebar's local-delete.
    if (!b.remote) {
      items.push(
        { separator: true },
        {
          label: `Delete ${b.name}`,
          danger: true,
          onClick: () => post({ type: "deleteBranch", branch: b.name }),
        }
      );
    }
    return items;
  };

  const renderBranch = (b: Branch) => (
    <li
      key={(b.remote ? "r:" : "l:") + b.name}
      className={
        "branch" +
        (b.current ? " current" : "") +
        (b.remote ? " remote" : "") +
        (selectedSet.has(b.name) ? " selected" : "")
      }
      title={
        (b.remote
          ? "remote-tracking branch"
          : b.upstream
          ? `tracks ${b.upstream}`
          : "no upstream") + " — click to show/hide in the graph"
      }
      // Click toggles graph selection (never checks out) so branches can't be
      // switched by accident. Checkout lives in the right-click menu.
      onClick={() => toggle(b.name)}
      onContextMenu={(e) => onMenu(e, menuFor(b))}
    >
      <input
        type="checkbox"
        className="branch-check"
        checked={selectedSet.has(b.name)}
        readOnly
        tabIndex={-1}
        aria-label={`Show ${b.name} in the graph`}
      />
      <span className="branch-icon">{b.current ? "●" : "○"}</span>
      <span className="branch-name">{b.name}</span>
      {(b.ahead > 0 || b.behind > 0) && (
        <span className="branch-track">
          ↑{b.ahead} ↓{b.behind}
        </span>
      )}
    </li>
  );

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
      {selected.length > 0 && (
        <div className="branch-filter-note">
          <span>
            Graph limited to {selected.length} branch
            {selected.length > 1 ? "es" : ""}
          </span>
          <button className="link-btn" onClick={() => onSelect([])}>
            Show all
          </button>
        </div>
      )}
      <ul className="branch-list">
        {showHeaders && locals.length > 0 && (
          <li className="branch-group">Local</li>
        )}
        {locals.map(renderBranch)}
        {showHeaders && remotes.length > 0 && (
          <li className="branch-group">Remote</li>
        )}
        {remotes.map(renderBranch)}
      </ul>
      {!q && hiddenCount > 0 && (
        <button className="branch-more" onClick={() => setShowAll(true)}>
          Show all ({hiddenCount} more)
        </button>
      )}
      {!q && showAll && overCap && (
        <button className="branch-more" onClick={() => setShowAll(false)}>
          Show fewer
        </button>
      )}
      {q && shown.length === 0 && (
        <div className="pane-empty">No branches match “{query}”.</div>
      )}
    </aside>
  );
}
