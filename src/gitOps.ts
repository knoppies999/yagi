import * as vscode from "vscode";
import { GitService } from "./gitService";
import { clearNeedsForcePush, isPendingForcePush, markNeedsForcePush } from "./forcePushState";

/**
 * Pull the current branch's upstream if the `yagi.pullAfterOperations` setting
 * is on and an upstream exists. Shared by the panel and the sidebar so both
 * honor the same post-operation sync behavior.
 *
 * Always re-checks git's own operation state before pulling — regardless of
 * why this got called, or how long ago the panel was last open — so a pull
 * can never fire while a merge/rebase/cherry-pick/revert is still paused on
 * unresolved conflicts.
 */
export async function autoPullIfEnabled(git: GitService): Promise<void> {
  const enabled = vscode.workspace
    .getConfiguration("yagi")
    .get<boolean>("pullAfterOperations", true);
  if (!enabled) {
    return;
  }
  if (await git.getOperation()) {
    return; // something is still mid-flight; only pull once it's finished
  }
  const branches = await git.getBranches();
  if (!branches.some((b) => b.current && b.upstream)) {
    return;
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Pulling…" },
    () => git.pull()
  );
}

/**
 * Record that the current branch needs a force-push after a rebase-family
 * operation just succeeded. A rebase gives every replayed commit a new
 * hash, so a previously-pushed branch is now genuinely diverged (ahead AND
 * behind) from its upstream — auto-pulling in that state would merge the
 * rewritten commits back together with their stale pre-rebase originals,
 * producing exactly the duplicate-looking history a rebase is supposed to
 * avoid. `--force-with-lease` is the correct next step instead.
 *
 * This only marks state — no dialog. The UI (webview banner / sidebar
 * button) surfaces it persistently instead of a one-shot notification.
 */
export async function markRebasedIfDiverged(
  git: GitService,
  root: string
): Promise<void> {
  const branches = await git.getBranches();
  const cur = branches.find((b) => b.current);
  if (cur?.upstream && cur.behind > 0) {
    markNeedsForcePush(root, cur.name);
  }
}

/**
 * Whether to show the force-push banner right now: the flag must be set
 * *and* the branch must still actually be behind its upstream. Self-heals
 * if the divergence resolved some other way (a manual push, a teammate's
 * force-push landing the same content, etc.) by clearing the stale flag
 * instead of leaving a banner with nothing real to act on.
 */
export async function checkNeedsForcePush(
  git: GitService,
  root: string
): Promise<{ branch: string; ahead: number; behind: number } | null> {
  const branches = await git.getBranches();
  const cur = branches.find((b) => b.current);
  if (!cur || !isPendingForcePush(root, cur.name)) {
    return null;
  }
  if (!cur.upstream || cur.behind === 0) {
    clearNeedsForcePush(root, cur.name);
    return null;
  }
  return { branch: cur.name, ahead: cur.ahead, behind: cur.behind };
}

export { clearNeedsForcePush };
