import { useState } from "react";
import type { FileChange } from "../../src/types";
import { post } from "../vscodeApi";
import type { MenuItem } from "./ContextMenu";

function FileRow({
  change,
  kind,
  selected,
  onClick,
  onContextMenu,
}: {
  change: FileChange;
  kind: "staged" | "unstaged" | "conflict";
  selected?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const code = (change.index + change.worktree).trim() || "??";
  return (
    <li
      className={
        "file" +
        (kind === "conflict" ? " conflict" : "") +
        (selected ? " selected" : "")
      }
      onContextMenu={onContextMenu}
    >
      <span className="code">{kind === "conflict" ? "!" : code}</span>
      <span
        className="name"
        title={kind === "conflict" ? "Open in merge editor" : "Open diff"}
        onClick={
          onClick ??
          (() =>
            post({ type: "openDiff", path: change.path, staged: kind === "staged" }))
        }
      >
        {change.path}
      </span>
      {kind === "staged" && change.resolvable && (
        <span
          className="resolvable-badge"
          title="Resolved during this operation — right-click to redo"
        >
          ↺
        </span>
      )}
      {kind === "staged" && (
        <button title="Unstage" onClick={() => post({ type: "unstage", path: change.path })}>
          −
        </button>
      )}
      {kind === "unstaged" && (
        <button title="Stage" onClick={() => post({ type: "stage", path: change.path })}>
          +
        </button>
      )}
      {kind === "conflict" && (
        <button title="Mark resolved (stage)" onClick={() => post({ type: "stage", path: change.path })}>
          ✓
        </button>
      )}
    </li>
  );
}

export function Changes({
  status,
  onCollapse,
  onMenu,
}: {
  status: FileChange[];
  onCollapse: () => void;
  onMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
}) {
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | undefined>();

  const conflicts = status.filter((c) => c.conflicted);
  const staged = status.filter((c) => c.staged);
  const unstaged = status.filter(
    (c) => !c.conflicted && (c.worktree !== " " || c.index === "?")
  );

  const commit = () => {
    const m = message.trim();
    if (m) {
      post({ type: "commit", message: m });
      setMessage("");
    }
  };

  const resolve = (paths: string[], resolution: "ours" | "theirs") =>
    post({ type: "resolveConflicts", paths, resolution });

  const conflictMenu = (paths: string[]): MenuItem[] => [
    {
      label: `Accept All Incoming (${paths.length})`,
      onClick: () => resolve(paths, "theirs"),
    },
    {
      label: `Accept All Outgoing (${paths.length})`,
      onClick: () => resolve(paths, "ours"),
    },
    { separator: true },
    ...(paths.length === 1
      ? [
          {
            label: "Open in Merge Editor",
            onClick: () => post({ type: "openConflict", path: paths[0] }),
          },
        ]
      : []),
    {
      label: `Mark Resolved / Stage (${paths.length})`,
      onClick: () => paths.forEach((p) => post({ type: "stage", path: p })),
    },
  ];

  const clickConflict = (path: string, index: number, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        next.has(path) ? next.delete(path) : next.add(path);
        return next;
      });
      setAnchor(path);
      return;
    }
    if (e.shiftKey && anchor) {
      const anchorIdx = conflicts.findIndex((c) => c.path === anchor);
      if (anchorIdx !== -1) {
        const [lo, hi] = [anchorIdx, index].sort((a, b) => a - b);
        setSelected(new Set(conflicts.slice(lo, hi + 1).map((c) => c.path)));
        return;
      }
    }
    // Plain click: select just this row and open its merge editor.
    setSelected(new Set([path]));
    setAnchor(path);
    post({ type: "openConflict", path });
  };

  const rightClickConflict = (path: string, e: React.MouseEvent) => {
    const already = selected.has(path) && selected.size > 1;
    const paths = already ? [...selected] : [path];
    if (!already) {
      setSelected(new Set([path]));
      setAnchor(path);
    }
    onMenu(e, conflictMenu(paths));
  };

  return (
    <section className="changes-pane">
      <div className="pane-header">
        <h2>Changes</h2>
        <button className="collapse-btn" title="Collapse" onClick={onCollapse}>
          »
        </button>
      </div>

      {conflicts.length > 0 && (
        <div className="group">
          <div className="group-header">
            <h3>Conflicts ({conflicts.length})</h3>
            {conflicts.length > 1 && (
              <span
                className="group-action"
                title="Select all conflicts"
                onClick={() => setSelected(new Set(conflicts.map((c) => c.path)))}
              >
                select all
              </span>
            )}
          </div>
          <ul>
            {conflicts.map((c, i) => (
              <FileRow
                key={c.path}
                change={c}
                kind="conflict"
                selected={selected.has(c.path)}
                onClick={(e) => clickConflict(c.path, i, e)}
                onContextMenu={(e) => rightClickConflict(c.path, e)}
              />
            ))}
          </ul>
        </div>
      )}

      <div className="group">
        <h3>Staged ({staged.length})</h3>
        <ul>
          {staged.map((c) => (
            <FileRow
              key={c.path}
              change={c}
              kind="staged"
              onContextMenu={
                c.resolvable
                  ? (e) =>
                      onMenu(e, [
                        {
                          label: "Undo Resolution (redo merge)…",
                          danger: true,
                          onClick: () =>
                            post({ type: "undoResolution", path: c.path }),
                        },
                      ])
                  : undefined
              }
            />
          ))}
        </ul>
      </div>

      <div className="group">
        <h3>Unstaged ({unstaged.length})</h3>
        <ul>
          {unstaged.map((c) => (
            <FileRow key={c.path} change={c} kind="unstaged" />
          ))}
        </ul>
      </div>

      <textarea
        className="commit-msg"
        placeholder="Commit message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") commit();
        }}
      />
      <button className="commit-btn" disabled={!staged.length || !message.trim()} onClick={commit}>
        Commit {staged.length ? `(${staged.length})` : ""}
      </button>
    </section>
  );
}
