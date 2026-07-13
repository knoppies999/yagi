import * as vscode from "vscode";
import { GitService } from "./gitService";

/**
 * Pull the current branch's upstream if the `yagi.pullAfterOperations` setting
 * is on and an upstream exists. Shared by the panel and the sidebar so both
 * honor the same post-operation sync behavior.
 */
export async function autoPullIfEnabled(git: GitService): Promise<void> {
  const enabled = vscode.workspace
    .getConfiguration("yagi")
    .get<boolean>("pullAfterOperations", true);
  if (!enabled) {
    return;
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
 * After a rebase, offer to force-push instead of auto-pulling. A rebase
 * gives every replayed commit a new hash, so if the branch was already
 * pushed, it has now diverged from its upstream (ahead AND behind) —
 * auto-pulling in that state would merge the rewritten commits back
 * together with their stale pre-rebase originals, producing exactly the
 * duplicate-looking history a rebase is supposed to avoid. Force-pushing
 * with `--force-with-lease` is the correct next step instead.
 */
export async function maybeOfferForcePush(git: GitService): Promise<void> {
  const branches = await git.getBranches();
  const cur = branches.find((b) => b.current);
  if (!cur?.upstream || cur.behind === 0) {
    return; // nothing pushed yet, or nothing to reconcile
  }
  const choice = await vscode.window.showWarningMessage(
    `${cur.name} was rebased and has diverged from ${cur.upstream} ` +
      `(↑${cur.ahead} ↓${cur.behind}). Force-push to update the remote?`,
    "Force Push (--force-with-lease)"
  );
  if (!choice) {
    return;
  }
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Force pushing…" },
      () => git.forcePushWithLease()
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(`Force push failed: ${err.message ?? err}`);
  }
}
