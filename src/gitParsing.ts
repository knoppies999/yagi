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

/** Parse `git log --pretty=format:%H<FS>%P<FS>…<RS>` into commits, newest first. */
export function parseLog(out: string): Commit[] {
  return out
    .split(RS)
    .map((r) => r.replace(/^\n/, ""))
    .filter((r) => r.trim().length > 0)
    .map((record) => {
      const [hash, parents, author, email, date, subject, refs] =
        record.split(FS);
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
    });
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

/** Parse `git for-each-ref` (name<FS>HEAD<FS>upstream<FS>track per line). */
export function parseBranches(out: string): Branch[] {
  return out
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const [name, head, upstream, track] = line.split(FS);
      const ahead = /ahead (\d+)/.exec(track || "");
      const behind = /behind (\d+)/.exec(track || "");
      return {
        name,
        current: head === "*",
        upstream: upstream || undefined,
        ahead: ahead ? parseInt(ahead[1], 10) : 0,
        behind: behind ? parseInt(behind[1], 10) : 0,
      };
    });
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
