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

  const pending: { fromRow: number; fromCol: number; lane: number; parent: string }[] = [];

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

    c.parents.forEach((p, i) => {
      let lane: number;
      if (i === 0) {
        lane = col;
      } else {
        const existing = lanes.indexOf(p);
        lane = existing !== -1 ? existing : firstFree();
      }
      lanes[lane] = p;
      pending.push({ fromRow: row, fromCol: col, lane, parent: p });
    });

    placed.push({ commit: c, col });
  }

  const edges: Edge[] = pending.map((e) => {
    const toRow = rowByHash.get(e.parent);
    return toRow === undefined
      ? { fromRow: e.fromRow, fromCol: e.fromCol, lane: e.lane, toRow: commits.length, toCol: e.lane }
      : { fromRow: e.fromRow, fromCol: e.fromCol, lane: e.lane, toRow, toCol: placed[toRow].col };
  });

  let maxCol = 0;
  for (const p of placed) maxCol = Math.max(maxCol, p.col);
  for (const e of edges) maxCol = Math.max(maxCol, e.lane);
  return { placed, edges, rowByHash, maxCol };
}
