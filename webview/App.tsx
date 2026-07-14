import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Branch,
  Commit,
  CommitDetails as Details,
  FileChange,
  Operation,
} from "../src/types";
import type { InMsg, RebaseEntry } from "./messages";
import { post } from "./vscodeApi";
import { OpBanner } from "./components/OpBanner";
import { ForcePushBanner, ForcePushInfo } from "./components/ForcePushBanner";
import { Toolbar } from "./components/Toolbar";
import { Branches } from "./components/Branches";
import { Graph } from "./components/Graph";
import { Changes } from "./components/Changes";
import { CommitDetails } from "./components/CommitDetails";
import { Rail } from "./components/Rail";
import { RebaseModal } from "./components/RebaseModal";
import { ContextMenu, MenuItem, MenuState } from "./components/ContextMenu";
import { useResizableLayout } from "./useResizableLayout";

export function App() {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [status, setStatus] = useState<FileChange[]>([]);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [forcePush, setForcePush] = useState<ForcePushInfo | null>(null);
  const [notRepo, setNotRepo] = useState<{ path?: string } | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [branchLimit, setBranchLimit] = useState(25);
  const [branchFilter, setBranchFilter] = useState<string[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);

  const [selected, setSelected] = useState<string | undefined>();
  const [details, setDetails] = useState<Details | undefined>();
  const [rebase, setRebase] = useState<
    { base: string; entries: RebaseEntry[] } | undefined
  >();
  const [menu, setMenu] = useState<MenuState | null>(null);

  const { layout, applySaved, toggleCollapse, startDrag, gridRef, paneRef } =
    useResizableLayout();

  // Keep a ref of the current selection so async details can be matched.
  const selectedRef = useRef<string | undefined>(undefined);
  selectedRef.current = selected;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as InMsg;
      switch (msg.type) {
        case "state":
          setNotRepo(null);
          setCommits(msg.commits);
          setBranches(msg.branches);
          setStatus(msg.status);
          setOperation(msg.operation);
          setHasMore(msg.hasMore);
          setBranchLimit(msg.branchLimit);
          setBranchFilter(msg.branchFilter);
          setLoadingMore(false);
          setForcePush(msg.forcePush);
          break;
        case "commitDetails":
          // Ignore stale responses for a commit no longer selected.
          if (msg.details.hash === selectedRef.current) {
            setDetails(msg.details);
          }
          break;
        case "rebaseTodo":
          setRebase({ base: msg.base, entries: msg.entries });
          break;
        case "layout":
          applySaved(msg.layout);
          break;
        case "notRepo":
          setNotRepo({ path: msg.path });
          break;
        case "error":
          console.error("YAGI:", msg.message);
          break;
      }
    };
    window.addEventListener("message", onMessage);
    post({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const currentBranch = branches.find((b) => b.current)?.name ?? "";

  const selectCommit = useCallback((hash: string) => {
    setSelected(hash);
    setDetails(undefined);
    setDetailsOpen(true); // selecting always reveals the details panel
    post({ type: "commitDetails", hash });
  }, []);

  // Toolbar toggle: show/hide details; if nothing is selected yet, open HEAD.
  const toggleDetails = useCallback(() => {
    if (!selected) {
      if (commits.length) selectCommit(commits[0].hash);
      return;
    }
    setDetailsOpen((open) => !open);
  }, [selected, commits, selectCommit]);

  const showMenu = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  const loadMore = useCallback(() => {
    setLoadingMore((busy) => {
      if (busy) return busy; // already requesting a page
      post({ type: "loadMore" });
      return true;
    });
  }, []);

  if (notRepo) {
    return (
      <div className="empty">
        <p>No Git repository found in the opened folder.</p>
        {notRepo.path && (
          <p className="empty-path">
            Checked: <code>{notRepo.path}</code>
          </p>
        )}
        <p className="empty-hint">
          Open the folder that directly contains the <code>.git</code> directory
          (for the playground, that's the <code>work</code> folder, not its
          parent), then reopen YAGI.
        </p>
      </div>
    );
  }

  return (
    <div className="app-root">
      <OpBanner operation={operation} />
      <ForcePushBanner info={forcePush} />
      <div
        className="app-grid"
        ref={gridRef}
        style={{
          gridTemplateColumns: [
            layout.collapsedSidebar ? "34px" : `${layout.sidebar}px`,
            layout.collapsedSidebar ? "0" : "6px",
            "minmax(0, 1fr)",
            layout.collapsedChanges ? "0" : "6px",
            layout.collapsedChanges ? "34px" : `${layout.changes}px`,
          ].join(" "),
        }}
      >
        {layout.collapsedSidebar ? (
          <Rail
            label="Branches"
            side="left"
            onExpand={() => toggleCollapse("collapsedSidebar")}
          />
        ) : (
          <Branches
            branches={branches}
            limit={branchLimit}
            selected={branchFilter}
            onSelect={(names) => post({ type: "setBranchFilter", branches: names })}
            onMenu={showMenu}
            onCollapse={() => toggleCollapse("collapsedSidebar")}
          />
        )}

        {layout.collapsedSidebar ? (
          <div />
        ) : (
          <div
            className="splitter splitter-v"
            onPointerDown={startDrag("sidebar")}
            title="Drag to resize"
          />
        )}

        <main className="graph-pane" ref={paneRef}>
          <Toolbar
            branches={branches}
            detailsOpen={!!selected && detailsOpen}
            onToggleDetails={toggleDetails}
          />
          <Graph
            commits={commits}
            currentBranch={currentBranch}
            selected={selected}
            hasMore={hasMore}
            loading={loadingMore}
            onSelect={selectCommit}
            onLoadMore={loadMore}
            onMenu={showMenu}
          />
          {selected && detailsOpen && (
            <>
              {!layout.collapsedDetails && (
                <div
                  className="splitter splitter-h"
                  onPointerDown={startDrag("details")}
                  title="Drag to resize"
                />
              )}
              <div
                className="details-host"
                style={{
                  height: layout.collapsedDetails ? "auto" : layout.details,
                }}
              >
                <CommitDetails
                  details={details}
                  loading={!details}
                  collapsed={!!layout.collapsedDetails}
                  onToggleCollapse={() => toggleCollapse("collapsedDetails")}
                  onClose={() => setDetailsOpen(false)}
                />
              </div>
            </>
          )}
        </main>

        {layout.collapsedChanges ? (
          <div />
        ) : (
          <div
            className="splitter splitter-v"
            onPointerDown={startDrag("changes")}
            title="Drag to resize"
          />
        )}

        {layout.collapsedChanges ? (
          <Rail
            label="Changes"
            side="right"
            onExpand={() => toggleCollapse("collapsedChanges")}
          />
        ) : (
          <Changes
            status={status}
            onCollapse={() => toggleCollapse("collapsedChanges")}
            onMenu={showMenu}
          />
        )}
      </div>

      {rebase && (
        <RebaseModal
          base={rebase.base}
          entries={rebase.entries}
          onClose={() => setRebase(undefined)}
        />
      )}
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  );
}
