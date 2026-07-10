import { useEffect, useMemo, useRef, useState } from "react";
import type { Commit } from "../../src/types";
import { post } from "../vscodeApi";
import { assignLanes, LANE_COLORS, ROW_H, COL_W } from "../graph";
import type { MenuItem } from "./ContextMenu";

const OVERSCAN = 10; // rows rendered above/below the viewport

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

  const { placed, rowByHash, maxCol } = useMemo(
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

  const menuFor = (c: Commit): MenuItem[] => [
    {
      label: "Cherry-pick onto current branch",
      onClick: () => post({ type: "cherryPick", hash: c.hash }),
    },
    { label: "Revert commit", onClick: () => post({ type: "revert", hash: c.hash }) },
    {
      label: "Rebase interactively from here…",
      onClick: () => post({ type: "requestRebase", base: c.hash }),
    },
    { separator: true },
    {
      label: "Create branch here…",
      onClick: () => post({ type: "createBranch", hash: c.hash }),
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

  // Build SVG segments + rows only for the visible window.
  const edges: React.ReactNode[] = [];
  const nodes: React.ReactNode[] = [];
  const rows: React.ReactNode[] = [];

  for (let row = start; row < end; row++) {
    const p = placed[row];
    const c = p.commit;

    for (const pc of p.parentCols) {
      const prow = rowByHash.get(pc.hash);
      if (prow === undefined) continue; // parent not loaded yet
      const x1 = x(p.col);
      const y1 = y(row);
      const x2 = x(pc.col);
      const y2 = y(prow);
      edges.push(
        <path
          key={c.hash + pc.hash}
          d={`M ${x1} ${y1} C ${x1} ${y1 + ROW_H} ${x2} ${y2 - ROW_H} ${x2} ${y2}`}
          fill="none"
          stroke={LANE_COLORS[pc.col % LANE_COLORS.length]}
          strokeWidth={2}
        />
      );
    }

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
          {c.author} · {c.hash.slice(0, 7)}
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
