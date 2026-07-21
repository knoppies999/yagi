import type { Commit } from "../src/types";

export const ROW_H = 26;
export const COL_W = 16;
export const LANE_COLORS = [
  "#e06c75", "#98c379", "#61afef", "#c678dd",
  "#e5c07b", "#56b6c2", "#d19a66", "#7f848e",
];

export interface Placed {
  commit: Commit;
  col: number;
}

/** A drawn connection from a child commit down to one of its parents. */
export interface Edge {
  fromRow: number;
  fromCol: number;
  /** Lane the line travels in between its two bends. */
  lane: number;
  /**
   * Where the parent actually sits. When the parent isn't loaded yet the
   * edge runs off the bottom: toRow === commits.length and toCol === lane.
   */
  toRow: number;
  toCol: number;
  /** Branch this segment belongs to, for the hover tooltip. Undefined when
   *  nothing names it (see labelling rules on assignLanes). */
  branch?: string;
}

/** A commit's own name: its first ref that isn't a tag. parseLog has already
 *  stripped the "HEAD -> " prefix, so the checked-out branch reads normally. */
function refLabel(c: Commit): string | undefined {
  return c.refs.find((r) => !r.startsWith("tag: "));
}

// A merged topic branch is usually deleted straight afterwards, leaving its
// commits with no ref at all — but git's default merge messages still name it.
// Recovering the name from the subject is a heuristic (someone can write any
// message they like), so it's only ever a fallback for a line that would
// otherwise be unlabelled.
const MERGE_SUBJECTS = [
  /^Merge remote-tracking branch '([^']+)'/,
  /^Merge branch '([^']+)'/,
  /^Merge pull request #\d+ from (\S+)/,
];

function mergedTopicName(subject: string): string | undefined {
  for (const re of MERGE_SUBJECTS) {
    const m = re.exec(subject);
    if (m) return m[1];
  }
  return undefined;
}

export interface Layout {
  placed: Placed[];
  edges: Edge[];
  rowByHash: Map<string, number>;
  maxCol: number;
}

/**
 * Greedy lane assignment. `lanes[i]` is the commit hash column i is waiting
 * to draw next. A commit takes the leftmost lane waiting for it — and every
 * OTHER lane waiting for it is freed too (they merge into the same node);
 * without that, each fork point leaks a lane that runs to the bottom of the
 * graph forever. Its first parent inherits its lane; extra parents join the
 * lane already waiting for them or branch into a free one.
 *
 * Edges are resolved in a second pass so each one ends at the column its
 * parent was actually placed in, which the child can't know at claim time.
 *
 * Each edge also gets a `branch` for its hover tooltip. A commit sits on every
 * branch that can reach it, so "the" branch of a line segment is a convention,
 * not a fact. The rule here is **the nearest branch tip at or above it**: a
 * commit carrying a ref names the line leaving it, and a commit without one
 * keeps the name handed down by the newest commit that reached it. So the
 * segments above `main`'s badge belong to whatever is ahead of main, and the
 * ones below it read as `main` — which is what the eye expects when tracing a
 * line past a label. Second parents instead start the merged-in topic's line,
 * named by that branch's own ref when it still exists and by what the merge
 * commit called it when it doesn't.
 */
export function assignLanes(commits: Commit[]): Layout {
  const lanes: (string | null)[] = [];
  const placed: Placed[] = [];
  const rowByHash = new Map<string, number>();
  commits.forEach((c, i) => rowByHash.set(c.hash, i));

  const firstFree = (): number => {
    const i = lanes.indexOf(null);
    return i === -1 ? lanes.length : i;
  };

  // hash -> branch owning the line that arrives at it. First writer wins.
  const labelByHash = new Map<string, string>();

  const pending: {
    fromRow: number;
    fromCol: number;
    lane: number;
    parent: string;
    branch?: string;
  }[] = [];

  for (let row = 0; row < commits.length; row++) {
    const c = commits[row];

    let col = -1;
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === c.hash) {
        if (col === -1) col = i;
        lanes[i] = null;
      }
    }
    if (col === -1) col = firstFree();

    // A ref on this commit renames the line from here down; without one the
    // line keeps whatever name reached it from above.
    const ownRef = refLabel(c);
    if (ownRef) labelByHash.set(c.hash, ownRef);
    const label = labelByHash.get(c.hash);

    c.parents.forEach((p, i) => {
      let lane: number;
      if (i === 0) {
        lane = col;
      } else {
        const existing = lanes.indexOf(p);
        lane = existing !== -1 ? existing : firstFree();
      }
      lanes[lane] = p;
      if (!labelByHash.has(p)) {
        // First parent continues this line; the rest start the merged-in
        // topic's line, which is named by the parent itself when it still has
        // a ref, and otherwise by what the merge commit called it.
        const parentRow = rowByHash.get(p);
        const parentRef =
          parentRow === undefined ? undefined : refLabel(commits[parentRow]);
        const inherited =
          i === 0 ? label : parentRef ?? mergedTopicName(c.subject);
        if (inherited) labelByHash.set(p, inherited);
      }
      pending.push({
        fromRow: row,
        fromCol: col,
        lane,
        parent: p,
        branch: labelByHash.get(p),
      });
    });

    placed.push({ commit: c, col });
  }

  const edges: Edge[] = pending.map((e) => {
    const toRow = rowByHash.get(e.parent);
    return toRow === undefined
      ? { fromRow: e.fromRow, fromCol: e.fromCol, lane: e.lane, toRow: commits.length, toCol: e.lane, branch: e.branch }
      : { fromRow: e.fromRow, fromCol: e.fromCol, lane: e.lane, toRow, toCol: placed[toRow].col, branch: e.branch };
  });

  let maxCol = 0;
  for (const p of placed) maxCol = Math.max(maxCol, p.col);
  for (const e of edges) maxCol = Math.max(maxCol, e.lane);
  return { placed, edges, rowByHash, maxCol };
}
