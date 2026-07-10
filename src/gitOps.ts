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
