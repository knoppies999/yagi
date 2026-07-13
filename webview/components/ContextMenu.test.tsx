import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ContextMenu } from "./ContextMenu";

afterEach(cleanup);

describe("ContextMenu", () => {
  it("renders nothing when there is no menu", () => {
    const { container } = render(<ContextMenu menu={null} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders its items and separators", () => {
    render(
      <ContextMenu
        menu={{
          x: 10,
          y: 20,
          items: [{ label: "Checkout" }, { separator: true }, { label: "Delete", danger: true }],
        }}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("Checkout")).toBeDefined();
    expect(screen.getByText("Delete").className).toContain("danger");
  });

  it("fires the item's onClick and then closes", () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        menu={{ x: 0, y: 0, items: [{ label: "Merge", onClick }] }}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByText("Merge"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });
});
