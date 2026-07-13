import * as vscode from "vscode";
import { GitService } from "./gitService";

export const YAGI_SCHEME = "yagi";

/**
 * Serves file contents at an arbitrary git ref through a virtual document,
 * so VS Code's built-in diff editor can show "ref vs working tree" etc.
 *
 * URI shape:  yagi:/<path>?ref=<ref>&root=<repoRoot>&label=<label>
 */
export class GitContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const ref = params.get("ref") ?? "HEAD";
    const root = params.get("root") ?? "";
    const filePath = uri.path.replace(/^\//, "");
    if (!root) {
      return "";
    }
    const git = new GitService(root);
    return git.showFile(ref, filePath);
  }
}

/** Build a virtual URI pointing at `filePath` as it exists at `ref`. */
export function refUri(
  root: string,
  filePath: string,
  ref: string,
  label: string
): vscode.Uri {
  const query = new URLSearchParams({ ref, root, label }).toString();
  return vscode.Uri.from({
    scheme: YAGI_SCHEME,
    path: "/" + filePath,
    query,
  });
}

/**
 * Open VS Code's diff editor for a working-tree change.
 *  - unstaged: index (`:file`) vs the real file on disk
 *  - staged:   HEAD vs index (`:file`)
 */
export async function openWorkingDiff(
  root: string,
  filePath: string,
  staged: boolean
) {
  const title = `${filePath} (${staged ? "staged" : "working tree"})`;
  if (staged) {
    const left = refUri(root, filePath, "HEAD", "HEAD");
    const right = refUri(root, filePath, "", "index"); // "" -> `:path`
    await vscode.commands.executeCommand("vscode.diff", left, right, title);
  } else {
    const left = refUri(root, filePath, "", "index");
    const right = vscode.Uri.file(require("path").join(root, filePath));
    await vscode.commands.executeCommand("vscode.diff", left, right, title);
  }
}

/**
 * Diff a file as changed by a single commit: parent (`<hash>^`) vs the commit.
 * Empty sides (adds/deletes/root commit) are handled by showFile returning "".
 */
export async function openCommitFileDiff(
  root: string,
  hash: string,
  filePath: string
) {
  const short = hash.slice(0, 7);
  const left = refUri(root, filePath, `${hash}^`, `${short}^`);
  const right = refUri(root, filePath, hash, short);
  const title = `${filePath} @ ${short}`;
  await vscode.commands.executeCommand("vscode.diff", left, right, title);
}

/**
 * Open a conflicted file. Prefers VS Code's built-in 3-way merge editor
 * (the same UI the Source Control view uses) via the command the built-in
 * Git extension contributes; falls back to a plain text editor showing the
 * raw conflict markers if that extension is disabled or the command is
 * ever renamed.
 */
export async function openMergeEditor(uri: vscode.Uri) {
  try {
    await vscode.commands.executeCommand("git.openMergeEditor", uri);
  } catch {
    await vscode.window.showTextDocument(uri);
  }
}
