import { describe, it, expect } from "vitest";
import {
  rememberConflict,
  getCachedStages,
  hasCachedStages,
  clearConflictCache,
  ConflictStage,
} from "./conflictCache";

const stages: ConflictStage[] = [
  { mode: "100644", sha: "a".repeat(40), stage: 1 },
  { mode: "100644", sha: "b".repeat(40), stage: 2 },
  { mode: "100644", sha: "c".repeat(40), stage: 3 },
];

describe("conflictCache", () => {
  it("remembers and returns a path's stages, keyed by repo root", () => {
    const root = "/repo/a";
    rememberConflict(root, "file.txt", stages);
    expect(hasCachedStages(root, "file.txt")).toBe(true);
    expect(getCachedStages(root, "file.txt")).toEqual(stages);
    clearConflictCache(root);
  });

  it("isolates caches by root", () => {
    rememberConflict("/repo/x", "shared.txt", stages);
    expect(hasCachedStages("/repo/y", "shared.txt")).toBe(false);
    clearConflictCache("/repo/x");
  });

  it("overwrites a prior remembering of the same path", () => {
    const root = "/repo/b";
    rememberConflict(root, "f", stages);
    const newer: ConflictStage[] = [{ mode: "100644", sha: "d".repeat(40), stage: 2 }];
    rememberConflict(root, "f", newer);
    expect(getCachedStages(root, "f")).toEqual(newer);
    clearConflictCache(root);
  });

  it("clearConflictCache drops everything for a root", () => {
    const root = "/repo/c";
    rememberConflict(root, "f", stages);
    clearConflictCache(root);
    expect(hasCachedStages(root, "f")).toBe(false);
    expect(getCachedStages(root, "f")).toBeUndefined();
  });
});
