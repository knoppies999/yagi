import * as vscode from "vscode";
import * as path from "path";
import { GitService, Branch, FileChange } from "./gitService";
import {
  getActiveRoot,
  resolveActiveRepo,
  listCandidateRepos,
  setActiveRoot,
} from "./activeRepo";

type Node =
  | { kind: "repoHeader" }
  | { kind: "repoOption"; root: string }
  | { kind: "head"; branch: Branch }
  | { kind: "group"; id: "changes" | "branches"; label: string }
  | { kind: "file"; file: FileChange }
  | { kind: "branch"; branch: Branch }
  | { kind: "info"; label: string };

interface RepoData {
  root: string;
  git: GitService;
  branches: Branch[];
  status: FileChange[];
  allRepos: string[];
}

/**
 * The Activity Bar tree: current branch + sync, changed files, and branches
 * with inline/context actions. Backed by the same GitService as the panel.
 */
export class SidebarProvider implements vscode.TreeDataProvider<Node> {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private data: RepoData | undefined;
  private loading: Promise<void> | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Drop cached data and repaint. */
  refresh() {
    this.data = undefined;
    this.emitter.fire();
  }

  /** The GitService for the active repo (resolving if needed). */
  async getService(): Promise<GitService | undefined> {
    await this.ensureData();
    return this.data?.git;
  }

  /** The active repo's git service + root path. */
  async getRepo(): Promise<{ git: GitService; root: string } | undefined> {
    await this.ensureData();
    return this.data ? { git: this.data.git, root: this.data.root } : undefined;
  }

  private async ensureData(): Promise<void> {
    if (this.data) return;
    if (!this.loading) {
      this.loading = this.load().finally(() => (this.loading = undefined));
    }
    await this.loading;
  }

  private async load(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;

    // Share the exact repo the panel uses (auto-picks the first if several;
    // switching afterward happens inline via the "Repository" row below).
    const root = getActiveRoot() ?? (await resolveActiveRepo(folder.uri.fsPath));
    if (!root) return;

    const [git, allRepos] = [
      new GitService(root),
      await listCandidateRepos(folder.uri.fsPath),
    ];
    const [branches, status] = await Promise.all([
      git.getBranches(),
      git.getStatus(),
    ]);
    this.data = { root, git, branches, status, allRepos };
  }

  /** Switch the active repository directly — no prompt, just a tree click. */
  selectRepo(root: string) {
    setActiveRoot(root);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case "repoHeader": {
        const root = this.data?.root ?? "";
        const many = (this.data?.allRepos.length ?? 0) > 1;
        const item = new vscode.TreeItem(
          `Repository: ${path.basename(root)}`,
          many
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None
        );
        item.iconPath = new vscode.ThemeIcon("repo");
        item.tooltip = many
          ? `${root}\n\nExpand to switch between the ${this.data?.allRepos.length} repositories found in this folder.`
          : root;
        item.contextValue = "repoHeader";
        return item;
      }
      case "repoOption": {
        const active = node.root === this.data?.root;
        const item = new vscode.TreeItem(path.basename(node.root));
        item.description = node.root;
        item.iconPath = new vscode.ThemeIcon(active ? "check" : "circle-outline");
        item.tooltip = active ? "Current repository" : `Switch to ${node.root}`;
        if (!active) {
          item.command = {
            command: "yagi.selectRepo",
            title: "Switch Repository",
            arguments: [node.root],
          };
        }
        item.contextValue = active ? "activeRepoOption" : "repoOption";
        return item;
      }
      case "head": {
        const b = node.branch;
        const item = new vscode.TreeItem(b.name);
        item.iconPath = new vscode.ThemeIcon("git-branch");
        item.description = b.upstream
          ? `↑${b.ahead} ↓${b.behind} · ${b.upstream}`
          : "no upstream";
        item.tooltip = "Current branch — click to open YAGI";
        item.command = { command: "yagi.open", title: "Open YAGI" };
        item.contextValue = "head";
        return item;
      }
      case "group": {
        const item = new vscode.TreeItem(
          node.label,
          vscode.TreeItemCollapsibleState.Expanded
        );
        item.contextValue = "group";
        return item;
      }
      case "file": {
        const f = node.file;
        const item = new vscode.TreeItem(path.basename(f.path));
        const code = (f.index + f.worktree).trim() || "??";
        item.description = `${code}  ${path.dirname(f.path)}`;
        item.resourceUri = vscode.Uri.file(
          path.join(this.data?.root ?? "", f.path)
        );
        item.iconPath = new vscode.ThemeIcon(
          f.conflicted ? "warning" : "diff-modified"
        );
        item.command = {
          command: "yagi.openFileDiff",
          title: "Open Diff",
          arguments: [f.path, f.staged],
        };
        item.contextValue = "file";
        return item;
      }
      case "branch": {
        const b = node.branch;
        const item = new vscode.TreeItem(b.name);
        item.iconPath = new vscode.ThemeIcon(
          b.current ? "check" : "git-branch"
        );
        if (b.ahead || b.behind) {
          item.description = `↑${b.ahead} ↓${b.behind}`;
        }
        item.tooltip = b.current ? "Current branch" : `Checkout ${b.name}`;
        if (!b.current) {
          item.command = {
            command: "yagi.checkoutBranch",
            title: "Checkout",
            arguments: [b.name],
          };
        }
        item.contextValue = b.current ? "currentBranch" : "branch";
        return item;
      }
      case "info": {
        const item = new vscode.TreeItem(node.label);
        item.iconPath = new vscode.ThemeIcon("info");
        return item;
      }
    }
  }

  async getChildren(element?: Node): Promise<Node[]> {
    await this.ensureData();
    if (!this.data) {
      return []; // no repo -> viewsWelcome shows
    }

    if (!element) {
      const current = this.data.branches.find((b) => b.current);
      const changed = this.data.status.length;
      const roots: Node[] = [{ kind: "repoHeader" }];
      if (current) {
        roots.push({ kind: "head", branch: current });
      }
      roots.push({
        kind: "group",
        id: "changes",
        label: `Changes (${changed})`,
      });
      roots.push({
        kind: "group",
        id: "branches",
        label: `Branches (${this.data.branches.length})`,
      });
      return roots;
    }

    if (element.kind === "repoHeader") {
      return this.data.allRepos.map((root) => ({ kind: "repoOption", root }));
    }
    if (element.kind === "group" && element.id === "changes") {
      if (this.data.status.length === 0) {
        return [{ kind: "info", label: "No changes" }];
      }
      return this.data.status.map((file) => ({ kind: "file", file }));
    }
    if (element.kind === "group" && element.id === "branches") {
      return this.data.branches.map((branch) => ({ kind: "branch", branch }));
    }
    return [];
  }
}
