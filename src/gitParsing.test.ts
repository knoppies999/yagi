import { describe, it, expect } from "vitest";
import {
  FS,
  RS,
  parseLog,
  parseStatus,
  parseUnmergedStages,
  parseBranches,
  parseCommitDetails,
  parseRebaseTodo,
  detectOperationType,
} from "./gitParsing";

// Build fixtures from the real separators, exactly as git emits them, rather
// than sprinkling literal escapes through each assertion.
const NUL = "\0";
/** Join one commit's fields, then terminate with RS as the format string does. */
const logRecord = (fields: string[]) => fields.join(FS) + RS;
/** git separates successive records with a newline; parseLog strips it. */
const logOutput = (records: string[][]) =>
  records.map(logRecord).join("\n");

describe("parseLog", () => {
  it("returns [] for empty output", () => {
    expect(parseLog("")).toEqual([]);
  });

  it("parses a linear history, newest first", () => {
    const out = logOutput([
      ["h2", "h1", "Jane", "jane@x.com", "1700000200", "second", ""],
      ["h1", "", "Jane", "jane@x.com", "1700000100", "first", ""],
    ]);
    const commits = parseLog(out);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      hash: "h2",
      parents: ["h1"],
      author: "Jane",
      email: "jane@x.com",
      date: 1700000200,
      subject: "second",
      refs: [],
    });
    // Root commit has no parents.
    expect(commits[1].parents).toEqual([]);
  });

  it("parses a merge commit's two parents", () => {
    const out = logOutput([
      ["m", "p1 p2", "Jane", "jane@x.com", "1700000300", "merge", ""],
    ]);
    expect(parseLog(out)[0].parents).toEqual(["p1", "p2"]);
  });

  it("strips 'HEAD -> ' and keeps tags / remote refs", () => {
    const out = logOutput([
      ["h", "", "Jane", "jane@x.com", "1", "s", "HEAD -> main, origin/main, tag: v1.0"],
    ]);
    expect(parseLog(out)[0].refs).toEqual(["main", "origin/main", "tag: v1.0"]);
  });

  it("keeps commas and quotes inside a subject (FS-delimited fields)", () => {
    const subject = 'Fix, improve, and "quote" things';
    const out = logOutput([
      ["h", "", "Jane", "jane@x.com", "1", subject, ""],
    ]);
    expect(parseLog(out)[0].subject).toBe(subject);
  });
});

describe("parseStatus", () => {
  it("returns [] for empty output", () => {
    expect(parseStatus("")).toEqual([]);
  });

  it("classifies staged / unstaged / untracked / deleted", () => {
    const out =
      [" M modified.txt", "A  added.txt", "?? untracked.txt", " D deleted.txt"]
        .map((e) => e + NUL)
        .join("");
    const changes = parseStatus(out);
    expect(changes).toEqual([
      { path: "modified.txt", index: " ", worktree: "M", staged: false, conflicted: false },
      { path: "added.txt", index: "A", worktree: " ", staged: true, conflicted: false },
      { path: "untracked.txt", index: "?", worktree: "?", staged: false, conflicted: false },
      { path: "deleted.txt", index: " ", worktree: "D", staged: false, conflicted: false },
    ]);
  });

  it("consumes the source-path token of a rename (R) entry", () => {
    // Rename emits two NUL tokens: the entry, then the old path. The old path
    // must NOT surface as its own change.
    const out = ["R  new-name.txt", "old-name.txt", " M after.txt"]
      .map((e) => e + NUL)
      .join("");
    const changes = parseStatus(out);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual({
      path: "new-name.txt",
      index: "R",
      worktree: " ",
      staged: true,
      conflicted: false,
    });
    expect(changes[1].path).toBe("after.txt");
  });

  it("flags unmerged codes (UU / AA / DD) as conflicted, not staged", () => {
    const out = ["UU c1.txt", "AA c2.txt", "DD c3.txt"]
      .map((e) => e + NUL)
      .join("");
    const changes = parseStatus(out);
    expect(changes.map((c) => c.conflicted)).toEqual([true, true, true]);
    expect(changes.map((c) => c.staged)).toEqual([false, false, false]);
  });

  it("keeps spaces in a filename", () => {
    const out = " M file with spaces.txt" + NUL;
    expect(parseStatus(out)[0].path).toBe("file with spaces.txt");
  });
});

describe("parseUnmergedStages", () => {
  it("groups all three index stages under their path", () => {
    const out =
      ["100644 aaaa 1\tf.txt", "100644 bbbb 2\tf.txt", "100644 cccc 3\tf.txt"]
        .map((e) => e + NUL)
        .join("");
    const map = parseUnmergedStages(out);
    expect(map.get("f.txt")).toEqual([
      { mode: "100644", sha: "aaaa", stage: 1 },
      { mode: "100644", sha: "bbbb", stage: 2 },
      { mode: "100644", sha: "cccc", stage: 3 },
    ]);
  });

  it("returns an empty map for empty output", () => {
    expect(parseUnmergedStages("").size).toBe(0);
  });
});

describe("parseBranches", () => {
  it("returns [] for empty output", () => {
    expect(parseBranches("")).toEqual([]);
  });

  it("parses current flag, upstream, and ahead/behind", () => {
    const out = [
      ["main", "*", "origin/main", "[ahead 2, behind 1]"].join(FS),
      ["feature", "", "", ""].join(FS),
      ["tracked", "", "origin/tracked", "[behind 3]"].join(FS),
    ].join("\n");
    const branches = parseBranches(out);
    expect(branches[0]).toEqual({
      name: "main",
      current: true,
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
    });
    expect(branches[1]).toEqual({
      name: "feature",
      current: false,
      upstream: undefined,
      ahead: 0,
      behind: 0,
    });
    expect(branches[2]).toMatchObject({ upstream: "origin/tracked", behind: 3, ahead: 0 });
  });
});

describe("parseCommitDetails", () => {
  it("merges metadata and the name-status file list", () => {
    const meta = ["abc", "p1 p2", "Jane", "jane@x.com", "1700000000", "Subject", "  Body text  "].join(FS);
    const nameStatus = ["M", "src/a.ts", "A", "src/b.ts"].map((t) => t + NUL).join("");
    const details = parseCommitDetails(meta, nameStatus);
    expect(details).toEqual({
      hash: "abc",
      parents: ["p1", "p2"],
      author: "Jane",
      email: "jane@x.com",
      date: 1700000000,
      subject: "Subject",
      body: "Body text",
      files: [
        { status: "M", path: "src/a.ts" },
        { status: "A", path: "src/b.ts" },
      ],
    });
  });

  it("handles a commit with no files", () => {
    const meta = ["abc", "", "Jane", "jane@x.com", "1", "s", ""].join(FS);
    expect(parseCommitDetails(meta, "").files).toEqual([]);
  });
});

describe("parseRebaseTodo", () => {
  it("parses hash + subject lines, oldest first", () => {
    const out = [["h1", "first"].join(FS), ["h2", "second"].join(FS)].join("\n");
    expect(parseRebaseTodo(out)).toEqual([
      { hash: "h1", subject: "first" },
      { hash: "h2", subject: "second" },
    ]);
  });

  it("returns [] for empty output", () => {
    expect(parseRebaseTodo("")).toEqual([]);
  });
});

describe("detectOperationType", () => {
  const has = (present: string[]) => (name: string) => present.includes(name);

  it("maps each marker file to its operation", () => {
    expect(detectOperationType(has(["rebase-merge"]))).toBe("rebase");
    expect(detectOperationType(has(["rebase-apply"]))).toBe("rebase");
    expect(detectOperationType(has(["CHERRY_PICK_HEAD"]))).toBe("cherry-pick");
    expect(detectOperationType(has(["REVERT_HEAD"]))).toBe("revert");
    expect(detectOperationType(has(["MERGE_HEAD"]))).toBe("merge");
  });

  it("returns null when no marker is present", () => {
    expect(detectOperationType(has([]))).toBeNull();
  });

  it("prefers rebase when multiple markers coexist", () => {
    // A rebase that merges leaves MERGE_HEAD around too; rebase must win.
    expect(detectOperationType(has(["MERGE_HEAD", "rebase-merge"]))).toBe("rebase");
  });
});
