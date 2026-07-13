import * as vscode from "vscode";
import * as path from "path";
import { GitService } from "./gitService";
import { findGitRepos } from "./repoFinder";

/**
 * Single source of truth for which repository YAGI is showing. Both the panel
 * and the sidebar resolve through here, so they can never diverge when the
 * opened folder contains more than one repo.
 */

let activeRoot: string | undefined;
let attempted = false; // have we tried (and possibly been cancelled) once?
let resolving: Promise<string | undefined> | undefined;

const emitter = new vscode.EventEmitter<string | undefined>();
export const onActiveRepoChange = emitter.event;

export function getActiveRoot(): string | undefined {
  return activeRoot;
}

export function setActiveRoot(root: string | undefined) {
  if (root === activeRoot) return;
  activeRoot = root;
  emitter.fire(activeRoot);
}

/** All candidate repo roots for the opened folder (self, or subfolder repos). */
async function candidates(openedFolder: string): Promise<string[]> {
  const set = new Set<string>();
  const top = await new GitService(openedFolder).getRepoRoot();
  if (top) set.add(top);
  for (const r of findGitRepos(openedFolder)) set.add(r);
  return [...set];
}

async function pick(
  repos: string[],
  placeHolder: string
): Promise<string | undefined> {
  const choice = await vscode.window.showQuickPick(
    repos.map((r) => ({
      label: path.basename(r),
      description: r,
      root: r,
      picked: r === activeRoot,
    })),
    { placeHolder }
  );
  return choice?.root;
}

/**
 * Resolve the active repo once. Prompts if the opened folder holds several.
 * Cached afterward; a cancelled prompt won't nag again until an explicit
 * switch. Both views await the same in-flight promise, so only one prompt.
 */
export async function resolveActiveRepo(
  openedFolder: string
): Promise<string | undefined> {
  if (activeRoot) return activeRoot;
  if (attempted) return undefined;
  if (!resolving) {
    resolving = (async () => {
      const repos = await candidates(openedFolder);
      if (repos.length === 0) return undefined;
      const root =
        repos.length === 1
          ? repos[0]
          : await pick(repos, "Multiple Git repositories found — choose one for YAGI");
      if (root) setActiveRoot(root);
      return root;
    })().finally(() => {
      resolving = undefined;
      attempted = true;
    });
  }
  return resolving;
}

/** Let the user explicitly switch which repository YAGI shows. */
export async function switchRepo(openedFolder: string): Promise<void> {
  const repos = await candidates(openedFolder);
  if (repos.length === 0) {
    vscode.window.showInformationMessage("YAGI: no Git repository found here.");
    return;
  }
  const root = await pick(repos, "Select the Git repository for YAGI");
  if (root) {
    attempted = true;
    setActiveRoot(root);
  }
}
