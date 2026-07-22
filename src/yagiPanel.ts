import * as vscode from "vscode";
import * as path from "path";
import {
  Commit,
  CompareCommit,
  CompareResult,
  GitService,
  MergedBranch,
  OperationType,
} from "./gitService";
import { openWorkingDiff, openCommitFileDiff, openMergeEditor } from "./diffProvider";
import { setBranch } from "./statusBar";
import {
  autoPullIfEnabled,
  checkNeedsForcePush,
  clearNeedsForcePush,
  markRebasedIfDiverged,
} from "./gitOps";
import { getActiveRoot, resolveActiveRepo } from "./activeRepo";
import { findCoMerges, matchByPatchId } from "./gitParsing";

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
  private branchFilter: string[] = []; // graph restricted to these refs (empty = all)
  private knownBranches = new Set<string>(); // last-seen branch names, for pruning the filter without a re-fetch
  private currentBranchName = ""; // HEAD's branch name, the squash/rebase-merge target
  private localBranchNames: string[] = []; // local heads (merge-detection candidates), newest-first
  // Squash/rebase-merge detection caches. Rebuilt when the target (HEAD) moves;
  // per-branch results keyed by "name\0tip" so a branch is only re-tested when
  // its tip changes. See updateMergedBranches().
  private mergedTargetSha = "";
  private mergedTargetTips = new Map<string, string>();
  private mergedCache = new Map<string, MergedBranch | null>();
  // Compare mode: on + exactly two selected branches = the two-column diff of
  // unique commits. patchIdCache holds first-parent patch-id maps keyed by the
  // branch tip they were built from, so re-running a comparison after an
  // unrelated refresh doesn't re-diff hundreds of commits.
  private compareOn = false;
  private patchIdCache = new Map<string, Map<string, string>>();
  // Branch-scoped graphs collapse to each selected branch's own line. When a
  // selected branch only reaches another one through an unselected branch,
  // that intermediate can be pulled in too (dimmed) so the connection is
  // visible. Off by default: a scoped graph is meant to show what you picked
  // and nothing else, and resolving intermediates costs a git call per selected
  // pair. Opt in via the toolbar; results are cached by selection + tips.
  private showConnecting = false;
  private connectingCache = new Map<string, string[]>();
  private branchSignature = ""; // known branch names; changing invalidates above
  private ready = false; // the webview has mounted and can receive messages
  private pendingRebaseBase: string | undefined; // rebase requested before ready
  private debounce: NodeJS.Timeout | undefined;
  private stateGeneration = 0; // bumped per sendState() call so stale in-flight responses are dropped
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
      this.branchFilter = []; // the old repo's branches don't apply here
      this.mergedTargetSha = ""; // merge-detection caches are per-repo
      this.mergedTargetTips.clear();
      this.mergedCache.clear();
      this.patchIdCache.clear();
      this.connectingCache.clear();
      this.branchSignature = "";
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
          this.ready = true;
          this.post({
            type: "layout",
            layout: this.context.globalState.get(LAYOUT_KEY) ?? null,
          });
          await this.sendState();
          // A rebase requested from the sidebar before the webview mounted
          // (e.g. it opened the panel) runs now that the modal can appear.
          if (this.pendingRebaseBase !== undefined) {
            const base = this.pendingRebaseBase;
            this.pendingRebaseBase = undefined;
            await this.requestInteractiveRebase(base);
          }
          break;
        case "refresh":
          await this.sendState();
          break;
        case "loadMore":
          this.commitLimit += 300;
          await this.sendState();
          break;
        case "setBranchFilter":
          this.branchFilter = msg.branches;
          this.commitLimit = 200; // a new scope starts paging over
          // A selection change only affects which commits the graph walks —
          // status/branches/operation/force-push are unchanged — so recompute
          // just the graph instead of a full (and, on big repos, slow) snapshot.
          await this.sendGraph();
          break;
        case "setConnecting":
          this.showConnecting = msg.on;
          // Changes which refs the walk covers, so the graph has to be redone —
          // but nothing about the repo moved, so the cheap path is enough.
          await this.sendGraph();
          break;
        case "setCompare":
          this.compareOn = msg.on;
          // Toggling compare doesn't change the repo or the commit walk, only
          // which view reads it — so recompute just the comparison.
          await this.updateCompare(this.stateGeneration);
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
        case "discardChanges":
          await this.discardFile(msg.path);
          break;
        case "commitFile":
          await this.commitSingleFile(msg.path);
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
        case "forcePush": {
          const info = await checkNeedsForcePush(this.svc, this.root);
          if (info) {
            try {
              await this.withProgress("Force pushing…", () =>
                this.svc.forcePushWithLease()
              );
              clearNeedsForcePush(this.root, info.branch);
            } catch (err: any) {
              vscode.window.showErrorMessage(
                `Force push failed: ${err.message ?? err}`
              );
            }
          }
          await this.sendState();
          break;
        }

        // --- interactive rebase -------------------------------------------
        case "requestRebase":
          await this.requestInteractiveRebase(msg.base);
          break;
        case "applyRebase":
          await this.tryOp(
            () => this.svc.interactiveRebase(msg.base, msg.todo),
            "Interactive rebase",
            "markForcePush"
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
            "markForcePush"
          );
          break;

        // --- operation control --------------------------------------------
        case "continueOp":
          await this.tryOp(
            () => this.svc.continueOp(msg.op as OperationType),
            "Continue",
            msg.op === "rebase" ? "markForcePush" : "autoPull"
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
            msg.op === "rebase" ? "markForcePush" : "autoPull"
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
    afterSuccess: "autoPull" | "markForcePush" | "none" = "autoPull"
  ) {
    try {
      await fn();
      if (afterSuccess === "autoPull") {
        await this.maybeAutoPull();
      } else if (afterSuccess === "markForcePush") {
        await markRebasedIfDiverged(this.svc, this.root);
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

  /** Discard a file's changes back to HEAD after a modal confirmation. */
  private async discardFile(path: string) {
    const ok = await vscode.window.showWarningMessage(
      `Discard all changes to "${path}"? This can't be undone.`,
      { modal: true },
      "Discard"
    );
    if (ok !== "Discard") return;
    try {
      await this.svc.discardChanges(path);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Discard failed: ${err.message ?? err}`);
    }
    await this.sendState();
  }

  /** Prompt for a message and commit just this file (staging it first so an
   *  untracked/new file is included). */
  private async commitSingleFile(path: string) {
    const message = await vscode.window.showInputBox({
      prompt: `Commit message for ${path}`,
      placeHolder: "Commit message",
      validateInput: (v) => (v.trim() ? null : "A commit message is required"),
    });
    if (!message?.trim()) return;
    try {
      await this.svc.stage(path);
      await this.svc.commitPaths(message.trim(), [path]);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Commit failed: ${err.message ?? err}`);
    }
    await this.sendState();
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
    // Claim this call's generation; if a newer sendState() starts before
    // ours finishes (e.g. the active repo changes mid-fetch), our result is
    // stale and must not overwrite the newer one in the webview.
    const generation = ++this.stateGeneration;

    // Adopt the shared active repository (may prompt on first use).
    if (!(await this.ensureRepo())) {
      if (generation !== this.stateGeneration) return;
      this.post({ type: "notRepo", path: this.openedFolder });
      return;
    }
    const [status, branches, operation] = await Promise.all([
      this.svc.getStatus(),
      this.svc.getBranches(true),
      this.svc.getOperation(),
    ]);
    // Reuse the branch list just fetched instead of a second ref scan — the
    // force-push check only needs the current branch, which is in it.
    const forcePush = await checkNeedsForcePush(this.svc, this.root, branches);
    // Prune the graph filter to refs that still exist (a selected branch may
    // have been deleted) — a stale ref would make `git log` fail outright.
    const existing = new Set(branches.map((b) => b.name));
    this.knownBranches = existing; // remember for sendGraph()'s cheap pruning
    this.branchFilter = this.branchFilter.filter((n) => existing.has(n));
    // A branch appearing or disappearing can change what sits between two
    // selected ones, and the connecting cache is keyed only on the selection.
    const signature = [...existing].sort().join("\n");
    if (signature !== this.branchSignature) {
      this.branchSignature = signature;
      this.connectingCache.clear();
    }
    // Remember the merge-detection target (HEAD) and candidate pool (local
    // heads) so sendGraph() can refresh merge lines without re-fetching.
    this.currentBranchName = branches.find((b) => b.current)?.name ?? "";
    this.localBranchNames = branches.filter((b) => !b.remote).map((b) => b.name);
    const { commits, connectors } = await this.walkCommits();
    if (generation !== this.stateGeneration) return; // superseded — drop it
    setBranch(branches.find((b) => b.current)?.name);
    // If we filled the limit, there are (probably) older commits to load.
    const hasMore = commits.length >= this.commitLimit;
    const branchLimit = vscode.workspace
      .getConfiguration("yagi")
      .get<number>("branchLimit", 25);
    this.post({
      type: "state",
      commits,
      status,
      branches,
      operation,
      hasMore,
      forcePush,
      branchLimit,
      branchFilter: this.branchFilter,
      connectors,
      showConnecting: this.showConnecting,
    });
    // Detect squash/rebase merges after the paint (it's the expensive part);
    // results arrive as a separate "merged" message.
    void this.updateMergedBranches(generation);
    // Repo state moved, so the comparison (if any) is stale too.
    void this.updateCompare(generation);
  }

  /**
   * Recompute only the commit graph for the current `branchFilter` and push it
   * to the UI, skipping the full snapshot (status/branches/operation/
   * force-push) that a selection change can't affect. This is the cheap path
   * behind branch-filter toggles: on a big repo a full sendState() re-scans
   * every local+remote ref (twice — see checkNeedsForcePush), which is what
   * made toggling branches hang. Shares stateGeneration with sendState() so a
   * concurrent full refresh still wins if it finishes later.
   */
  private async sendGraph() {
    const generation = ++this.stateGeneration;
    if (!(await this.ensureRepo())) {
      if (generation !== this.stateGeneration) return;
      this.post({ type: "notRepo", path: this.openedFolder });
      return;
    }
    // Prune against the last-seen branch set (no re-fetch). If we somehow have
    // no cached set yet, trust the names the webview sent — they come straight
    // from the currently-displayed checkboxes.
    if (this.knownBranches.size) {
      this.branchFilter = this.branchFilter.filter((n) =>
        this.knownBranches.has(n)
      );
    }
    const { commits, connectors } = await this.walkCommits();
    if (generation !== this.stateGeneration) return; // superseded — drop it
    this.post({
      type: "graph",
      commits,
      hasMore: commits.length >= this.commitLimit,
      branchFilter: this.branchFilter,
      connectors,
      showConnecting: this.showConnecting,
    });
    // The visible branch set changed, so which merge lines apply changed too.
    // Cheap here: the target map and per-branch results are cached, so only
    // newly-selected branches cost a probe.
    void this.updateMergedBranches(generation);
    // The selection *is* the comparison's input — recompute (or clear it, if
    // the selection is no longer exactly two branches).
    void this.updateCompare(generation);
  }

  /**
   * Find which candidate branches were squash/rebase-merged into the current
   * branch and push them as a "merged" message. Runs off the hot path (after
   * the graph is already on screen) and leans on two caches so it stays cheap:
   * the target's patch-id map (rebuilt only when HEAD moves) and per-branch
   * results (keyed by branch tip). Gated by `yagi.showMergedBranches`.
   */
  private async updateMergedBranches(generation: number) {
    try {
      const on = vscode.workspace
        .getConfiguration("yagi")
        .get<boolean>("showMergedBranches", true);
      const target = this.currentBranchName;
      if (!on || !target) {
        if (generation === this.stateGeneration) {
          this.post({ type: "merged", mergedBranches: [] });
        }
        return;
      }
      const targetSha = await this.svc.revParse(target);
      // Rebuild the target's patch-id map only when HEAD has actually moved.
      if (targetSha !== this.mergedTargetSha) {
        this.mergedTargetSha = targetSha;
        this.mergedTargetTips = await this.svc.firstParentPatchIds(target);
        this.mergedCache.clear(); // results were keyed to the old target
      }
      const results: MergedBranch[] = [];
      for (const name of this.mergeCandidates()) {
        if (generation !== this.stateGeneration) return; // superseded mid-scan
        let tip: string;
        try {
          tip = await this.svc.revParse(name);
        } catch {
          continue; // branch vanished mid-scan
        }
        const key = `${name}\x00${tip}`;
        let info = this.mergedCache.get(key);
        if (info === undefined) {
          // Real ancestors are already drawn by normal graph edges.
          info = (await this.svc.isAncestor(name, target))
            ? null
            : await this.svc.detectMerged(name, target, this.mergedTargetTips);
          this.mergedCache.set(key, info);
        }
        if (info) results.push(info);
      }
      if (generation !== this.stateGeneration) return;
      this.post({ type: "merged", mergedBranches: results });
    } catch {
      /* detection is best-effort; never let it break the view */
    }
  }

  // Beyond this many selected branches the connecting scan (a git call per
  // ordered pair) stops paying for itself — and with that much selected you're
  // already seeing most of the graph anyway.
  private static readonly CONNECTING_MAX_BRANCHES = 6;

  /**
   * Walk the commits for the current selection.
   *
   * Unfiltered, this is the whole repo (`--all`) exactly as before. With
   * branches selected it switches to a first-parent walk, so each selected
   * branch draws as its own single line and everything merged into it
   * collapses into the merge commit — rather than dragging in a lane for every
   * topic branch ever merged.
   *
   * Returns the connecting commits separately so the UI can dim them: they
   * come from branches the user did NOT select, pulled in only to show how two
   * selected branches actually reach each other.
   */
  private async walkCommits(): Promise<{
    commits: Commit[];
    connectors: string[];
  }> {
    const selected = this.branchFilter;
    if (!selected.length) {
      return { commits: await this.svc.getLog(this.commitLimit), connectors: [] };
    }
    const intermediates = this.showConnecting
      ? await this.connectingBranches(selected)
      : [];
    const commits = await this.svc.getLog(
      this.commitLimit,
      [...selected, ...intermediates],
      true
    );
    if (!intermediates.length) return { commits, connectors: [] };
    // Anything the walk turned up that isn't on a selected branch's own line
    // is there purely to connect them.
    const own = await this.svc.firstParentHashes(selected, this.commitLimit);
    return {
      commits,
      connectors: commits.map((c) => c.hash).filter((h) => !own.has(h)),
    };
  }

  /**
   * Unselected branches that a selected branch has to travel through to reach
   * another selected one. Cached against the selection and its tips, since the
   * scan costs a git call per ordered pair and selections get toggled a lot.
   */
  private async connectingBranches(selected: string[]): Promise<string[]> {
    if (selected.length < 2) return []; // nothing to connect
    if (selected.length > YagiPanel.CONNECTING_MAX_BRANCHES) return [];

    const tips = new Map<string, string>();
    for (const name of selected) {
      try {
        tips.set(name, await this.svc.revParse(name));
      } catch {
        return []; // a selected ref vanished; skip rather than guess
      }
    }
    const key = selected
      .map((n) => `${n}\x00${tips.get(n)}`)
      .sort()
      .join("\x1e");
    const hit = this.connectingCache.get(key);
    if (hit) return hit;

    const chosen = new Set<string>();
    const selectedNames = new Set(selected);
    const selectedTips = new Set(tips.values());
    for (const from of selected) {
      for (const to of selected) {
        if (from === to) continue;
        for (const b of await this.svc.branchesBetween(from, to)) {
          // The query legitimately returns the endpoints themselves, and any
          // remote-tracking twin of a selected branch — neither is an
          // intermediate, and drawing them would duplicate a line already
          // there.
          if (selectedNames.has(b.name) || selectedTips.has(b.tip)) continue;
          chosen.add(b.name);
        }
      }
    }
    const result = [...chosen];
    if (this.connectingCache.size >= 16) {
      this.connectingCache.delete(
        this.connectingCache.keys().next().value as string
      );
    }
    this.connectingCache.set(key, result);
    return result;
  }

  /**
   * Recompute the two-branch comparison and push it to the UI. Sends twice on
   * purpose: the cherry-mark result goes out as soon as it's ready (that's the
   * fast part), then the squash pass — which has to diff whole topic ranges —
   * refines it. The UI shows the first result immediately and upgrades in
   * place, so a slow squash scan never holds up the columns.
   *
   * Compare needs exactly two branches; any other selection posts null and the
   * UI falls back to the graph.
   */
  private async updateCompare(generation: number) {
    try {
      if (!this.compareOn || this.branchFilter.length !== 2) {
        if (generation === this.stateGeneration) {
          this.post({ type: "compare", compare: null });
        }
        return;
      }
      const [left, right] = this.branchFilter;
      const base = await this.svc.compareBranches(left, right);
      if (generation !== this.stateGeneration) return; // superseded

      // Cheapest, context-proof pass first: a merge on each side that absorbed
      // the same topic (identical second parent) brought in shared work, so
      // neither is a real difference. This needs no git call — the parents are
      // already in hand — so it refines even the fast result, and it survives
      // branches that diverged near the merged code, where patch-id equivalence
      // silently misses (its hashed context lines no longer match).
      const coMerged = findCoMerges(base.leftCommits, base.rightCommits);
      const markMerged = (commits: CompareCommit[]): CompareCommit[] =>
        commits.map((c) => {
          const counterpart = coMerged.get(c.hash);
          return counterpart && c.relation === "unique"
            ? { ...c, relation: "merged" as const, counterpart }
            : c;
        });
      const result: CompareResult = {
        ...base,
        leftCommits: markMerged(base.leftCommits),
        rightCommits: markMerged(base.rightCommits),
        squashChecked: false,
      };
      this.post({ type: "compare", compare: result });

      // ---- refinement pass (needs git) --------------------------------------
      // Two independent equivalence checks over the still-`unique` commits,
      // then one refined post; `squashChecked` flips true when this has run.
      const hasMerges = (commits: CompareCommit[]) =>
        commits.some((c) => c.relation === "unique" && c.parents.length > 1);
      const hasUniqueNonMerge = (commits: CompareCommit[]) =>
        commits.some((c) => c.relation === "unique" && c.parents.length <= 1);

      // Squash detection keys on a unique merge (the only thing that can hide a
      // whole topic behind one commit: real-merged here, squash-merged there).
      const needSquash =
        hasMerges(result.leftCommits) || hasMerges(result.rightCommits);
      // Context-free equivalence can only pair a commit with one on the *other*
      // side, so both sides must have a unique non-merge commit to be worth the
      // two git walks.
      const needCtxFree =
        hasUniqueNonMerge(result.leftCommits) &&
        hasUniqueNonMerge(result.rightCommits);
      if (!needSquash && !needCtxFree) {
        this.post({
          type: "compare",
          compare: { ...result, squashChecked: true },
        });
        return;
      }

      // Squash-merge detection: one patch-id per unique merge, looked up in the
      // other branch's first-parent line.
      let leftSquashed = new Map<string, string>();
      let rightSquashed = new Map<string, string>();
      if (needSquash) {
        const [leftIds, rightIds] = await Promise.all([
          this.firstParentPatchIdsCached(left),
          this.firstParentPatchIdsCached(right),
        ]);
        if (generation !== this.stateGeneration) return;
        [leftSquashed, rightSquashed] = await Promise.all([
          this.svc.findSquashedTopics(result.leftCommits, rightIds),
          this.svc.findSquashedTopics(result.rightCommits, leftIds),
        ]);
        if (generation !== this.stateGeneration) return;
      }

      // Context-free equivalence: match `-U0` patch-ids across the two exclusive
      // ranges. Catches a change squash- or cherry-merged into both branches
      // even when they diverged around it — where the default-context patch-id
      // (compareBranches' `--cherry-mark`) silently fails.
      let ctxFreePairs = new Map<string, string>();
      if (needCtxFree) {
        const [leftCf, rightCf] = await Promise.all([
          this.svc.contextFreePatchIds(left, right),
          this.svc.contextFreePatchIds(right, left),
        ]);
        if (generation !== this.stateGeneration) return;
        ctxFreePairs = matchByPatchId(leftCf, rightCf);
      }

      // Squash findings are a fact about *both* sides, so they apply in both
      // directions. Scanning one side's merge finds "the squash commit on the
      // other side absorbed this topic" — which also makes that squash commit
      // shared, even though it has no merge commit of its own to be found from.
      // Without inverting, the same work reads shared on one side, unique on the
      // other.
      const invert = (found: Map<string, string>) => {
        const back = new Map<string, string>();
        for (const [hash, counterpart] of found) {
          // First writer wins: findSquashedTopics records the merge commit
          // before the topic's commits, and the merge is the better pointer.
          if (!back.has(counterpart)) back.set(counterpart, hash);
        }
        return back;
      };
      const apply = (
        commits: CompareCommit[],
        squashed: Map<string, string>,
        squashedFromOther: Map<string, string>
      ) =>
        commits.map((c) => {
          if (c.relation !== "unique") return c; // already shared — leave it
          const squash = squashed.get(c.hash) ?? squashedFromOther.get(c.hash);
          if (squash) {
            return { ...c, relation: "squashed" as const, counterpart: squash };
          }
          const equiv = ctxFreePairs.get(c.hash);
          if (equiv) {
            return { ...c, relation: "equivalent" as const, counterpart: equiv };
          }
          return c;
        });
      this.post({
        type: "compare",
        compare: {
          ...result,
          leftCommits: apply(
            result.leftCommits,
            leftSquashed,
            invert(rightSquashed)
          ),
          rightCommits: apply(
            result.rightCommits,
            rightSquashed,
            invert(leftSquashed)
          ),
          squashChecked: true,
        },
      });
    } catch {
      // Comparison is best-effort (a ref can vanish mid-scan); never let it
      // take down the view — just drop back to the graph.
      if (generation === this.stateGeneration) {
        this.post({ type: "compare", compare: null });
      }
    }
  }

  /** A branch's first-parent patch-id map, cached by the tip it was built
   *  from. Bounded to a handful of entries — comparisons revisit the same two
   *  branches repeatedly, but old tips are dead weight once a branch moves. */
  private async firstParentPatchIdsCached(
    branch: string
  ): Promise<Map<string, string>> {
    const sha = await this.svc.revParse(branch);
    const hit = this.patchIdCache.get(sha);
    if (hit) return hit;
    const ids = await this.svc.firstParentPatchIds(branch);
    if (this.patchIdCache.size >= 4) {
      this.patchIdCache.delete(this.patchIdCache.keys().next().value as string);
    }
    this.patchIdCache.set(sha, ids);
    return ids;
  }

  /** Local, non-current branches currently in graph scope (or all locals when
   *  unfiltered), capped so detection stays bounded on big repos. */
  private mergeCandidates(): string[] {
    const locals = new Set(this.localBranchNames);
    const scoped = this.branchFilter.length
      ? this.branchFilter.filter((n) => locals.has(n))
      : this.localBranchNames;
    return scoped.filter((n) => n !== this.currentBranchName).slice(0, 50);
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

  /**
   * Open (or reveal) the panel and start an interactive rebase of the current
   * branch onto `base`. Called from the sidebar's branch menus. If the webview
   * isn't mounted yet, the request is queued until it signals "ready".
   */
  static rebaseInteractive(context: vscode.ExtensionContext, base: string) {
    YagiPanel.createOrShow(context);
    void YagiPanel.current?.startInteractiveRebase(base);
  }

  private async startInteractiveRebase(base: string) {
    this.panel.reveal();
    if (this.ready) {
      await this.requestInteractiveRebase(base);
    } else {
      this.pendingRebaseBase = base; // runs from the "ready" handler
    }
  }

  /** Build the todo for `base..HEAD` and open the rebase modal (or note it's
   *  empty). Shared by the webview's request and the sidebar entry point. */
  private async requestInteractiveRebase(base: string) {
    if (!(await this.ensureRepo())) return;
    const entries = await this.svc.getRebaseTodo(base);
    if (!entries.length) {
      vscode.window.showInformationMessage(
        `No commits on the current branch after ${base} to rebase.`
      );
    } else {
      this.post({ type: "rebaseTodo", base, entries });
    }
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
