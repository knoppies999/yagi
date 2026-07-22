// Pure parsers for git plumbing output. Each takes raw stdout (or, for
// operation detection, a filesystem predicate) and returns typed domain
// objects — no `spawn`, no `fs`, no side effects — so they're directly
// testable with fixture strings. GitService owns the I/O and delegates the
// parsing here.
import {
  Branch,
  Commit,
  CommitDetails,
  CommitFile,
  FileChange,
  OperationType,
} from "./types";
import { ConflictStage } from "./conflictCache";

// ASCII field/record separators — safe because they can't appear in git output.
export const FS = "\x1f";
export const RS = "\x1e";

/** Split a `%H<FS>%P<FS>%an<FS>%ae<FS>%at<FS>%s<FS>%D` record into a Commit. */
function commitFromFields(fields: string[]): Commit {
  const [hash, parents, author, email, date, subject, refs] = fields;
  return {
    hash,
    parents: parents ? parents.split(" ").filter(Boolean) : [],
    author,
    email,
    date: parseInt(date, 10),
    subject,
    refs: refs
      ? refs
          .split(",")
          .map((r) => r.trim().replace(/^HEAD -> /, ""))
          .filter(Boolean)
      : [],
  };
}

/** Split RS-delimited `git log` output into its non-empty records. */
function logRecords(out: string): string[] {
  return out
    .split(RS)
    .map((r) => r.replace(/^\n/, ""))
    .filter((r) => r.trim().length > 0);
}

/** Parse `git log --pretty=format:%H<FS>%P<FS>…<RS>` into commits, newest first. */
export function parseLog(out: string): Commit[] {
  return logRecords(out).map((record) => commitFromFields(record.split(FS)));
}

export interface CompareLogEntry {
  /**
   * git's `%m` marker under `--left-right --cherry-mark`:
   * "<" only on the left branch, ">" only on the right, "=" its patch also
   * exists on the other side. Note "=" *replaces* the side marker (git checks
   * PATCHSAME before left/right), which is why the side has to come from a
   * separate `--left-right` walk — see parseLeftRight.
   */
  mark: string;
  commit: Commit;
}

/** Parse `git log --left-right --cherry-mark --pretty=format:%m<FS>%H<FS>…<RS>`. */
export function parseCompareLog(out: string): CompareLogEntry[] {
  return logRecords(out).map((record) => {
    const fields = record.split(FS);
    return { mark: fields[0], commit: commitFromFields(fields.slice(1)) };
  });
}

/**
 * Parse `git rev-list --left-right` ("<sha" / ">sha", one per line) into
 * hash → which half of the symmetric difference the commit came from.
 */
export function parseLeftRight(out: string): Map<string, "left" | "right"> {
  const sides = new Map<string, "left" | "right">();
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const mark = trimmed[0];
    if (mark !== "<" && mark !== ">") continue;
    sides.set(trimmed.slice(1), mark === "<" ? "left" : "right");
  }
  return sides;
}

/**
 * Merge commits on opposite sides of a comparison that merged the *same* topic
 * — their second parent (the merged-in tip) is one and the same commit. Both
 * branches absorbed identical work, so neither merge is a real content
 * difference, however far the branches have otherwise diverged.
 *
 * This is the reachability-based companion to patch-id equivalence. `git`'s
 * patch-id hashes the merge diff *including its context lines*, so any change
 * on either branch near the merged code shifts those context lines and the two
 * ids no longer match — the equivalence is missed and the same feature reads as
 * unique on both sides. A shared second-parent SHA can't drift like that.
 *
 * Returns a symmetric map: each paired merge's hash → its counterpart merge on
 * the other side. Non-merges and unmatched merges are absent. Secondary parents
 * (`parents[1..]`) are all considered so octopus merges still pair; first writer
 * wins so one topic maps to one merge per side.
 */
export function findCoMerges(
  left: Commit[],
  right: Commit[]
): Map<string, string> {
  const rightBySecondary = new Map<string, string>();
  for (const c of right) {
    for (const parent of c.parents.slice(1)) {
      if (!rightBySecondary.has(parent)) rightBySecondary.set(parent, c.hash);
    }
  }
  const pairs = new Map<string, string>();
  for (const c of left) {
    for (const parent of c.parents.slice(1)) {
      const counterpart = rightBySecondary.get(parent);
      if (counterpart) {
        pairs.set(c.hash, counterpart);
        pairs.set(counterpart, c.hash);
        break;
      }
    }
  }
  return pairs;
}

/**
 * Cross-match two patch-id → commit-hash maps, one per side of a comparison:
 * where both sides carry the same patch-id, those two commits are the same
 * change under different hashes. Returns a symmetric commit-hash → counterpart
 * map (each paired commit points at the other).
 *
 * Fed context-free (`-U0`) patch-ids, this pairs a change squash- or
 * cherry-merged into both branches even when they diverged around it — the case
 * git's own `--cherry-mark` (default-context patch-id) silently misses.
 */
export function matchByPatchId(
  leftIds: Map<string, string>,
  rightIds: Map<string, string>
): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const [patchId, leftHash] of leftIds) {
    const rightHash = rightIds.get(patchId);
    if (rightHash) {
      pairs.set(leftHash, rightHash);
      pairs.set(rightHash, leftHash);
    }
  }
  return pairs;
}

/**
 * Parse `git status --porcelain=v1 -z` into file changes. The `resolvable`
 * flag is layered on by GitService (it needs live operation + cache state),
 * so this returns everything except that field.
 */
export function parseStatus(out: string): Omit<FileChange, "resolvable">[] {
  const parts = out.split("\0").filter(Boolean);
  const changes: Omit<FileChange, "resolvable">[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    const index = entry[0];
    const worktree = entry[1];
    const path = entry.slice(3);
    // Renames/copies consume the next NUL-separated token (the source path).
    if (index === "R" || index === "C") {
      i++;
    }
    // Unmerged (conflict) codes per `git status` docs.
    const code = index + worktree;
    const conflicted =
      code === "DD" || code === "AA" || index === "U" || worktree === "U";
    changes.push({
      path,
      index,
      worktree,
      staged: index !== " " && index !== "?" && !conflicted,
      conflicted,
    });
  }
  return changes;
}

/** Parse `git ls-files -u -z` into each unmerged path's index stages. */
export function parseUnmergedStages(out: string): Map<string, ConflictStage[]> {
  const map = new Map<string, ConflictStage[]>();
  for (const line of out.split("\0").filter(Boolean)) {
    // "<mode> <sha> <stage>\t<path>"
    const tab = line.indexOf("\t");
    const [mode, sha, stageStr] = line.slice(0, tab).split(" ");
    const filePath = line.slice(tab + 1);
    const stage = Number(stageStr) as 1 | 2 | 3;
    const arr = map.get(filePath) ?? [];
    arr.push({ mode, sha, stage });
    map.set(filePath, arr);
  }
  return map;
}

/**
 * Parse `git for-each-ref`
 * (fullRef<FS>shortName<FS>HEAD<FS>upstream<FS>track per line). The full ref
 * name classifies local heads vs remote-tracking branches; the short name is
 * what we display. The symbolic `refs/remotes/<remote>/HEAD` pointer is
 * dropped — it's an alias for the remote's default branch, not a branch.
 */
export function parseBranches(out: string): Branch[] {
  const branches: Branch[] = [];
  for (const line of out.split("\n")) {
    if (line.trim().length === 0) continue;
    const [fullRef, name, head, upstream, track] = line.split(FS);
    if (/^refs\/remotes\/[^/]+\/HEAD$/.test(fullRef)) continue;
    const remote = fullRef.startsWith("refs/remotes/");
    const ahead = /ahead (\d+)/.exec(track || "");
    const behind = /behind (\d+)/.exec(track || "");
    branches.push({
      name,
      current: head === "*",
      remote,
      upstream: upstream || undefined,
      ahead: ahead ? parseInt(ahead[1], 10) : 0,
      behind: behind ? parseInt(behind[1], 10) : 0,
    });
  }
  return branches;
}

/**
 * Parse `git for-each-ref --format=%(objectname)<FS>%(refname)<FS>%(refname:short)`
 * into short branch names, at most one per distinct commit. A local head and
 * its remote-tracking counterpart usually point at the same commit and would
 * contribute the same line twice, so the local one wins.
 */
export function parseRefsAtDistinctCommits(
  out: string
): { name: string; tip: string }[] {
  const byCommit = new Map<string, { full: string; name: string }>();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [tip, full, name] = line.split(FS);
    if (!tip || !full) continue;
    if (/^refs\/remotes\/[^/]+\/HEAD$/.test(full)) continue; // alias, not a branch
    const prev = byCommit.get(tip);
    const local = full.startsWith("refs/heads/");
    if (!prev || (local && !prev.full.startsWith("refs/heads/"))) {
      byCommit.set(tip, { full, name });
    }
  }
  return [...byCommit].map(([tip, r]) => ({ name: r.name, tip }));
}

/**
 * Drop merge parents that a `--first-parent` walk deliberately never visited.
 * Without this every collapsed topic leaves its merge commit with a parent
 * that isn't loaded, which the layout draws as a line dangling off the bottom
 * of the graph — one phantom lane per merge, the exact clutter first-parent
 * scoping exists to remove.
 *
 * The FIRST parent is always kept even when missing: there the line really
 * does continue past the loaded window, and the dangling edge is the "more
 * history below" cue.
 */
export function pruneCollapsedParents(commits: Commit[]): Commit[] {
  const loaded = new Set(commits.map((c) => c.hash));
  return commits.map((c) =>
    c.parents.length > 1
      ? { ...c, parents: c.parents.filter((p, i) => i === 0 || loaded.has(p)) }
      : c
  );
}

/**
 * Parse `git patch-id --stable` output into a patch-id → commit-hash map.
 * Each line is "<patch-id> <commit-id>"; when the input came from `git log -p`
 * the second column is the commit that produced the diff (for a bare `git diff`
 * it's all-zeros, which callers ignore). A patch-id identifies a change by its
 * content, independent of the commit SHA — so two commits that apply the same
 * change (e.g. a branch and its squash on main) share one id. Later duplicates
 * win, which is fine: any matching commit is an equally valid merge target.
 */
export function parsePatchIds(out: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of out.split("\n")) {
    const sp = line.indexOf(" ");
    if (sp <= 0) continue;
    const patchId = line.slice(0, sp);
    const commit = line.slice(sp + 1).trim();
    if (patchId) map.set(patchId, commit);
  }
  return map;
}

/** Extract just the patch-id from a single `git patch-id` line (the first
 *  whitespace-delimited token), or null if there's no diff (empty input). */
export function parsePatchId(out: string): string | null {
  const token = out.trim().split(/\s+/)[0];
  return token ? token : null;
}

/**
 * Parse a commit's metadata (`git show -s --format=%H<FS>…%b`) together with
 * its `--name-status -z` file list into a single CommitDetails.
 */
export function parseCommitDetails(
  meta: string,
  nameStatus: string
): CommitDetails {
  const [h, parents, author, email, date, subject, body] = meta.split(FS);
  const tokens = nameStatus.split("\0").filter((t) => t.length > 0);
  const files: CommitFile[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    files.push({ status: tokens[i], path: tokens[i + 1] });
  }
  return {
    hash: h,
    parents: parents ? parents.split(" ").filter(Boolean) : [],
    author,
    email,
    date: parseInt(date, 10),
    subject,
    body: (body || "").trim(),
    files,
  };
}

/** Parse `git log --reverse --format=%H<FS>%s base..HEAD` into a todo list. */
export function parseRebaseTodo(
  out: string
): { hash: string; subject: string }[] {
  return out
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const [hash, subject] = l.split(FS);
      return { hash, subject };
    });
}

/**
 * Decide which operation is paused from the presence of git-dir marker files.
 * The caller supplies a predicate (backed by `fs.existsSync` in production);
 * keeping the decision separate from the I/O makes precedence testable.
 */
export function detectOperationType(
  hasFile: (name: string) => boolean
): OperationType | null {
  if (hasFile("rebase-merge") || hasFile("rebase-apply")) {
    return "rebase";
  }
  if (hasFile("CHERRY_PICK_HEAD")) {
    return "cherry-pick";
  }
  if (hasFile("REVERT_HEAD")) {
    return "revert";
  }
  if (hasFile("MERGE_HEAD")) {
    return "merge";
  }
  return null;
}
