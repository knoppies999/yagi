import * as vscode from "vscode";
import { YagiPanel } from "./yagiPanel";
import { GitContentProvider, YAGI_SCHEME, openWorkingDiff } from "./diffProvider";
import { initStatusBar, setBranch } from "./statusBar";
import { GitService } from "./gitService";
import { SidebarProvider } from "./sidebar";
import { autoPullIfEnabled } from "./gitOps";
import { onActiveRepoChange, switchRepo } from "./activeRepo";

export function activate(context: vscode.ExtensionContext) {
  initStatusBar(context);

  const sidebar = new SidebarProvider(context);

  // Refresh both the sidebar and the panel (if open) after any change.
  const refreshAll = () => {
    sidebar.refresh();
    YagiPanel.current?.refresh();
  };

  // Keep both views in lockstep when the active repository changes.
  context.subscriptions.push(onActiveRepoChange(refreshAll));

  // Normalize a command argument that may be a branch name (from a click) or
  // a tree node (from a context menu).
  const branchName = (arg: unknown): string | undefined => {
    if (typeof arg === "string") return arg;
    if (arg && typeof arg === "object" && "branch" in arg) {
      return (arg as { branch: { name: string } }).branch.name;
    }
    return undefined;
  };

  const withProgress = <T>(title: string, fn: () => Promise<T>) =>
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title },
      fn
    );

  /** Run a history op from the sidebar: conflict-aware, then auto-pull + refresh. */
  const runHistoryOp = async (
    git: GitService,
    fn: () => Promise<string>,
    label: string
  ) => {
    try {
      await fn();
      await autoPullIfEnabled(git);
    } catch (err: any) {
      const op = await git.getOperation();
      if (op && op.conflicted.length) {
        vscode.window.showInformationMessage(
          `${label} paused: ${op.conflicted.length} conflict(s). Opening YAGI…`
        );
        YagiPanel.createOrShow(context); // surface the conflict banner
      } else {
        vscode.window.showErrorMessage(`${label} failed: ${err.message ?? err}`);
      }
    }
    refreshAll();
  };

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      YAGI_SCHEME,
      new GitContentProvider()
    ),
    vscode.window.registerTreeDataProvider("yagiSidebar", sidebar),

    vscode.commands.registerCommand("yagi.open", () =>
      YagiPanel.createOrShow(context)
    ),
    vscode.commands.registerCommand("yagi.refresh", () =>
      YagiPanel.current?.refresh()
    ),
    vscode.commands.registerCommand("yagi.sidebarRefresh", () =>
      sidebar.refresh()
    ),
    vscode.commands.registerCommand("yagi.switchRepo", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (folder) await switchRepo(folder.uri.fsPath);
    }),

    vscode.commands.registerCommand("yagi.checkoutBranch", async (arg) => {
      const name = branchName(arg);
      const git = await sidebar.getService();
      if (!name || !git) return;
      try {
        await git.checkout(name);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Checkout failed: ${err.message ?? err}`);
      }
      refreshAll();
    }),

    vscode.commands.registerCommand("yagi.mergeBranch", async (arg) => {
      const name = branchName(arg);
      const git = await sidebar.getService();
      if (name && git) await runHistoryOp(git, () => git.merge(name), "Merge");
    }),

    vscode.commands.registerCommand("yagi.rebaseBranch", async (arg) => {
      const name = branchName(arg);
      const git = await sidebar.getService();
      if (name && git) await runHistoryOp(git, () => git.rebase(name), "Rebase");
    }),

    vscode.commands.registerCommand("yagi.deleteBranch", async (arg) => {
      const name = branchName(arg);
      const git = await sidebar.getService();
      if (!name || !git) return;
      const ok = await vscode.window.showWarningMessage(
        `Delete branch "${name}"?`,
        { modal: true },
        "Delete"
      );
      if (ok !== "Delete") return;
      try {
        await git.deleteBranch(name, false);
      } catch {
        const force = await vscode.window.showWarningMessage(
          `"${name}" isn't fully merged. Force delete?`,
          { modal: true },
          "Force delete"
        );
        if (force === "Force delete") await git.deleteBranch(name, true);
      }
      refreshAll();
    }),

    vscode.commands.registerCommand("yagi.fetch", async () => {
      const git = await sidebar.getService();
      if (!git) return;
      await withProgress("Fetching…", () => git.fetch());
      refreshAll();
    }),
    vscode.commands.registerCommand("yagi.pull", async () => {
      const git = await sidebar.getService();
      if (git) await runHistoryOp(git, () => git.pull(), "Pull");
    }),
    vscode.commands.registerCommand("yagi.push", async () => {
      const git = await sidebar.getService();
      if (!git) return;
      try {
        await withProgress("Pushing…", () => git.push());
        await autoPullIfEnabled(git);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Push failed: ${err.message ?? err}`);
      }
      refreshAll();
    }),

    vscode.commands.registerCommand(
      "yagi.openFileDiff",
      async (filePath: string, staged: boolean) => {
        const repo = await sidebar.getRepo();
        if (repo) await openWorkingDiff(repo.root, filePath, staged);
      }
    )
  );

  // Keep the sidebar and status bar fresh as the repo changes on disk.
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, "**/*")
    );
    let timer: NodeJS.Timeout | undefined;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => sidebar.refresh(), 400);
    };
    watcher.onDidChange(debounced);
    watcher.onDidCreate(debounced);
    watcher.onDidDelete(debounced);
    context.subscriptions.push(watcher);

    new GitService(folder.uri.fsPath)
      .getCurrentBranch()
      .then((b) => setBranch(b))
      .catch(() => setBranch(undefined));
  }
}

export function deactivate() {}
