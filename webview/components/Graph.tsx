import { useEffect, useMemo, useRef, useState } from "react";
import type { Commit, MergedBranch } from "../../src/types";
import { assignLanes, LANE_COLORS, ROW_H, COL_W } from "../graph";
import { commitMenuItems, fmtWhen } from "../commitMenu";
import type { MenuItem } from "./ContextMenu";

const OVERSCAN = 10; // rows rendered above/below the viewport

// Squash/rebase-merge lines get one distinct, solid colour so they read as a
// deliberate "this branch merged here" marker rather than a normal lane edge.
const MERGE_EDGE_COLOR = "#b180d7";

// Hover target width for graph lines. Wider than COL_W would make neighbouring
// lanes fight over the pointer, so it stays just under it.
const EDGE_HOVER_W = 12;

export function Graph({
  commits,
  currentBranch,
  merged,
  connectors,
  selected,
  hasMore,
  loading,
  onSelect,
  onLoadMore,
  onMenu,
}: {
  commits: Commit[];
  currentBranch: string;
  merged: MergedBranch[];
  /** Commits from unselected branches, present only to link two selected
   *  branches together. Dimmed so they read as context, not selection. */
  connectors: string[];
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

  const { placed, edges: layoutEdges, rowByHash, maxCol } = useMemo(
    () => assignLanes(commits),
    [commits]
  );
  // Merged branches indexed by name (for the tip badge) — small list.
  const mergedByName = useMemo(
    () => new Map(merged.map((m) => [m.branch, m])),
    [merged]
  );
  const connectorSet = useMemo(() => new Set(connectors), [connectors]);
  // An edge is part of a connecting line when either end is — the segment
  // leaving a selected branch into a connector belongs to the detour too.
  const isConnectorRow = (row: number) =>
    row >= 0 && row < placed.length && connectorSet.has(placed[row].commit.hash);
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

  const menuFor = (c: Commit): MenuItem[] => commitMenuItems(c, currentBranch);

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
  // Invisible, much wider copies of each labelled edge, carrying the tooltip.
  // A 2px line is near-impossible to hover deliberately; these give it a
  // realistic target without changing what's drawn. Rendered after the visible
  // paths so they sit on top and actually receive the pointer.
  const hitAreas: React.ReactNode[] = [];
  layoutEdges.forEach((e, i) => {
    if (e.toRow < start || e.fromRow >= end) return;
    const d = edgePath(e);
    const dim = isConnectorRow(e.fromRow) || isConnectorRow(e.toRow);
    edges.push(
      <path
        key={i}
        d={d}
        fill="none"
        stroke={LANE_COLORS[e.lane % LANE_COLORS.length]}
        strokeWidth={dim ? 1.5 : 2}
        strokeDasharray={dim ? "3 3" : undefined}
        opacity={dim ? 0.45 : 1}
      />
    );
    if (e.branch) {
      hitAreas.push(
        <path
          key={`hit:${i}`}
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={EDGE_HOVER_W}
          pointerEvents="stroke"
        >
          <title>{e.branch}</title>
        </path>
      );
    }
  });

  // Synthetic squash/rebase-merge lines: no git ancestry links them, so draw
  // from the absorbing commit on the target down to the merged branch's tip.
  // Both endpoints must be loaded rows; skip when the pair is fully offscreen.
  merged.forEach((m) => {
    const fromRow = rowByHash.get(m.mergeCommit); // absorbing commit (newer)
    const toRow = rowByHash.get(m.tip); // branch tip (older)
    if (fromRow === undefined || toRow === undefined) return;
    const lo = Math.min(fromRow, toRow);
    const hi = Math.max(fromRow, toRow);
    if (hi < start || lo >= end) return;
    edges.push(
      <path
        key={`merged:${m.branch}`}
        d={edgePath({
          fromRow,
          fromCol: placed[fromRow].col,
          lane: placed[toRow].col,
          toRow,
          toCol: placed[toRow].col,
        })}
        fill="none"
        stroke={MERGE_EDGE_COLOR}
        strokeWidth={2}
      >
        <title>
          {m.branch} {m.kind}-merged into {m.into}
        </title>
      </path>
    );
  });

  // Nodes + rows only for the visible window.
  const nodes: React.ReactNode[] = [];
  const rows: React.ReactNode[] = [];

  for (let row = start; row < end; row++) {
    const p = placed[row];
    const c = p.commit;
    const dim = connectorSet.has(c.hash);

    nodes.push(
      <circle
        key={c.hash}
        cx={x(p.col)}
        cy={y(row)}
        r={dim ? 3 : 4}
        fill={LANE_COLORS[p.col % LANE_COLORS.length]}
        stroke="var(--vscode-editor-background)"
        strokeWidth={1.5}
        opacity={dim ? 0.45 : 1}
      />
    );

    rows.push(
      <div
        key={c.hash}
        className={
          "commit-row" +
          (selected === c.hash ? " selected" : "") +
          (dim ? " connector" : "")
        }
        title={
          dim
            ? "On a branch you didn't select — shown to link two selected branches"
            : undefined
        }
        style={{ position: "absolute", top: row * ROW_H, left: graphW, right: 0, height: ROW_H }}
        onClick={() => onSelect(c.hash)}
        onContextMenu={(e) => onMenu(e, menuFor(c))}
      >
        {c.refs.map((r) => {
          const m = mergedByName.get(r);
          return (
            <span
              key={r}
              className={
                "ref" +
                (r === currentBranch ? " ref-current" : "") +
                (m ? " ref-merged" : "")
              }
              title={m ? `${m.kind}-merged into ${m.into}` : undefined}
            >
              {r}
              {m && <span className="ref-merged-badge">merged</span>}
            </span>
          );
        })}
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
          {hitAreas}
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
