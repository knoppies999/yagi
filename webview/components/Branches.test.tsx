import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Branch } from "../../src/types";

// vscodeApi calls acquireVsCodeApi() at import time, which doesn't exist in
// jsdom — mock it so the component loads.
const post = vi.fn();
vi.mock("../vscodeApi", () => ({ post: (...args: unknown[]) => post(...args) }));

import { Branches } from "./Branches";
import type { MenuItem } from "./ContextMenu";

const noop = () => {};

/** `n` branches named b0..b(n-1), newest-first, with b0 current by default. */
function makeBranches(n: number, currentIdx = 0): Branch[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `b${i}`,
    current: i === currentIdx,
    remote: false,
    ahead: 0,
    behind: 0,
  }));
}

const remoteBranch = (name: string): Branch => ({
  name,
  current: false,
  remote: true,
  ahead: 0,
  behind: 0,
});

/** Render with sensible defaults; override just what a test cares about. */
function renderBranches(
  branches: Branch[],
  limit: number,
  extra: { selected?: string[]; onSelect?: (names: string[]) => void } = {}
) {
  return render(
    <Branches
      branches={branches}
      limit={limit}
      selected={extra.selected ?? []}
      onSelect={extra.onSelect ?? noop}
      onMenu={noop}
      onCollapse={noop}
    />
  );
}

const shownNames = () =>
  screen.getAllByText(/^b\d+$/).map((el) => el.textContent);

beforeEach(() => post.mockClear());
afterEach(cleanup);

describe("Branches limiting", () => {
  it("shows only the newest `limit` branches by default", () => {
    renderBranches(makeBranches(30), 25);
    expect(shownNames()).toHaveLength(25);
    expect(screen.getByText(/Show all \(5 more\)/)).toBeDefined();
  });

  it("expands to all branches when 'Show all' is clicked, then collapses again", () => {
    renderBranches(makeBranches(30), 25);
    fireEvent.click(screen.getByText(/Show all/));
    expect(shownNames()).toHaveLength(30);
    fireEvent.click(screen.getByText("Show fewer"));
    expect(shownNames()).toHaveLength(25);
  });

  it("keeps the current branch visible even when it's outside the limit", () => {
    // Current branch is the oldest (index 29), well past a limit of 3.
    renderBranches(makeBranches(30, 29), 3);
    const names = shownNames();
    expect(names).toContain("b29");
    // 3 newest + the pinned current branch.
    expect(names).toHaveLength(4);
  });

  it("limit of 0 shows every branch with no toggle", () => {
    renderBranches(makeBranches(30), 0);
    expect(shownNames()).toHaveLength(30);
    expect(screen.queryByText(/Show all/)).toBeNull();
  });

  it("filtering searches all branches, ignoring the limit", () => {
    renderBranches(makeBranches(30), 5);
    // b27 is well past the limit of 5, but the filter still finds it.
    fireEvent.change(screen.getByPlaceholderText(/Filter branches/), {
      target: { value: "b27" },
    });
    expect(shownNames()).toEqual(["b27"]);
    expect(screen.queryByText(/Show all/)).toBeNull();
  });
});

describe("Branches local vs remote", () => {
  it("groups into Local and Remote sections when both are present", () => {
    renderBranches([...makeBranches(2), remoteBranch("origin/api")], 0);
    expect(screen.getByText("Local")).toBeDefined();
    expect(screen.getByText("Remote")).toBeDefined();
    expect(screen.getByText("origin/api")).toBeDefined();
  });

  it("omits section headers when there are no remote branches", () => {
    renderBranches(makeBranches(3), 0);
    expect(screen.queryByText("Local")).toBeNull();
    expect(screen.queryByText("Remote")).toBeNull();
  });

  it("caps local and remote independently so remotes can't crowd out locals", () => {
    // Remotes sort ahead of the locals (newer), so a single combined cap of 2
    // would show 0 locals. Per-group capping must still show 2 locals.
    const branches: Branch[] = [
      remoteBranch("origin/r0"),
      remoteBranch("origin/r1"),
      remoteBranch("origin/r2"),
      remoteBranch("origin/r3"),
      ...makeBranches(3), // b0 (current), b1, b2
    ];
    renderBranches(branches, 2);
    // 2 locals shown (b0, b1) even though 4 newer remotes exist.
    expect(screen.getByText("b0")).toBeDefined();
    expect(screen.getByText("b1")).toBeDefined();
    // 2 of the 4 remotes shown.
    expect(screen.getByText("origin/r0")).toBeDefined();
    expect(screen.getByText("origin/r1")).toBeDefined();
    expect(screen.queryByText("origin/r2")).toBeNull();
    // 3 hidden (1 local + 2 remotes).
    expect(screen.getByText(/Show all \(3 more\)/)).toBeDefined();
  });

  it("offers a DWIM local-name checkout for a remote branch via the menu", () => {
    let items: MenuItem[] = [];
    render(
      <Branches
        branches={[remoteBranch("origin/feature/api")]}
        limit={0}
        selected={[]}
        onSelect={noop}
        onMenu={(_e, i) => (items = i)}
        onCollapse={noop}
      />
    );
    fireEvent.contextMenu(screen.getByText("origin/feature/api"));
    const checkout = items.find((i) => i.label?.startsWith("Checkout feature/api"));
    checkout?.onClick?.();
    expect(post).toHaveBeenCalledWith({ type: "checkout", branch: "feature/api" });
  });
});

describe("Branches graph selection", () => {
  const checkboxes = () =>
    screen.getAllByRole("checkbox") as HTMLInputElement[];

  it("clicking a branch row selects it for the graph and never checks out", () => {
    const onSelect = vi.fn();
    renderBranches(makeBranches(3), 0, { onSelect });
    fireEvent.click(screen.getByText("b1"));
    expect(onSelect).toHaveBeenCalledWith(["b1"]);
    // Crucially, a plain click must not switch branches.
    expect(post).not.toHaveBeenCalled();
  });

  it("even the current branch toggles selection on click (no checkout)", () => {
    const onSelect = vi.fn();
    renderBranches(makeBranches(3), 0, { onSelect });
    fireEvent.click(screen.getByText("b0"));
    expect(onSelect).toHaveBeenCalledWith(["b0"]);
    expect(post).not.toHaveBeenCalled();
  });

  it("unchecking a selected branch removes it from the selection", () => {
    const onSelect = vi.fn();
    renderBranches(makeBranches(3), 0, { selected: ["b1", "b2"], onSelect });
    fireEvent.click(checkboxes()[1]);
    expect(onSelect).toHaveBeenCalledWith(["b2"]);
  });

  it("reflects the applied selection and clears it via 'Show all'", () => {
    const onSelect = vi.fn();
    renderBranches(makeBranches(3), 0, { selected: ["b1", "b2"], onSelect });
    expect(screen.getByText(/Graph limited to 2 branches/)).toBeDefined();
    expect(checkboxes()[1].checked).toBe(true);
    fireEvent.click(screen.getByText("Show all"));
    expect(onSelect).toHaveBeenCalledWith([]);
  });

  it("keeps a selected branch visible even when it's outside the limit", () => {
    // b29 is oldest, past the limit of 3, but selected -> must stay shown.
    renderBranches(makeBranches(30, 0), 3, { selected: ["b29"] });
    expect(shownNames()).toContain("b29");
  });
});
