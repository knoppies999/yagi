import type { Branch } from "../../src/types";
import { post } from "../vscodeApi";

export function Toolbar({
  branches,
  detailsOpen,
  compareOn,
  compareReady,
  connectingOn,
  connectingReady,
  onToggleDetails,
  onToggleCompare,
  onToggleConnecting,
}: {
  branches: Branch[];
  detailsOpen: boolean;
  compareOn: boolean;
  /** Exactly two branches are selected, so a comparison is possible. */
  compareReady: boolean;
  connectingOn: boolean;
  /** More than one branch is selected, so there's something to connect. */
  connectingReady: boolean;
  onToggleDetails: () => void;
  onToggleCompare: () => void;
  onToggleConnecting: () => void;
}) {
  const cur = branches.find((b) => b.current);

  let sync = "";
  if (cur) {
    sync = cur.upstream
      ? `${cur.name} → ${cur.upstream}`
      : `${cur.name} — no upstream`;
  }

  return (
    <div className="toolbar">
      <button title="Fetch --all --prune" onClick={() => post({ type: "fetch" })}>
        ⭳ Fetch
      </button>
      <button title="Pull current branch" onClick={() => post({ type: "pull" })}>
        ↓ Pull
      </button>
      <button title="Push current branch" onClick={() => post({ type: "push" })}>
        ↑ Push
      </button>
      <span className="sync-status">
        {sync}
        {cur?.upstream && (
          <>
            {" "}
            <span className="ahead">↑{cur.ahead}</span>{" "}
            <span className="behind">↓{cur.behind}</span>
          </>
        )}
      </span>
      <button
        className={"toggle-connecting" + (connectingOn ? " active" : "")}
        disabled={!connectingReady}
        title={
          connectingReady
            ? "Also show the unselected branches a selected branch merges " +
              "through to reach another (drawn dimmed)"
            : "Select 2 or more branches for this to apply"
        }
        onClick={onToggleConnecting}
      >
        ⑂ Linking
      </button>
      <button
        className={"toggle-compare" + (compareOn ? " active" : "")}
        disabled={!compareReady && !compareOn}
        title={
          compareReady
            ? "Show only what differs between the two selected branches"
            : "Select exactly 2 branches in the sidebar to compare them"
        }
        onClick={onToggleCompare}
      >
        ⇄ Compare
      </button>
      <button
        className={"toggle-details" + (detailsOpen ? " active" : "")}
        title={detailsOpen ? "Hide commit details" : "Show commit details"}
        onClick={onToggleDetails}
      >
        ▤ Details
      </button>
    </div>
  );
}
