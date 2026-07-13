/**
 * Tracks which branches need a force-push after a rebase, so the UI can show
 * a persistent banner/button instead of a one-shot notification that's easy
 * to miss or that disappears when the panel is closed and reopened.
 *
 * This can't be derived from ahead/behind counts alone: a branch can be
 * legitimately "ahead AND behind" its upstream just from ordinary organic
 * work (you committed locally, a teammate pushed too) — that case needs a
 * normal pull/merge, and offering a force-push there would be actively
 * dangerous (it would blow away the teammate's commits). So this is only
 * ever set immediately after a rebase-family operation we ourselves ran,
 * when we know for certain *why* the branch diverged.
 *
 * Keyed by repo root (like conflictCache.ts) since the panel and sidebar
 * each construct their own GitService for the same repo.
 */

const pendingByRoot = new Map<string, Set<string>>();

function setFor(root: string): Set<string> {
  let s = pendingByRoot.get(root);
  if (!s) {
    s = new Set();
    pendingByRoot.set(root, s);
  }
  return s;
}

/** Call right after a rebase-family operation succeeds. */
export function markNeedsForcePush(root: string, branch: string): void {
  setFor(root).add(branch);
}

/** Call after a successful (force-)push, or once the flag is no longer relevant. */
export function clearNeedsForcePush(root: string, branch: string): void {
  pendingByRoot.get(root)?.delete(branch);
}

export function isPendingForcePush(root: string, branch: string): boolean {
  return pendingByRoot.get(root)?.has(branch) ?? false;
}
