import * as vscode from "vscode";
import { GitService } from "./gitService";

/**
 * Owns the YAGI webview panel: builds its HTML, pushes repo data into it,
 * and handles action messages coming back from the UI.
 */
export class YagiPanel {
  public static current: YagiPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private git!: GitService;
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
    this.git = new GitService(folder.uri.fsPath);

    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.onMessage(msg),
      null,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  /** Handle a message posted from the webview. */
  private async onMessage(msg: any) {
    try {
      switch (msg.type) {
        case "ready":
        case "refresh":
          await this.sendState();
          break;
        case "stage":
          await this.git.stage(msg.path);
          await this.sendState();
          break;
        case "unstage":
          await this.git.unstage(msg.path);
          await this.sendState();
          break;
        case "commit":
          await this.git.commit(msg.message);
          await this.sendState();
          break;
        case "checkout":
          await this.git.checkout(msg.branch);
          await this.sendState();
          break;
        case "diff": {
          const patch = await this.git.getDiff(msg.path, msg.staged);
          this.post({ type: "diff", path: msg.path, patch });
          break;
        }
      }
    } catch (err: any) {
      this.post({ type: "error", message: String(err.message ?? err) });
    }
  }

  /** Gather the full repo snapshot and push it to the UI. */
  private async sendState() {
    const root = await this.git.getRepoRoot();
    if (!root) {
      this.post({ type: "notRepo" });
      return;
    }
    const [commits, status, branches] = await Promise.all([
      this.git.getLog(),
      this.git.getStatus(),
      this.git.getBranches(),
    ]);
    this.post({ type: "state", commits, status, branches });
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
  <div id="app">
    <aside id="sidebar">
      <h2>Branches</h2>
      <ul id="branches"></ul>
    </aside>
    <main id="graph-pane">
      <h2>History</h2>
      <div id="graph"></div>
    </main>
    <section id="changes-pane">
      <h2>Changes</h2>
      <div class="group"><h3>Staged</h3><ul id="staged"></ul></div>
      <div class="group"><h3>Unstaged</h3><ul id="unstaged"></ul></div>
      <textarea id="commit-msg" placeholder="Commit message"></textarea>
      <button id="commit-btn">Commit</button>
      <pre id="diff"></pre>
    </section>
  </div>
  <script nonce="${nonce}" src="${uri("main.js")}"></script>
</body>
</html>`;
  }

  dispose() {
    YagiPanel.current = undefined;
    vscode.commands.executeCommand("setContext", "yagiActive", false);
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  refresh() {
    this.sendState();
  }
}

function getNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
