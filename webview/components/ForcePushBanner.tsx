import { post } from "../vscodeApi";

export interface ForcePushInfo {
  branch: string;
  ahead: number;
  behind: number;
}

/**
 * Persistent banner shown after a rebase leaves the current branch diverged
 * from its upstream. Stays up across closing/reopening the panel (it's
 * driven by host-side state, not anything local to this component) until
 * force-pushed or the divergence resolves itself some other way.
 */
export function ForcePushBanner({ info }: { info: ForcePushInfo | null }) {
  if (!info) return null;

  return (
    <div className="force-push-banner">
      <span>
        <strong>{info.branch}</strong> was rebased and has diverged from its
        upstream (↑{info.ahead} ↓{info.behind}).
      </span>
      <button className="danger" onClick={() => post({ type: "forcePush" })}>
        Force Push (--force-with-lease)
      </button>
    </div>
  );
}
