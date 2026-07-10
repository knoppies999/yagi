import { useCallback, useRef, useState } from "react";
import type { Layout } from "./messages";
import { post } from "./vscodeApi";

export const DEFAULT_LAYOUT: Layout = {
  sidebar: 210,
  changes: 330,
  details: 240,
  collapsedSidebar: false,
  collapsedChanges: false,
  collapsedDetails: false,
};

export type CollapseKey =
  | "collapsedSidebar"
  | "collapsedChanges"
  | "collapsedDetails";

// Min/max px per handle so panes can't collapse or eat the whole window.
const LIMITS = {
  sidebar: [140, 500] as const,
  changes: [200, 640] as const,
  details: [90, 600] as const,
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

type Handle = keyof Layout;

export function useResizableLayout() {
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const gridRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLElement>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const dragging = useRef<Handle | null>(null);

  /** Merge a persisted layout (from the host) over the defaults. */
  const applySaved = useCallback((saved: Layout | null) => {
    if (saved) {
      setLayout({ ...DEFAULT_LAYOUT, ...saved });
    }
  }, []);

  /** Toggle a collapse flag and persist immediately. */
  const toggleCollapse = useCallback((key: CollapseKey) => {
    const next = { ...layoutRef.current, [key]: !layoutRef.current[key] };
    layoutRef.current = next;
    setLayout(next);
    post({ type: "saveLayout", layout: next });
  }, []);

  const onMove = useCallback((e: PointerEvent) => {
    const handle = dragging.current;
    const grid = gridRef.current;
    if (!handle || !grid) return;
    const r = grid.getBoundingClientRect();
    setLayout((prev) => {
      const next = { ...prev };
      if (handle === "sidebar") {
        next.sidebar = clamp(e.clientX - r.left, ...LIMITS.sidebar);
      } else if (handle === "changes") {
        next.changes = clamp(r.right - e.clientX, ...LIMITS.changes);
      } else {
        const pane = paneRef.current?.getBoundingClientRect();
        if (pane) {
          const max = Math.min(LIMITS.details[1], pane.height - 140);
          next.details = clamp(pane.bottom - e.clientY, LIMITS.details[0], max);
        }
      }
      return next;
    });
  }, []);

  const onUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.classList.remove("resizing-v", "resizing-h");
    post({ type: "saveLayout", layout: layoutRef.current });
  }, [onMove]);

  const startDrag = useCallback(
    (handle: Handle) => (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = handle;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      document.body.classList.add(handle === "details" ? "resizing-h" : "resizing-v");
    },
    [onMove, onUp]
  );

  return { layout, applySaved, toggleCollapse, startDrag, gridRef, paneRef };
}
