import * as vscode from "vscode";
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
export async function listCandidateRepos(openedFolder: string): Promise<string[]> {
  const set = new Set<string>();
  const top = await new GitService(openedFolder).getRepoRoot();
  if (top) set.add(top);
  for (const r of findGitRepos(openedFolder)) set.add(r);
  return [...set];
}

/**
 * Resolve the active repo once, with no prompt: if the opened folder holds
 * several, the first one found is adopted automatically. Switching between
 * them afterward happens inline in the sidebar's "Repository" row — YAGI
 * never blocks on a modal picker.
 */
export async function resolveActiveRepo(
  openedFolder: string
): Promise<string | undefined> {
  if (activeRoot) return activeRoot;
  if (attempted) return undefined;
  if (!resolving) {
    resolving = (async () => {
      const repos = await listCandidateRepos(openedFolder);
      const root = repos[0];
      if (root) setActiveRoot(root);
      return root;
    })().finally(() => {
      resolving = undefined;
      attempted = true;
    });
  }
  return resolving;
}
