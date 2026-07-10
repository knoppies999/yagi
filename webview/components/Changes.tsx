import { useState } from "react";
import type { FileChange } from "../../src/types";
import { post } from "../vscodeApi";

function FileRow({
  change,
  kind,
}: {
  change: FileChange;
  kind: "staged" | "unstaged" | "conflict";
}) {
  const code = (change.index + change.worktree).trim() || "??";
  return (
    <li className={"file" + (kind === "conflict" ? " conflict" : "")}>
      <span className="code">{kind === "conflict" ? "!" : code}</span>
      <span
        className="name"
        title={kind === "conflict" ? "Open in merge editor" : "Open diff"}
        onClick={() =>
          kind === "conflict"
            ? post({ type: "openConflict", path: change.path })
            : post({ type: "openDiff", path: change.path, staged: kind === "staged" })
        }
      >
        {change.path}
      </span>
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
}: {
  status: FileChange[];
  onCollapse: () => void;
}) {
  const [message, setMessage] = useState("");

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
          <h3>Conflicts</h3>
          <ul>
            {conflicts.map((c) => (
              <FileRow key={c.path} change={c} kind="conflict" />
            ))}
          </ul>
        </div>
      )}

      <div className="group">
        <h3>Staged ({staged.length})</h3>
        <ul>
          {staged.map((c) => (
            <FileRow key={c.path} change={c} kind="staged" />
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
