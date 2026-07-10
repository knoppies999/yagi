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
  parentCols: { hash: string; col: number }[];
}

export interface Layout {
  placed: Placed[];
  rowByHash: Map<string, number>;
  maxCol: number;
}

/**
 * Greedy lane assignment. `lanes[i]` is the commit hash column i is waiting
 * to draw next. A commit takes the lane waiting for it; its first parent
 * inherits that lane, extra parents branch into new lanes.
 */
export function assignLanes(commits: Commit[]): Layout {
  const lanes: (string | null)[] = [];
  const placed: Placed[] = [];

  const claimLane = (hash: string): number => {
    let idx = lanes.indexOf(hash);
    if (idx === -1) {
      idx = lanes.indexOf(null);
      if (idx === -1) idx = lanes.length;
    }
    return idx;
  };

  for (const c of commits) {
    let col = lanes.indexOf(c.hash);
    if (col === -1) {
      col = lanes.indexOf(null);
      if (col === -1) col = lanes.length;
    }
    lanes[col] = null;

    const parentCols: { hash: string; col: number }[] = [];
    c.parents.forEach((p, i) => {
      let pc: number;
      if (i === 0) {
        pc = col;
        lanes[col] = p;
      } else {
        pc = claimLane(p);
        lanes[pc] = p;
      }
      parentCols.push({ hash: p, col: pc });
    });

    placed.push({ commit: c, col, parentCols });
  }

  const rowByHash = new Map<string, number>();
  placed.forEach((p, i) => rowByHash.set(p.commit.hash, i));
  const maxCol = placed.reduce((m, p) => Math.max(m, p.col), 0);
  return { placed, rowByHash, maxCol };
}
