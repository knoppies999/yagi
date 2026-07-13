import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// vscodeApi calls acquireVsCodeApi() at import time, which doesn't exist in
// jsdom — mock the whole module so we can both load the component and assert
// on the messages it posts.
const post = vi.fn();
vi.mock("../vscodeApi", () => ({ post: (...args: unknown[]) => post(...args) }));

import { OpBanner } from "./OpBanner";

beforeEach(() => post.mockClear());
afterEach(cleanup);

describe("OpBanner", () => {
  it("renders nothing when there is no operation", () => {
    const { container } = render(<OpBanner operation={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a conflict count and no Continue button while paused", () => {
    render(<OpBanner operation={{ type: "merge", conflicted: ["a.txt", "b.txt"] }} />);
    expect(screen.getByText(/2 conflicts to resolve/)).toBeDefined();
    expect(screen.queryByText("Continue")).toBeNull();
  });

  it("offers Continue once conflicts are resolved and posts continueOp", () => {
    render(<OpBanner operation={{ type: "merge", conflicted: [] }} />);
    fireEvent.click(screen.getByText("Continue"));
    expect(post).toHaveBeenCalledWith({ type: "continueOp", op: "merge" });
  });

  it("shows Skip for rebase and posts skipOp", () => {
    render(<OpBanner operation={{ type: "rebase", conflicted: ["x"] }} />);
    fireEvent.click(screen.getByText("Skip"));
    expect(post).toHaveBeenCalledWith({ type: "skipOp", op: "rebase" });
  });

  it("does not show Skip for a merge", () => {
    render(<OpBanner operation={{ type: "merge", conflicted: ["x"] }} />);
    expect(screen.queryByText("Skip")).toBeNull();
  });

  it("Abort always posts abortOp", () => {
    render(<OpBanner operation={{ type: "revert", conflicted: ["x"] }} />);
    fireEvent.click(screen.getByText("Abort"));
    expect(post).toHaveBeenCalledWith({ type: "abortOp", op: "revert" });
  });
});
