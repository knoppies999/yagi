// @ts-check
const vscode = acquireVsCodeApi();

const el = (id) => document.getElementById(id);

// ---- messaging ------------------------------------------------------------
window.addEventListener("message", (e) => {
  const msg = e.data;
  switch (msg.type) {
    case "state":
      renderBranches(msg.branches);
      renderChanges(msg.status);
      renderGraph(msg.commits);
      break;
    case "diff":
      el("diff").textContent = msg.patch || "(no changes)";
      break;
    case "notRepo":
      el("graph").textContent = "This folder is not a Git repository.";
      break;
    case "error":
      el("diff").textContent = "Error: " + msg.message;
      break;
  }
});

const send = (m) => vscode.postMessage(m);

// ---- branches -------------------------------------------------------------
function renderBranches(branches) {
  const ul = el("branches");
  ul.innerHTML = "";
  for (const b of branches) {
    const li = document.createElement("li");
    li.className = "branch" + (b.current ? " current" : "");
    let label = b.name;
    if (b.ahead || b.behind) {
      label += `  ↑${b.ahead} ↓${b.behind}`;
    }
    li.textContent = label;
    li.title = b.upstream ? `tracks ${b.upstream}` : "no upstream";
    if (!b.current) {
      li.onclick = () => send({ type: "checkout", branch: b.name });
    }
    ul.appendChild(li);
  }
}

// ---- working tree changes -------------------------------------------------
function renderChanges(status) {
  const staged = el("staged");
  const unstaged = el("unstaged");
  staged.innerHTML = "";
  unstaged.innerHTML = "";
  for (const c of status) {
    if (c.staged) {
      staged.appendChild(fileRow(c, true));
    }
    // A file can be both staged and have further unstaged edits.
    if (c.worktree !== " " || c.index === "?") {
      unstaged.appendChild(fileRow(c, false));
    }
  }
}

function fileRow(change, isStaged) {
  const li = document.createElement("li");
  li.className = "file";
  const code = document.createElement("span");
  code.className = "code";
  code.textContent = (change.index + change.worktree).trim() || "??";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = change.path;
  name.onclick = () => send({ type: "diff", path: change.path, staged: isStaged });
  const btn = document.createElement("button");
  btn.textContent = isStaged ? "−" : "+";
  btn.title = isStaged ? "Unstage" : "Stage";
  btn.onclick = () =>
    send({ type: isStaged ? "unstage" : "stage", path: change.path });
  li.append(code, name, btn);
  return li;
}

el("commit-btn").onclick = () => {
  const ta = /** @type {HTMLTextAreaElement} */ (el("commit-msg"));
  const message = ta.value.trim();
  if (message) {
    send({ type: "commit", message });
    ta.value = "";
  }
};

// ---- commit graph ---------------------------------------------------------
const ROW_H = 24; // px per commit row
const COL_W = 16; // px per lane column
const LANE_COLORS = [
  "#e06c75", "#98c379", "#61afef", "#c678dd",
  "#e5c07b", "#56b6c2", "#d19a66", "#abb2bf",
];

/**
 * Greedy lane assignment. `lanes` holds the commit hash each column is
 * currently waiting to draw next. Returns {col, parentCols} per commit.
 */
function assignLanes(commits) {
  const lanes = []; // lanes[i] = expected hash for column i, or null if free
  const placed = [];

  const claimLane = (hash) => {
    let idx = lanes.indexOf(hash);
    if (idx === -1) {
      idx = lanes.indexOf(null);
      if (idx === -1) idx = lanes.length;
    }
    return idx;
  };

  for (const c of commits) {
    // The commit sits in whichever lane was waiting for it (or a fresh one).
    let col = lanes.indexOf(c.hash);
    if (col === -1) {
      col = lanes.indexOf(null);
      if (col === -1) col = lanes.length;
    }
    lanes[col] = null; // consumed; parents will refill

    // First parent continues this lane; extra parents branch into new lanes.
    const parentCols = [];
    c.parents.forEach((p, i) => {
      let pc;
      if (i === 0) {
        pc = col;
        lanes[col] = p;
      } else {
        pc = claimLane(p);
        lanes[pc] = p;
      }
      parentCols.push({ hash: p, col: pc });
    });

    placed.push({ commit: c, col, parentCols });
  }
  return placed;
}

function renderGraph(commits) {
  const placed = assignLanes(commits);
  const rowByHash = new Map();
  placed.forEach((p, i) => rowByHash.set(p.commit.hash, i));
  const maxCol = placed.reduce((m, p) => Math.max(m, p.col), 0);

  const graphW = (maxCol + 1) * COL_W + COL_W;
  const height = placed.length * ROW_H;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", String(graphW));
  svg.setAttribute("height", String(height));
  svg.classList.add("graph-svg");

  const x = (col) => col * COL_W + COL_W / 2;
  const y = (row) => row * ROW_H + ROW_H / 2;

  // edges to parents
  placed.forEach((p, row) => {
    for (const pc of p.parentCols) {
      const prow = rowByHash.get(pc.hash);
      if (prow === undefined) continue;
      const path = document.createElementNS(svgNS, "path");
      const x1 = x(p.col), y1 = y(row);
      const x2 = x(pc.col), y2 = y(prow);
      // vertical then curve into the parent's column
      const d = `M ${x1} ${y1} C ${x1} ${y1 + ROW_H} ${x2} ${y2 - ROW_H} ${x2} ${y2}`;
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", LANE_COLORS[pc.col % LANE_COLORS.length]);
      path.setAttribute("stroke-width", "2");
      svg.appendChild(path);
    }
  });

  // nodes
  placed.forEach((p, row) => {
    const dot = document.createElementNS(svgNS, "circle");
    dot.setAttribute("cx", String(x(p.col)));
    dot.setAttribute("cy", String(y(row)));
    dot.setAttribute("r", "4");
    dot.setAttribute("fill", LANE_COLORS[p.col % LANE_COLORS.length]);
    svg.appendChild(dot);
  });

  // build the rows table alongside the svg
  const rows = document.createElement("div");
  rows.className = "commit-rows";
  placed.forEach((p) => {
    const c = p.commit;
    const row = document.createElement("div");
    row.className = "commit-row";
    row.style.height = ROW_H + "px";
    let refs = "";
    for (const r of c.refs) {
      refs += `<span class="ref">${escapeHtml(r)}</span>`;
    }
    row.innerHTML =
      refs +
      `<span class="subject">${escapeHtml(c.subject)}</span>` +
      `<span class="meta">${escapeHtml(c.author)} · ${shortHash(c.hash)}</span>`;
    rows.appendChild(row);
  });

  const graph = el("graph");
  graph.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "graph-wrap";
  wrap.style.setProperty("--graph-w", graphW + "px");
  wrap.append(svg, rows);
  graph.appendChild(wrap);
}

function shortHash(h) {
  return h.slice(0, 7);
}
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

send({ type: "ready" });
