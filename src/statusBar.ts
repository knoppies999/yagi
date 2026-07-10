import * as vscode from "vscode";

let item: vscode.StatusBarItem | undefined;

/** Create the status-bar entry that opens YAGI and shows the current branch. */
export function initStatusBar(context: vscode.ExtensionContext) {
  item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = "yagi.open";
  item.tooltip = "Open YAGI Git Interface";
  setBranch(undefined);
  item.show();
  context.subscriptions.push(item);
}

/** Update the branch shown in the status bar (undefined -> generic label). */
export function setBranch(branch: string | undefined) {
  if (!item) return;
  item.text = branch ? `$(git-branch) ${branch}` : "$(git-branch) YAGI";
}
