import type { CommitDetails as Details } from "../../src/types";
import { post } from "../vscodeApi";

const STATUS_LABEL: Record<string, string> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type-changed",
};

export function CommitDetails({
  details,
  loading,
  collapsed,
  onToggleCollapse,
  onClose,
}: {
  details?: Details;
  loading: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onClose: () => void;
}) {
  if (loading && !details) {
    return (
      <div className="commit-details">
        <div className="details-loading">Loading commit…</div>
      </div>
    );
  }
  if (!details) return null;

  const when = new Date(details.date * 1000).toLocaleString();

  const header = (
    <div className="details-header">
      <button
        className="details-toggle"
        title={collapsed ? "Expand" : "Collapse"}
        onClick={onToggleCollapse}
      >
        {collapsed ? "▸" : "▾"}
      </button>
      <div className="details-subject">{details.subject}</div>
      <button className="details-close" title="Close" onClick={onClose}>
        ✕
      </button>
    </div>
  );

  if (collapsed) {
    return <div className="commit-details collapsed">{header}</div>;
  }

  return (
    <div className="commit-details">
      {header}

      <div className="details-meta">
        <span className="details-author">{details.author}</span>
        <span className="details-email">&lt;{details.email}&gt;</span>
        <span className="details-date">{when}</span>
      </div>
      <div className="details-hashes">
        <code>{details.hash.slice(0, 10)}</code>
        {details.parents.length > 0 && (
          <span className="details-parents">
            parents: {details.parents.map((p) => p.slice(0, 7)).join(", ")}
          </span>
        )}
      </div>

      {details.body && <pre className="details-body">{details.body}</pre>}

      <div className="details-files-head">
        {details.files.length} file{details.files.length !== 1 ? "s" : ""} changed
      </div>
      <ul className="details-files">
        {details.files.map((f) => {
          const code = f.status[0];
          return (
            <li
              key={f.path}
              className="details-file"
              title={STATUS_LABEL[code] ?? f.status}
              onClick={() =>
                post({ type: "openCommitDiff", hash: details.hash, path: f.path })
              }
            >
              <span className={"status status-" + code}>{code}</span>
              <span className="details-file-path">{f.path}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
