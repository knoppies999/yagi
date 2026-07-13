import type { Branch } from "../../src/types";
import { post } from "../vscodeApi";

export function Toolbar({
  branches,
  detailsOpen,
  onToggleDetails,
}: {
  branches: Branch[];
  detailsOpen: boolean;
  onToggleDetails: () => void;
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
        className={"toggle-details" + (detailsOpen ? " active" : "")}
        title={detailsOpen ? "Hide commit details" : "Show commit details"}
        onClick={onToggleDetails}
      >
        ▤ Details
      </button>
    </div>
  );
}
