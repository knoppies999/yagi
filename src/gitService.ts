import { spawn } from "child_process";

/** A single commit as parsed from `git log`. */
export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: number; // unix seconds
  subject: string;
  refs: string[]; // branch/tag names pointing here
}

/** One entry in the working tree / index. */
export interface FileChange {
  path: string;
  /** git porcelain XY code, e.g. " M", "M ", "??", "A ". */
  index: string;
  worktree: string;
  staged: boolean;
}

export interface Branch {
  name: string;
  current: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
}

// ASCII field/record separators — safe because they can't appear in git output.
const FS = "\x1f";
const RS = "\x1e";

export class GitService {
  constructor(private readonly cwd: string) {}

  /** Run a git command, resolving with stdout. Rejects on non-zero exit. */
  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, { cwd: this.cwd });
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

  /** Working tree status via porcelain v1 (stable, script-friendly). */
  async getStatus(): Promise<FileChange[]> {
    const out = await this.run(["status", "--porcelain=v1", "-z"]);
    const parts = out.split("\0").filter(Boolean);
    const changes: FileChange[] = [];
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i];
      const index = entry[0];
      const worktree = entry[1];
      let path = entry.slice(3);
      // Renames/copies consume the next NUL-separated token (the source path).
      if (index === "R" || index === "C") {
        i++;
      }
      changes.push({
        path,
        index,
        worktree,
        staged: index !== " " && index !== "?",
      });
    }
    return changes;
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
  async getDiff(path: string, staged: boolean): Promise<string> {
    const args = ["diff"];
    if (staged) {
      args.push("--cached");
    }
    args.push("--", path);
    return this.run(args);
  }
}
