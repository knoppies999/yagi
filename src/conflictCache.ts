/**
 * Remembers each conflicted path's three unmerged index stages (base/ours/
 * theirs) the moment a conflict is first observed. Once the user resolves a
 * path, `git add` collapses those stages into one — git itself no longer has
 * them — so this is the only way to later restore the conflict for a redo.
 *
 * Keyed by repo root rather than owned by a single GitService instance,
 * because callers (the panel, the sidebar) each construct their own
 * GitService for the same repo, and the cache must survive all of them.
 */

export interface ConflictStage {
  mode: string;
  sha: string;
  stage: 1 | 2 | 3;
}

const cachesByRoot = new Map<string, Map<string, ConflictStage[]>>();

function cacheFor(root: string): Map<string, ConflictStage[]> {
  let m = cachesByRoot.get(root);
  if (!m) {
    m = new Map();
    cachesByRoot.set(root, m);
  }
  return m;
}

/**
 * Record a path's stages. Always overwrites — a path can conflict, get
 * resolved, and conflict again later in the same operation (e.g. the same
 * file in two different commits during a multi-commit rebase); each fresh
 * occurrence must replace whatever was remembered before, or "undo
 * resolution" would restore the wrong (earlier) conflict.
 */
export function rememberConflict(
  root: string,
  path: string,
  stages: ConflictStage[]
): void {
  cacheFor(root).set(path, stages);
}

export function getCachedStages(
  root: string,
  path: string
): ConflictStage[] | undefined {
  return cacheFor(root).get(path);
}

export function hasCachedStages(root: string, path: string): boolean {
  return cacheFor(root).has(path);
}

/** Drop everything remembered for a repo — call when its operation ends. */
export function clearConflictCache(root: string): void {
  cachesByRoot.delete(root);
}
