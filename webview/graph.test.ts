import { describe, it, expect } from "vitest";
import { assignLanes } from "./graph";
import type { Commit } from "../src/types";

const c = (hash: string, parents: string[]): Commit => ({
  hash,
  parents,
  author: "a",
  email: "e@x.com",
  date: 0,
  subject: hash,
  refs: [],
});

describe("assignLanes", () => {
  it("returns an empty layout for empty input", () => {
    const layout = assignLanes([]);
    expect(layout.placed).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.rowByHash.size).toBe(0);
    expect(layout.maxCol).toBe(0);
  });

  it("keeps a linear chain in lane 0", () => {
    const layout = assignLanes([
      c("c3", ["c2"]),
      c("c2", ["c1"]),
      c("c1", []),
    ]);
    expect(layout.placed.map((p) => p.col)).toEqual([0, 0, 0]);
    expect(layout.maxCol).toBe(0);
    expect(layout.rowByHash.get("c3")).toBe(0);
    expect(layout.rowByHash.get("c1")).toBe(2);
  });

  it("opens a second lane for a divergent branch tip", () => {
    // Two tips off a shared base, never merged.
    const layout = assignLanes([
      c("t1", ["base"]),
      c("t2", ["base"]),
      c("base", []),
    ]);
    const col = (h: string) =>
      layout.placed[layout.rowByHash.get(h)!].col;
    expect(col("t1")).toBe(0);
    expect(col("t2")).toBe(1); // opened a new lane
    expect(col("base")).toBe(0); // base rejoins lane 0
    expect(layout.maxCol).toBe(1);
  });

  it("gives a merge commit's second parent its own lane (diamond)", () => {
    // m -> (a, b) -> base
    const layout = assignLanes([
      c("m", ["a", "b"]),
      c("a", ["base"]),
      c("b", ["base"]),
      c("base", []),
    ]);
    const col = (h: string) => layout.placed[layout.rowByHash.get(h)!].col;
    expect(col("m")).toBe(0);
    expect(col("a")).toBe(0);
    expect(col("b")).toBe(1);
    expect(col("base")).toBe(0);
    expect(layout.maxCol).toBe(1);
    expect(layout.rowByHash.size).toBe(4);
    // First parent inherits the merge's lane; second parent branches out.
    expect(layout.edges).toContainEqual({
      fromRow: 0, fromCol: 0, lane: 0, toRow: 1, toCol: 0,
    });
    expect(layout.edges).toContainEqual({
      fromRow: 0, fromCol: 0, lane: 1, toRow: 2, toCol: 1,
    });
  });

  it("frees EVERY lane waiting on a fork point, not just the first", () => {
    // t1 (lane 0) and t2 (lane 1) both descend from base. Once base is
    // placed, both lanes must be free again — the old greedy code leaked
    // lane 1 forever, so each fork left a parallel line to the bottom.
    const layout = assignLanes([
      c("t1", ["base"]),
      c("t2", ["base"]),
      c("base", ["older"]),
      c("x", []), // unrelated root; must be able to reuse lane 1
      c("older", []),
    ]);
    const col = (h: string) => layout.placed[layout.rowByHash.get(h)!].col;
    expect(col("base")).toBe(0);
    expect(col("x")).toBe(1); // lane 1 was released by base
  });

  it("routes a branch's edge into the column its parent was placed in", () => {
    // t2 claims lane 1 for base, but base lands in lane 0 (t1 got there
    // first). The edge must travel in lane 1 and END at column 0 — the old
    // code ended it at column 1, so branches never visually joined main.
    const layout = assignLanes([
      c("t1", ["base"]),
      c("t2", ["base"]),
      c("base", []),
    ]);
    expect(layout.edges).toContainEqual({
      fromRow: 1, fromCol: 1, lane: 1, toRow: 2, toCol: 0,
    });
  });

  it("runs an edge to an unloaded parent off the bottom of the graph", () => {
    const layout = assignLanes([c("tip", ["missing"])]);
    expect(layout.edges).toEqual([
      { fromRow: 0, fromCol: 0, lane: 0, toRow: 1, toCol: 0 },
    ]);
  });

  it("merges a second parent into a lane already waiting for it", () => {
    // feat (lane 0) awaits base; the merge's second parent is also base,
    // so its edge shares lane 0 instead of opening a third lane.
    const layout = assignLanes([
      c("feat", ["base"]),
      c("m", ["a", "base"]),
      c("a", ["base"]),
      c("base", []),
    ]);
    // Rows: feat=0 (lane 0), m=1 (lane 1), a=2 (lane 1), base=3 (lane 0).
    expect(layout.edges).toContainEqual({
      fromRow: 1, fromCol: 1, lane: 0, toRow: 3, toCol: 0,
    });
    expect(layout.maxCol).toBe(1);
  });

  it("counts lanes used only by passing edges in maxCol", () => {
    // The merge's second-parent line travels in lane 1 even though no
    // commit node ever sits there (base lands in lane 0).
    const layout = assignLanes([
      c("m", ["a", "base"]),
      c("a", ["base"]),
      c("base", []),
    ]);
    expect(layout.placed.map((p) => p.col)).toEqual([0, 0, 0]);
    expect(layout.maxCol).toBe(1);
  });
});
