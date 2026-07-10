import type { Operation } from "../../src/types";
import { post } from "../vscodeApi";

export function OpBanner({ operation }: { operation: Operation | null }) {
  if (!operation) return null;
  const n = operation.conflicted.length;
  const op = operation.type;

  return (
    <div className="op-banner">
      <span>
        <strong>{op}</strong>{" "}
        {n
          ? `paused — ${n} conflict${n > 1 ? "s" : ""} to resolve`
          : "in progress — conflicts resolved"}
      </span>
      <span className="op-actions">
        {n === 0 && (
          <button onClick={() => post({ type: "continueOp", op })}>
            Continue
          </button>
        )}
        {(op === "rebase" || op === "cherry-pick") && (
          <button onClick={() => post({ type: "skipOp", op })}>Skip</button>
        )}
        <button className="danger" onClick={() => post({ type: "abortOp", op })}>
          Abort
        </button>
      </span>
    </div>
  );
}
