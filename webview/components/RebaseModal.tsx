import { useState } from "react";
import { post } from "../vscodeApi";
import type { RebaseEntry } from "../messages";

const ACTIONS = ["pick", "squash", "fixup", "drop"] as const;
type Action = (typeof ACTIONS)[number];

interface Row extends RebaseEntry {
  action: Action;
}

export function RebaseModal({
  base,
  entries,
  onClose,
}: {
  base: string;
  entries: RebaseEntry[];
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(
    entries.map((e) => ({ ...e, action: "pick" }))
  );

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
  };

  const setAction = (i: number, action: Action) => {
    const next = rows.slice();
    next[i] = { ...next[i], action };
    setRows(next);
  };

  const start = () => {
    const todo = rows.map((r) => `${r.action} ${r.hash}`);
    post({ type: "applyRebase", base, todo });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Interactive rebase</h2>
        <p className="hint">
          Reorder with ↑ ↓, choose an action per commit, then Start. Applied
          top-to-bottom (oldest first).
        </p>
        <ul className="rebase-list">
          {rows.map((r, i) => (
            <li className="rebase-row" key={r.hash}>
              <button disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <select
                value={r.action}
                onChange={(e) => setAction(i, e.target.value as Action)}
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <span
                className={"rebase-subj" + (r.action === "drop" ? " dropped" : "")}
              >
                {r.hash.slice(0, 7)} {r.subject}
              </span>
            </li>
          ))}
        </ul>
        <div className="modal-buttons">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={start}>
            Start rebase
          </button>
        </div>
      </div>
    </div>
  );
}
