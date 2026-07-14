import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { FileChange } from "../../src/types";

// vscodeApi calls acquireVsCodeApi() at import time, which doesn't exist in
// jsdom — mock it so we can both load the component and assert on posts.
const post = vi.fn();
vi.mock("../vscodeApi", () => ({ post: (...args: unknown[]) => post(...args) }));

import { Changes } from "./Changes";
import type { MenuItem } from "./ContextMenu";

const noop = () => {};

const file = (over: Partial<FileChange>): FileChange => ({
  path: "a.txt",
  index: " ",
  worktree: "M",
  staged: false,
  conflicted: false,
  resolvable: false,
  ...over,
});

/** Render Changes, capturing whatever menu items a right-click produces. */
function renderChanges(status: FileChange[]) {
  let items: MenuItem[] = [];
  render(
    <Changes status={status} onCollapse={noop} onMenu={(_e, i) => (items = i)} />
  );
  return {
    menuFor: (path: string) => {
      fireEvent.contextMenu(screen.getByText(path));
      return items;
    },
  };
}

const labels = (items: MenuItem[]) =>
  items.filter((i) => i.label).map((i) => i.label);
const click = (items: MenuItem[], label: string) =>
  items.find((i) => i.label === label)?.onClick?.();

beforeEach(() => post.mockClear());
afterEach(cleanup);

describe("Changes file menu", () => {
  it("offers Stage / Commit / Discard on an unstaged file", () => {
    const { menuFor } = renderChanges([file({ path: "u.txt" })]);
    const items = menuFor("u.txt");
    expect(labels(items)).toEqual([
      "Stage",
      "Commit this file…",
      "Discard changes…",
    ]);
    click(items, "Stage");
    expect(post).toHaveBeenCalledWith({ type: "stage", path: "u.txt" });
  });

  it("offers Unstage on a staged file and posts commitFile / discardChanges", () => {
    const { menuFor } = renderChanges([
      file({ path: "s.txt", index: "M", worktree: " ", staged: true }),
    ]);
    const items = menuFor("s.txt");
    expect(labels(items)).toContain("Unstage");
    click(items, "Commit this file…");
    expect(post).toHaveBeenCalledWith({ type: "commitFile", path: "s.txt" });
    click(items, "Discard changes…");
    expect(post).toHaveBeenCalledWith({ type: "discardChanges", path: "s.txt" });
  });

  it("keeps the Undo Resolution menu for a resolvable staged file", () => {
    const { menuFor } = renderChanges([
      file({
        path: "r.txt",
        index: "M",
        worktree: " ",
        staged: true,
        resolvable: true,
      }),
    ]);
    const items = menuFor("r.txt");
    expect(labels(items)).toEqual(["Undo Resolution (redo merge)…"]);
  });
});
