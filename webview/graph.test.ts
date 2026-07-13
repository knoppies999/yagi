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
    const rowM = layout.placed[layout.rowByHash.get("m")!];
    expect(rowM.col).toBe(0);
    // First parent inherits the merge's lane; second parent branches out.
    expect(rowM.parentCols).toEqual([
      { hash: "a", col: 0 },
      { hash: "b", col: 1 },
    ]);
    const col = (h: string) => layout.placed[layout.rowByHash.get(h)!].col;
    expect(col("a")).toBe(0);
    expect(col("b")).toBe(1);
    expect(col("base")).toBe(0);
    expect(layout.maxCol).toBe(1);
    expect(layout.rowByHash.size).toBe(4);
  });
});
