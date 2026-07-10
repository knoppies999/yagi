import * as fs from "fs";
import * as path from "path";

// Directories never worth descending into when hunting for repos.
const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  ".vscode-test",
  ".next",
  ".cache",
]);

/**
 * Breadth-first scan for Git repositories under `root`. A directory counts as
 * a repo if it contains a `.git` entry (folder for normal repos, file for
 * worktrees/submodules). We don't descend into a repo once found.
 */
export function findGitRepos(root: string, maxDepth = 4, limit = 25): string[] {
  const found: string[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];

  while (queue.length && found.length < limit) {
    const { dir, depth } = queue.shift()!;

    let isRepo = false;
    try {
      isRepo = fs.existsSync(path.join(dir, ".git"));
    } catch {
      /* unreadable dir */
    }
    if (isRepo) {
      found.push(dir);
      continue; // don't descend into the repo itself
    }
    if (depth >= maxDepth) {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP.has(e.name)) {
        queue.push({ dir: path.join(dir, e.name), depth: depth + 1 });
      }
    }
  }
  return found;
}
