import { describe, it, expect } from "vitest";
import {
  FS,
  RS,
  parseCompareLog,
  parseLeftRight,
  parseLog,
  parseStatus,
  parseUnmergedStages,
  parseBranches,
  parseCommitDetails,
  parseRebaseTodo,
  parsePatchId,
  parsePatchIds,
  parseRefsAtDistinctCommits,
  pruneCollapsedParents,
  detectOperationType,
} from "./gitParsing";
import type { Commit } from "./types";

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
});

describe("parseCompareLog", () => {
  it("returns [] for empty output", () => {
    expect(parseCompareLog("")).toEqual([]);
  });

  it("splits the %m marker off the commit fields", () => {
    const out = logOutput([
      ["<", "a1", "a0", "Jane", "jane@x.com", "1700000200", "left work", ""],
      [">", "b1", "b0", "Bob", "bob@x.com", "1700000100", "right work", ""],
    ]);
    const entries = parseCompareLog(out);
    expect(entries.map((e) => e.mark)).toEqual(["<", ">"]);
    expect(entries[0].commit).toEqual({
      hash: "a1",
      parents: ["a0"],
      author: "Jane",
      email: "jane@x.com",
      date: 1700000200,
      subject: "left work",
      refs: [],
    });
  });

  it("carries the '=' patch-equal marker through", () => {
    // --cherry-mark replaces the side marker with '=' for a commit whose patch
    // exists on both branches (a cherry-pick, rebase replay, or dual squash).
    const out = logOutput([
      ["=", "c1", "c0", "Jane", "jane@x.com", "1700000300", "picked", ""],
    ]);
    expect(parseCompareLog(out)[0].mark).toBe("=");
  });
});

describe("parseRefsAtDistinctCommits", () => {
  const line = (tip: string, full: string, short: string) =>
    [tip, full, short].join(FS);

  it("prefers the local head when a remote twin points at the same commit", () => {
    // origin/feature and feature are the same line; drawing both would double
    // it. The local name is the one the user acts on.
    const out = [
      line("aaa", "refs/remotes/origin/feature", "origin/feature"),
      line("aaa", "refs/heads/feature", "feature"),
    ].join("\n");
    expect(parseRefsAtDistinctCommits(out)).toEqual([
      { name: "feature", tip: "aaa" },
    ]);
  });

  it("keeps a remote-only branch when there's no local twin", () => {
    const out = line("bbb", "refs/remotes/origin/topic", "origin/topic");
    expect(parseRefsAtDistinctCommits(out)).toEqual([
      { name: "origin/topic", tip: "bbb" },
    ]);
  });

  it("keeps branches that sit at different commits", () => {
    const out = [
      line("aaa", "refs/heads/one", "one"),
      line("bbb", "refs/heads/two", "two"),
    ].join("\n");
    expect(parseRefsAtDistinctCommits(out).map((r) => r.name)).toEqual([
      "one",
      "two",
    ]);
  });

  it("drops the refs/remotes/<remote>/HEAD alias", () => {
    const out = line("ccc", "refs/remotes/origin/HEAD", "origin/HEAD");
    expect(parseRefsAtDistinctCommits(out)).toEqual([]);
  });

  it("returns [] for empty output", () => {
    expect(parseRefsAtDistinctCommits("")).toEqual([]);
  });
});

describe("pruneCollapsedParents", () => {
  const commit = (hash: string, parents: string[]): Commit => ({
    hash,
    parents,
    author: "a",
    email: "e@x.com",
    date: 0,
    subject: hash,
    refs: [],
  });

  it("drops a merge's unloaded second parent", () => {
    // The collapsed topic: --first-parent never walked it, so the reference
    // would draw as a lane dangling off the bottom.
    const out = pruneCollapsedParents([
      commit("m", ["a", "topic"]),
      commit("a", []),
    ]);
    expect(out[0].parents).toEqual(["a"]);
  });

  it("keeps a second parent that IS loaded", () => {
    // Both branches selected — the merge between them must still draw.
    const out = pruneCollapsedParents([
      commit("m", ["a", "b"]),
      commit("a", []),
      commit("b", []),
    ]);
    expect(out[0].parents).toEqual(["a", "b"]);
  });

  it("keeps an unloaded FIRST parent as the more-history cue", () => {
    const out = pruneCollapsedParents([commit("tip", ["older"])]);
    expect(out[0].parents).toEqual(["older"]);
  });

  it("keeps an unloaded first parent even on a merge commit", () => {
    // Oldest loaded row happens to be a merge: its line still continues down.
    const out = pruneCollapsedParents([commit("m", ["older", "topic"])]);
    expect(out[0].parents).toEqual(["older"]);
  });

  it("leaves ordinary commits untouched", () => {
    const input = [commit("b", ["a"]), commit("a", [])];
    expect(pruneCollapsedParents(input)).toEqual(input);
  });
});

describe("parseLeftRight", () => {
  it("maps each hash to its side of the symmetric difference", () => {
    const sides = parseLeftRight("<aaa\n>bbb\n<ccc\n");
    expect(sides.get("aaa")).toBe("left");
    expect(sides.get("bbb")).toBe("right");
    expect(sides.get("ccc")).toBe("left");
    expect(sides.size).toBe(3);
  });

  it("ignores blank lines and unmarked output", () => {
    // Defensive: without --left-right git emits bare hashes, which carry no
    // side and must not be guessed at.
    expect(parseLeftRight("").size).toBe(0);
    expect(parseLeftRight("aaa\n\nbbb\n").size).toBe(0);
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
      ["refs/heads/main", "main", "*", "origin/main", "[ahead 2, behind 1]"].join(FS),
      ["refs/heads/feature", "feature", "", "", ""].join(FS),
      ["refs/heads/tracked", "tracked", "", "origin/tracked", "[behind 3]"].join(FS),
    ].join("\n");
    const branches = parseBranches(out);
    expect(branches[0]).toEqual({
      name: "main",
      current: true,
      remote: false,
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
    });
    expect(branches[1]).toEqual({
      name: "feature",
      current: false,
      remote: false,
      upstream: undefined,
      ahead: 0,
      behind: 0,
    });
    expect(branches[2]).toMatchObject({ upstream: "origin/tracked", behind: 3, ahead: 0 });
  });

  it("flags remote-tracking branches and drops the symbolic origin/HEAD", () => {
    const out = [
      ["refs/heads/main", "main", "*", "origin/main", ""].join(FS),
      ["refs/remotes/origin/HEAD", "origin/HEAD", "", "", ""].join(FS),
      ["refs/remotes/origin/feature", "origin/feature", "", "", ""].join(FS),
    ].join("\n");
    const branches = parseBranches(out);
    // origin/HEAD is skipped; only main + origin/feature remain.
    expect(branches.map((b) => b.name)).toEqual(["main", "origin/feature"]);
    expect(branches[0].remote).toBe(false);
    expect(branches[1]).toMatchObject({
      name: "origin/feature",
      remote: true,
      current: false,
    });
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

describe("parsePatchIds", () => {
  it("maps each patch-id to the commit that produced it", () => {
    // `git log -p | git patch-id --stable` emits "<patchId> <commit>" per commit.
    const out = [
      "aaaa111 c0mmit1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "bbbb222 c0mmit2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ].join("\n");
    const map = parsePatchIds(out);
    expect(map.get("aaaa111")).toBe("c0mmit1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(map.get("bbbb222")).toBe("c0mmit2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(map.size).toBe(2);
  });

  it("lets a later duplicate patch-id win (any match is a valid target)", () => {
    const out = ["dup c0mmitOld", "dup c0mmitNew"].join("\n");
    expect(parsePatchIds(out).get("dup")).toBe("c0mmitNew");
  });

  it("ignores blank / malformed lines", () => {
    const out = ["", "   ", "noSpaceToken", "good c0mmit"].join("\n");
    const map = parsePatchIds(out);
    expect(map.size).toBe(1);
    expect(map.get("good")).toBe("c0mmit");
  });

  it("returns an empty map for empty output", () => {
    expect(parsePatchIds("").size).toBe(0);
  });
});

describe("parsePatchId", () => {
  it("takes the first token (a bare `git diff | patch-id` has a zero commit)", () => {
    expect(parsePatchId("abcdef123 0000000000000000000000000000000000000000")).toBe(
      "abcdef123"
    );
  });

  it("trims trailing newline", () => {
    expect(parsePatchId("abcdef123 0000000\n")).toBe("abcdef123");
  });

  it("returns null for empty input (no diff to hash)", () => {
    expect(parsePatchId("")).toBeNull();
    expect(parsePatchId("   \n")).toBeNull();
  });
});
