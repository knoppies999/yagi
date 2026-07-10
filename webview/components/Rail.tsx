/** Collapsed-pane rail: a thin clickable strip that expands the pane. */
export function Rail({
  label,
  side,
  onExpand,
}: {
  label: string;
  side: "left" | "right";
  onExpand: () => void;
}) {
  return (
    <div
      className={"rail rail-" + side}
      onClick={onExpand}
      title={`Expand ${label}`}
    >
      <span className="rail-btn">{side === "left" ? "»" : "«"}</span>
      <span className="rail-label">{label}</span>
    </div>
  );
}
