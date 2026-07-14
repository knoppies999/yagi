import { useEffect, useMemo, useRef, useState } from "react";
import type { Commit } from "../../src/types";
import { post } from "../vscodeApi";
import { assignLanes, LANE_COLORS, ROW_H, COL_W } from "../graph";
import type { MenuItem } from "./ContextMenu";

const OVERSCAN = 10; // rows rendered above/below the viewport

// Commit timestamps are absolute (unix seconds); render them in the viewer's
// local timezone — same basis as the details panel, just without seconds.
const fmtWhen = (unixSec: number) =>
  new Date(unixSec * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function Graph({
  commits,
  currentBranch,
  selected,
  hasMore,
  loading,
  onSelect,
  onLoadMore,
  onMenu,
}: {
  commits: Commit[];
  currentBranch: string;
  selected?: string;
  hasMore: boolean;
  loading: boolean;
  onSelect: (hash: string) => void;
  onLoadMore: () => void;
  onMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);

  const { placed, edges: layoutEdges, maxCol } = useMemo(
    () => assignLanes(commits),
    [commits]
  );
  const total = placed.length;
  const graphW = (maxCol + 1) * COL_W + COL_W;
  const totalH = total * ROW_H;

  // Track the scroll container's height so the visible window is accurate.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(total, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN);

  const x = (col: number) => col * COL_W + COL_W / 2;
  const y = (row: number) => row * ROW_H + ROW_H / 2;

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setScrollTop(el.scrollTop);
    // Auto-load when close to the bottom.
    if (
      hasMore &&
      !loading &&
      el.scrollHeight - (el.scrollTop + el.clientHeight) < ROW_H * 12
    ) {
      onLoadMore();
    }
  };

  const menuFor = (c: Commit): MenuItem[] => {
    const isMerge = c.parents.length > 1;
    const isBranchTip = c.refs.includes(currentBranch);
    return [
    {
      label: "Cherry-pick onto current branch",
      onClick: () => post({ type: "cherryPick", hash: c.hash }),
    },
    { label: "Revert commit", onClick: () => post({ type: "revert", hash: c.hash }) },
    ...(isMerge && isBranchTip
      ? [
          {
            label: "Undo This Merge (reset to before it)",
            danger: true,
            onClick: () => post({ type: "undoMerge" }),
          } satisfies MenuItem,
        ]
      : []),
    {
      label: "Rebase interactively from here…",
      onClick: () => post({ type: "requestRebase", base: c.hash }),
    },
    { separator: true },
    {
      label: "Create branch here…",
      onClick: () => post({ type: "createBranch", startPoint: c.hash }),
    },
    {
      label: `Reset ${currentBranch || "HEAD"} here (mixed)`,
      onClick: () => post({ type: "reset", hash: c.hash, mode: "mixed" }),
    },
    {
      label: `Reset ${currentBranch || "HEAD"} here (hard)`,
      danger: true,
      onClick: () => post({ type: "reset", hash: c.hash, mode: "hard" }),
    },
    ];
  };

  // Child node → bend into the travel lane → vertical run → bend into the
  // parent node's actual column.
  const edgePath = (e: { fromRow: number; fromCol: number; lane: number; toRow: number; toCol: number }) => {
    const x1 = x(e.fromCol);
    const xl = x(e.lane);
    const x2 = x(e.toCol);
    const y1 = y(e.fromRow);
    const y2 = y(e.toRow);
    if (e.toRow - e.fromRow <= 1) {
      return `M ${x1} ${y1} C ${x1} ${y1 + ROW_H / 2} ${x2} ${y2 - ROW_H / 2} ${x2} ${y2}`;
    }
    let d = `M ${x1} ${y1}`;
    if (x1 !== xl) d += ` C ${x1} ${y1 + ROW_H} ${xl} ${y1} ${xl} ${y1 + ROW_H}`;
    d += ` L ${xl} ${y2 - ROW_H}`;
    if (xl !== x2) d += ` C ${xl} ${y2} ${x2} ${y2 - ROW_H} ${x2} ${y2}`;
    else d += ` L ${x2} ${y2}`;
    return d;
  };

  // Edges are windowed by their whole span, not their endpoints — a
  // long-running branch must keep its line while both ends are offscreen.
  const edges: React.ReactNode[] = [];
  layoutEdges.forEach((e, i) => {
    if (e.toRow < start || e.fromRow >= end) return;
    edges.push(
      <path
        key={i}
        d={edgePath(e)}
        fill="none"
        stroke={LANE_COLORS[e.lane % LANE_COLORS.length]}
        strokeWidth={2}
      />
    );
  });

  // Nodes + rows only for the visible window.
  const nodes: React.ReactNode[] = [];
  const rows: React.ReactNode[] = [];

  for (let row = start; row < end; row++) {
    const p = placed[row];
    const c = p.commit;

    nodes.push(
      <circle
        key={c.hash}
        cx={x(p.col)}
        cy={y(row)}
        r={4}
        fill={LANE_COLORS[p.col % LANE_COLORS.length]}
        stroke="var(--vscode-editor-background)"
        strokeWidth={1.5}
      />
    );

    rows.push(
      <div
        key={c.hash}
        className={"commit-row" + (selected === c.hash ? " selected" : "")}
        style={{ position: "absolute", top: row * ROW_H, left: graphW, right: 0, height: ROW_H }}
        onClick={() => onSelect(c.hash)}
        onContextMenu={(e) => onMenu(e, menuFor(c))}
      >
        {c.refs.map((r) => (
          <span
            key={r}
            className={"ref" + (r === currentBranch ? " ref-current" : "")}
          >
            {r}
          </span>
        ))}
        <span className="subject">{c.subject}</span>
        <span className="meta">
          <span className="commit-date">{fmtWhen(c.date)}</span> · {c.author} ·{" "}
          {c.hash.slice(0, 7)}
        </span>
      </div>
    );
  }

  return (
    <div className="graph-scroll" ref={scrollRef} onScroll={onScroll}>
      <div className="graph-virtual" style={{ height: totalH }}>
        <svg className="graph-svg" width={graphW} height={totalH}>
          {edges}
          {nodes}
        </svg>
        {rows}
      </div>
      {hasMore && (
        <div className="load-more">
          <button disabled={loading} onClick={onLoadMore}>
            {loading ? "Loading…" : "Load more commits"}
          </button>
        </div>
      )}
    </div>
  );
}
