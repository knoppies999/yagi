import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  Branch,
  Commit,
  CommitDetails,
  CommitFile,
  FileChange,
  Operation,
  OperationType,
} from "./types";
import {
  ConflictStage,
  clearConflictCache,
  getCachedStages,
  hasCachedStages,
  rememberConflict,
} from "./conflictCache";
import {
  FS,
  RS,
  detectOperationType,
  parseBranches,
  parseCommitDetails,
  parseLog,
  parseRebaseTodo,
  parseStatus,
  parseUnmergedStages,
} from "./gitParsing";

export {
  Branch,
  Commit,
  CommitDetails,
  CommitFile,
  FileChange,
  Operation,
  OperationType,
};

export class GitService {
  constructor(private readonly cwd: string) {}

  /**
   * Run a git command, resolving with stdout. Rejects on non-zero exit.
   * `stdin`, when given, is written to the child process and closed —
   * needed for plumbing commands like `update-index --index-info`.
   */
  private run(
    args: string[],
    extraEnv?: NodeJS.ProcessEnv,
    stdin?: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        cwd: this.cwd,
        env: {
          ...process.env,
          // Never block on an interactive editor or credential prompt —
          // a paused merge/rebase must surface in the UI, not hang the host.
          GIT_EDITOR: "true",
          GIT_SEQUENCE_EDITOR: "true",
          GIT_TERMINAL_PROMPT: "0",
          ...extraEnv,
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", reject); // git not on PATH, etc.
      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`git ${args.join(" ")} failed (${code}): ${stderr}`));
        }
      });
      if (stdin !== undefined) {
        child.stdin.end(stdin);
      }
    });
  }

  /** Absolute path of the repository root, or null if cwd isn't a repo. */
  async getRepoRoot(): Promise<string | null> {
    try {
      const out = await this.run(["rev-parse", "--show-toplevel"]);
      return out.trim();
    } catch {
      return null;
    }
  }

  /** Parse `git log` into commits, newest first. */
  async getLog(limit = 200): Promise<Commit[]> {
    // %H hash, %P parents, %an author, %ae email, %at authored unix time,
    // %s subject, %D ref names.
    const fmt = ["%H", "%P", "%an", "%ae", "%at", "%s", "%D"].join(FS) + RS;
    const out = await this.run([
      "log",
      "--all",
      `--max-count=${limit}`,
      `--pretty=format:${fmt}`,
    ]);
    return parseLog(out);
  }

  /** Working tree status via porcelain v1 (stable, script-friendly). */
  async getStatus(): Promise<FileChange[]> {
    const out = await this.run(["status", "--porcelain=v1", "-z"]);
    const changes = parseStatus(out);

    // "Undo Resolution" only makes sense while an operation is actually in
    // progress. If there isn't one, drop anything remembered — it can only
    // be stale (a finished/aborted operation, possibly via a bypass like a
    // terminal command), and stale stages must never leak into a new one.
    const op = await this.getOperation();
    if (!op) {
      clearConflictCache(this.cwd);
    } else if (changes.some((c) => c.conflicted)) {
      for (const [p, stages] of await this.getUnmergedStages()) {
        rememberConflict(this.cwd, p, stages);
      }
    }

    return changes.map((c) => ({
      ...c,
      resolvable: !!op && !c.conflicted && hasCachedStages(this.cwd, c.path),
    }));
  }

  /** All currently-unmerged paths' index stages, keyed by path. */
  private async getUnmergedStages(): Promise<Map<string, ConflictStage[]>> {
    const out = await this.run(["ls-files", "-u", "-z"]);
    return parseUnmergedStages(out);
  }

  /**
   * Restore an already-resolved path back to its unmerged conflict state,
   * using the stages remembered by `getStatus()` before it was resolved.
   * Lets the user redo a resolution instead of living with it or aborting
   * the whole operation.
   */
  async undoResolution(path: string): Promise<void> {
    const stages = getCachedStages(this.cwd, path);
    if (!stages || !stages.length) {
      throw new Error("No prior conflict remembered for this file.");
    }
    const info =
      stages.map((s) => `${s.mode} ${s.sha} ${s.stage}\t${path}`).join("\n") +
      "\n";
    await this.run(["update-index", "--index-info"], undefined, info);
    await this.run(["checkout", "-m", "--", path]);
  }

  async getBranches(): Promise<Branch[]> {
    const fmt = [
      "%(refname:short)",
      "%(HEAD)",
      "%(upstream:short)",
      "%(upstream:track)",
    ].join(FS);
    const out = await this.run([
      "for-each-ref",
      "--sort=-committerdate",
      `--format=${fmt}`,
      "refs/heads",
    ]);
    return parseBranches(out);
  }

  stage(path: string) {
    return this.run(["add", "--", path]);
  }

  unstage(path: string) {
    return this.run(["reset", "-q", "HEAD", "--", path]);
  }

  commit(message: string) {
    return this.run(["commit", "-m", message]);
  }

  checkout(branch: string) {
    return this.run(["checkout", branch]);
  }

  /** Unified diff for a single path (staged or working tree). */
  async getDiff(filePath: string, staged: boolean): Promise<string> {
    const args = ["diff"];
    if (staged) {
      args.push("--cached");
    }
    args.push("--", filePath);
    return this.run(args);
  }

  /** Full metadata + changed files for a single commit. */
  async getCommitDetails(hash: string): Promise<CommitDetails> {
    const fmt = ["%H", "%P", "%an", "%ae", "%at", "%s", "%b"].join(FS);
    const meta = await this.run(["show", "-s", `--format=${fmt}`, hash]);

    // --root makes the initial commit list its files instead of nothing.
    // --no-renames keeps the parser simple (one path per line).
    const nameStatus = await this.run([
      "show",
      "--name-status",
      "--no-renames",
      "--root",
      "--format=",
      "-z",
      hash,
    ]);
    return parseCommitDetails(meta, nameStatus);
  }

  /** File contents at a given ref (e.g. "HEAD", a commit hash, or ":" for index). */
  async showFile(ref: string, filePath: string): Promise<string> {
    try {
      // "HEAD:path", "<sha>:path", or ":path" for the staged/index version.
      return await this.run(["show", `${ref}:${filePath}`]);
    } catch {
      return ""; // file didn't exist at that ref (added/deleted) -> empty side
    }
  }

  // ---- history operations -------------------------------------------------

  cherryPick(hash: string) {
    return this.run(["cherry-pick", hash]);
  }

  /**
   * Revert a commit. Merge commits require `-m <mainline>` or git refuses
   * outright ("commit is a merge but no -m option was given") — detect that
   * case and revert onto the first parent (the branch that was merged into),
   * which is what "undo this merge" means in every normal workflow.
   */
  async revert(hash: string): Promise<string> {
    const parents = (await this.run(["log", "-1", "--pretty=%P", hash]))
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const args = ["revert", "--no-edit"];
    if (parents.length > 1) {
      args.push("-m", "1");
    }
    args.push(hash);
    return this.run(args);
  }

  /** Merge a branch into the current branch (creates a merge commit if needed). */
  merge(branch: string) {
    return this.run(["merge", "--no-edit", branch]);
  }

  /**
   * Undo the most recent merge (or any operation that moved HEAD) by
   * resetting back to `ORIG_HEAD` — the pointer git itself sets to the
   * pre-operation position. This is the standard, git-recommended way to
   * undo a merge that hasn't been pushed yet; it's a hard reset, so it also
   * discards any uncommitted changes and any commits made since.
   */
  undoMerge() {
    return this.run(["reset", "--hard", "ORIG_HEAD"]);
  }

  /** Rebase the current branch onto `onto`. */
  rebase(onto: string) {
    return this.run(["rebase", onto]);
  }

  createBranch(name: string, startPoint?: string) {
    const args = ["branch", name];
    if (startPoint) {
      args.push(startPoint);
    }
    return this.run(args);
  }

  deleteBranch(name: string, force = false) {
    return this.run(["branch", force ? "-D" : "-d", name]);
  }

  /** Move the current branch tip to `hash`. mode: "soft" | "mixed" | "hard". */
  resetTo(hash: string, mode: "soft" | "mixed" | "hard" = "mixed") {
    return this.run(["reset", `--${mode}`, hash]);
  }

  // ---- in-progress operation control --------------------------------------

  async getGitDir(): Promise<string> {
    return this.gitDir();
  }

  private async gitDir(): Promise<string> {
    const out = await this.run(["rev-parse", "--absolute-git-dir"]);
    return out.trim();
  }

  /** Detect a paused merge/rebase/cherry-pick/revert and its conflicts. */
  async getOperation(): Promise<Operation | null> {
    let dir: string;
    try {
      dir = await this.gitDir();
    } catch {
      return null;
    }
    const has = (p: string) => fs.existsSync(path.join(dir, p));
    const type = detectOperationType(has);
    if (!type) {
      return null;
    }

    const out = await this.run(["diff", "--name-only", "--diff-filter=U", "-z"]);
    const conflicted = out.split("\0").filter(Boolean);
    return { type, conflicted };
  }

  /** Continue the current operation after conflicts are resolved & staged. */
  async continueOp(op: OperationType): Promise<string> {
    const out = await this.run([op, "--continue"]);
    clearConflictCache(this.cwd);
    return out;
  }

  async abortOp(op: OperationType): Promise<string> {
    const out = await this.run([op, "--abort"]);
    clearConflictCache(this.cwd);
    return out;
  }

  /** Skip the current commit (rebase / cherry-pick only). */
  async skipOp(op: OperationType): Promise<string> {
    const out = await this.run([op, "--skip"]);
    clearConflictCache(this.cwd);
    return out;
  }

  /**
   * Bulk-resolve conflicted paths by taking one side wholesale — "accept all
   * incoming" (theirs) or "accept all outgoing" (ours). Most conflicts
   * (content, or both-added) have both sides available via
   * `checkout --ours/--theirs`; a delete/modify conflict only has one side,
   * so when the chosen side is the one that deleted the file, we fall back
   * to removing it instead.
   */
  async resolveConflicts(
    paths: string[],
    resolution: "ours" | "theirs"
  ): Promise<void> {
    const flag = resolution === "ours" ? "--ours" : "--theirs";
    const restored: string[] = [];
    const deleted: string[] = [];
    for (const p of paths) {
      try {
        await this.run(["checkout", flag, "--", p]);
        restored.push(p);
      } catch {
        // No blob for this side (delete/modify conflict) — resolving to it
        // means the file should end up deleted.
        deleted.push(p);
      }
    }
    if (restored.length) {
      await this.run(["add", "--", ...restored]);
    }
    for (const p of deleted) {
      await this.run(["rm", "-f", "--", p]);
    }
  }

  // ---- remotes ------------------------------------------------------------

  async getCurrentBranch(): Promise<string> {
    const out = await this.run(["rev-parse", "--abbrev-ref", "HEAD"]);
    return out.trim();
  }

  async getRemotes(): Promise<string[]> {
    const out = await this.run(["remote"]);
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  }

  /** Fetch all remotes and prune deleted remote branches. */
  fetch() {
    return this.run(["fetch", "--all", "--prune"]);
  }

  /** Pull (fetch + merge) the current branch's upstream. */
  pull() {
    return this.run(["pull", "--no-edit"]);
  }

  /**
   * Push the current branch. If it has no upstream yet, set one on the
   * first available remote (usually "origin").
   */
  async push(): Promise<string> {
    const branch = await this.getCurrentBranch();
    const branches = await this.getBranches();
    const hasUpstream = branches.some((b) => b.current && b.upstream);
    if (hasUpstream) {
      return this.run(["push"]);
    }
    const remotes = await this.getRemotes();
    const remote = remotes.includes("origin") ? "origin" : remotes[0];
    if (!remote) {
      throw new Error("No remote configured to push to.");
    }
    return this.run(["push", "-u", remote, branch]);
  }

  /**
   * Force-push the current branch after history was rewritten (rebase).
   * Uses `--force-with-lease`, which refuses to overwrite the remote if it
   * has moved since we last saw it — e.g. a teammate pushed in the meantime
   * — unlike a bare `--force`, which would clobber it unconditionally.
   */
  async forcePushWithLease(): Promise<string> {
    const branch = await this.getCurrentBranch();
    const branches = await this.getBranches();
    const hasUpstream = branches.some((b) => b.current && b.upstream);
    if (hasUpstream) {
      return this.run(["push", "--force-with-lease"]);
    }
    const remotes = await this.getRemotes();
    const remote = remotes.includes("origin") ? "origin" : remotes[0];
    if (!remote) {
      throw new Error("No remote configured to push to.");
    }
    return this.run(["push", "--force-with-lease", "-u", remote, branch]);
  }

  // ---- interactive rebase -------------------------------------------------

  /** Commits in `base..HEAD`, oldest first (the todo-list order). */
  async getRebaseTodo(
    base: string
  ): Promise<{ hash: string; subject: string }[]> {
    const fmt = ["%H", "%s"].join(FS);
    const out = await this.run([
      "log",
      "--reverse",
      `--format=${fmt}`,
      `${base}..HEAD`,
    ]);
    return parseRebaseTodo(out);
  }

  /**
   * Run a non-interactive "interactive" rebase: we hand git a pre-built todo
   * file via GIT_SEQUENCE_EDITOR (a `cp` that overwrites git's todo file with
   * ours). `todoLines` are full lines like "pick <hash>" / "squash <hash>".
   */
  async interactiveRebase(base: string, todoLines: string[]): Promise<string> {
    const todoPath = path.join(
      os.tmpdir(),
      `yagi-rebase-${Date.now()}.txt`
    );
    fs.writeFileSync(todoPath, todoLines.join("\n") + "\n");
    // git invokes the sequence editor via `sh -c "<value> <todofile>"`, so a
    // `cp <ours>` command copies our todo over git's. Forward slashes work in
    // git's bundled sh even on Windows.
    const src = todoPath.replace(/\\/g, "/");
    const seqEditor = `cp '${src}'`;
    try {
      return await this.run(["rebase", "-i", base], {
        GIT_SEQUENCE_EDITOR: seqEditor,
      });
    } finally {
      try {
        fs.unlinkSync(todoPath);
      } catch {
        /* best effort */
      }
    }
  }
}
