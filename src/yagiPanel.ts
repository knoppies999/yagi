import * as vscode from "vscode";
import * as path from "path";
import { GitService, OperationType } from "./gitService";
import { openWorkingDiff, openCommitFileDiff, openMergeEditor } from "./diffProvider";
import { setBranch } from "./statusBar";
import { autoPullIfEnabled, maybeOfferForcePush } from "./gitOps";
import { getActiveRoot, resolveActiveRepo } from "./activeRepo";

// globalState key for the persisted, per-user pane layout.
const LAYOUT_KEY = "yagi.layout";

/**
 * Owns the YAGI webview panel: builds its HTML, pushes repo data into it,
 * and handles action messages coming back from the UI.
 */
export class YagiPanel {
  public static current: YagiPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private git: GitService | undefined;
  private root = "";
  private openedFolder = "";
  private commitLimit = 200; // grows as the user loads more history
  private debounce: NodeJS.Timeout | undefined;
  private disposables: vscode.Disposable[] = [];

  static createOrShow(context: vscode.ExtensionContext) {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (YagiPanel.current) {
      YagiPanel.current.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "yagi",
      "YAGI",
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      }
    );
    YagiPanel.current = new YagiPanel(panel, context);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext
  ) {
    this.panel = panel;
    vscode.commands.executeCommand("setContext", "yagiActive", true);

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      vscode.window.showErrorMessage("YAGI: open a folder with a Git repo first.");
      this.panel.dispose();
      return;
    }
    this.openedFolder = folder.uri.fsPath;

    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.onMessage(msg),
      null,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.setupWorkingTreeWatcher(folder);
  }

  /** The resolved git service; throws (caught → error toast) if no repo yet. */
  private get svc(): GitService {
    if (!this.git) {
      throw new Error("No Git repository is active.");
    }
    return this.git;
  }

  private refreshDebounced = () => {
    if (this.debounce) {
      clearTimeout(this.debounce);
    }
    this.debounce = setTimeout(() => void this.sendState(), 300);
  };

  /**
   * Adopt the shared active repo (prompting once if the opened folder holds
   * several). Rebuilds the git service when the active repo changes so the
   * panel always matches the sidebar. Returns false if no repo is available.
   */
  private async ensureRepo(): Promise<boolean> {
    const root =
      getActiveRoot() ?? (await resolveActiveRepo(this.openedFolder)) ?? undefined;
    if (!root) {
      return false;
    }
    if (root !== this.root) {
      this.root = root;
      this.git = new GitService(root);
      this.commitLimit = 200; // reset paging for the new repo
      void this.setupGitDirWatcher();
    }
    return true;
  }

  /** Watch working-tree edits (covers subfolder repos too). */
  private setupWorkingTreeWatcher(folder: vscode.WorkspaceFolder) {
    const w = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, "**/*")
    );
    w.onDidChange(this.refreshDebounced, null, this.disposables);
    w.onDidCreate(this.refreshDebounced, null, this.disposables);
    w.onDidDelete(this.refreshDebounced, null, this.disposables);
    this.disposables.push(w);
  }

  /** Watch .git for branch switch / commit / merge-rebase progress. */
  private async setupGitDirWatcher() {
    if (!this.git) return;
    try {
      const gitDir = await this.svc.getGitDir();
      const w = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(gitDir, "**")
      );
      w.onDidChange(this.refreshDebounced, null, this.disposables);
      w.onDidCreate(this.refreshDebounced, null, this.disposables);
      w.onDidDelete(this.refreshDebounced, null, this.disposables);
      this.disposables.push(w);
    } catch {
      /* ignore */
    }
  }

  /** Handle a message posted from the webview. */
  private async onMessage(msg: any) {
    try {
      switch (msg.type) {
        case "ready":
          this.post({
            type: "layout",
            layout: this.context.globalState.get(LAYOUT_KEY) ?? null,
          });
          await this.sendState();
          break;
        case "refresh":
          await this.sendState();
          break;
        case "loadMore":
          this.commitLimit += 300;
          await this.sendState();
          break;
        case "saveLayout":
          await this.context.globalState.update(LAYOUT_KEY, msg.layout);
          break;
        case "stage":
          await this.svc.stage(msg.path);
          await this.sendState();
          break;
        case "unstage":
          await this.svc.unstage(msg.path);
          await this.sendState();
          break;
        case "commit":
          await this.svc.commit(msg.message);
          await this.sendState();
          break;
        case "checkout":
          await this.svc.checkout(msg.branch);
          await this.sendState();
          break;

        // --- remotes ------------------------------------------------------
        case "fetch":
          await this.withProgress("Fetching…", () => this.svc.fetch());
          await this.sendState();
          break;
        case "pull":
          // Explicit pull: don't auto-pull again afterwards.
          await this.tryOp(
            () => this.withProgress("Pulling…", () => this.svc.pull()),
            "Pull",
            "none"
          );
          break;
        case "push":
          await this.tryOp(
            () => this.withProgress("Pushing…", () => this.svc.push()),
            "Push"
          );
          break;

        // --- interactive rebase -------------------------------------------
        case "requestRebase": {
          const entries = await this.svc.getRebaseTodo(msg.base);
          if (!entries.length) {
            vscode.window.showInformationMessage(
              "No commits after that one to rebase."
            );
          } else {
            this.post({ type: "rebaseTodo", base: msg.base, entries });
          }
          break;
        }
        case "applyRebase":
          await this.tryOp(
            () => this.svc.interactiveRebase(msg.base, msg.todo),
            "Interactive rebase",
            "offerForcePush"
          );
          break;

        // --- diffs & conflicts open in native VS Code editors -------------
        case "openDiff":
          await openWorkingDiff(this.root, msg.path, msg.staged);
          break;
        case "openConflict":
          await openMergeEditor(vscode.Uri.file(path.join(this.root, msg.path)));
          break;
        case "resolveConflicts":
          try {
            await this.svc.resolveConflicts(msg.paths, msg.resolution);
          } catch (err: any) {
            vscode.window.showErrorMessage(
              `Resolve failed: ${err.message ?? err}`
            );
          }
          await this.sendState();
          break;
        case "undoResolution":
          try {
            await this.svc.undoResolution(msg.path);
          } catch (err: any) {
            vscode.window.showErrorMessage(
              `Undo resolution failed: ${err.message ?? err}`
            );
          }
          await this.sendState();
          break;

        // --- commit details -----------------------------------------------
        case "commitDetails": {
          const details = await this.svc.getCommitDetails(msg.hash);
          this.post({ type: "commitDetails", details });
          break;
        }
        case "openCommitDiff":
          await openCommitFileDiff(this.root, msg.hash, msg.path);
          break;

        // --- history operations (may pause on conflict) -------------------
        case "cherryPick":
          await this.tryOp(() => this.svc.cherryPick(msg.hash), "Cherry-pick");
          break;
        case "revert":
          await this.tryOp(() => this.svc.revert(msg.hash), "Revert");
          break;
        case "merge":
          await this.tryOp(() => this.svc.merge(msg.branch), "Merge");
          break;
        case "rebase":
          await this.tryOp(
            () => this.svc.rebase(msg.branch),
            "Rebase",
            "offerForcePush"
          );
          break;

        // --- operation control --------------------------------------------
        case "continueOp":
          await this.tryOp(
            () => this.svc.continueOp(msg.op as OperationType),
            "Continue",
            msg.op === "rebase" ? "offerForcePush" : "autoPull"
          );
          break;
        case "abortOp":
          await this.svc.abortOp(msg.op as OperationType);
          await this.sendState();
          break;
        case "skipOp":
          await this.tryOp(
            () => this.svc.skipOp(msg.op as OperationType),
            "Skip",
            msg.op === "rebase" ? "offerForcePush" : "autoPull"
          );
          break;

        // --- branch & reset (native prompts / confirmations) --------------
        case "createBranch": {
          const name = await vscode.window.showInputBox({
            prompt: `New branch from ${shortRef(msg.startPoint)}`,
            validateInput: (v) =>
              /\s/.test(v) ? "Branch names can't contain spaces" : null,
          });
          if (name) {
            try {
              await this.svc.createBranch(name, msg.startPoint);
            } catch (err: any) {
              vscode.window.showErrorMessage(
                `Create branch failed: ${err.message ?? err}`
              );
            }
            await this.sendState();
          }
          break;
        }
        case "deleteBranch": {
          const ok = await vscode.window.showWarningMessage(
            `Delete branch "${msg.branch}"?`,
            { modal: true },
            "Delete"
          );
          if (ok === "Delete") {
            try {
              await this.svc.deleteBranch(msg.branch, false);
            } catch {
              // Not fully merged — offer a force delete.
              const force = await vscode.window.showWarningMessage(
                `"${msg.branch}" isn't fully merged. Force delete?`,
                { modal: true },
                "Force delete"
              );
              if (force === "Force delete") {
                await this.svc.deleteBranch(msg.branch, true);
              }
            }
            await this.sendState();
          }
          break;
        }
        case "reset": {
          const mode = msg.mode as "soft" | "mixed" | "hard";
          const confirm =
            mode === "hard"
              ? await vscode.window.showWarningMessage(
                  `Hard reset to ${msg.hash.slice(0, 7)}? This discards ` +
                    `uncommitted changes.`,
                  { modal: true },
                  "Reset (hard)"
                )
              : "ok";
          if (confirm) {
            await this.svc.resetTo(msg.hash, mode);
            await this.sendState();
          }
          break;
        }
        case "undoMerge": {
          const confirm = await vscode.window.showWarningMessage(
            "Undo the last merge? This hard-resets to before it (git reset " +
              "--hard ORIG_HEAD), discarding uncommitted changes.",
            { modal: true },
            "Undo Merge"
          );
          if (confirm) {
            try {
              await this.svc.undoMerge();
            } catch (err: any) {
              vscode.window.showErrorMessage(
                `Nothing to undo: ${err.message ?? err}`
              );
            }
            await this.sendState();
          }
          break;
        }
      }
    } catch (err: any) {
      this.post({ type: "error", message: String(err.message ?? err) });
    }
  }

  /**
   * Run a history operation that may legitimately fail with conflicts.
   * Either way we refresh, so the operation banner + conflicts appear;
   * conflicts are reported as info, not a scary error.
   */
  private async tryOp(
    fn: () => Thenable<string>,
    label: string,
    afterSuccess: "autoPull" | "offerForcePush" | "none" = "autoPull"
  ) {
    try {
      await fn();
      if (afterSuccess === "autoPull") {
        await this.maybeAutoPull();
      } else if (afterSuccess === "offerForcePush") {
        await maybeOfferForcePush(this.svc);
      }
    } catch (err: any) {
      const op = await this.svc.getOperation();
      if (op && op.conflicted.length) {
        vscode.window.showInformationMessage(
          `${label} paused: resolve ${op.conflicted.length} conflict(s), ` +
            `then Continue.`
        );
      } else {
        vscode.window.showErrorMessage(`${label} failed: ${err.message ?? err}`);
      }
    }
    await this.sendState();
  }

  /**
   * After a successful operation, pull the current branch's upstream so the
   * view reflects the remote too. Gated by the `yagi.pullAfterOperations`
   * setting (default on) and only runs when an upstream is configured.
   */
  private async maybeAutoPull() {
    await autoPullIfEnabled(this.svc);
  }

  /** Run a network op with a VS Code progress notification. */
  private withProgress<T>(title: string, fn: () => Promise<T>): Thenable<T> {
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title },
      fn
    );
  }

  /** Gather the full repo snapshot and push it to the UI. */
  private async sendState() {
    // Adopt the shared active repository (may prompt on first use).
    if (!(await this.ensureRepo())) {
      this.post({ type: "notRepo", path: this.openedFolder });
      return;
    }
    const [commits, status, branches, operation] = await Promise.all([
      this.svc.getLog(this.commitLimit),
      this.svc.getStatus(),
      this.svc.getBranches(),
      this.svc.getOperation(),
    ]);
    setBranch(branches.find((b) => b.current)?.name);
    // If we filled the limit, there are (probably) older commits to load.
    const hasMore = commits.length >= this.commitLimit;
    this.post({ type: "state", commits, status, branches, operation, hasMore });
  }

  private post(message: any) {
    this.panel.webview.postMessage(message);
  }

  /** Build the webview HTML with a CSP + nonce so only our script runs. */
  private getHtml(): string {
    const webview = this.panel.webview;
    const uri = (f: string) =>
      webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, "media", f)
      );
    const nonce = getNonce();
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${uri("style.css")}" rel="stylesheet" />
  <title>YAGI</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${uri("webview.js")}"></script>
</body>
</html>`;
  }

  dispose() {
    YagiPanel.current = undefined;
    vscode.commands.executeCommand("setContext", "yagiActive", false);
    if (this.debounce) {
      clearTimeout(this.debounce);
    }
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  refresh() {
    void this.sendState();
  }
}

/** A full commit hash renders as its short form; anything else (a branch
 *  name, "HEAD", etc.) is already human-readable and passes through as-is. */
function shortRef(ref: string): string {
  return /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref;
}

function getNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
