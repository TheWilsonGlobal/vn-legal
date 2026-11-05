interface GraphExplorerLegendProps {
  visibleTypes: string[];
  toggleTypeVisibility: (type: string) => void;
  graphTypeCounts: Record<string, number>;
  visibleNodesCount: number;
  visibleEdgesCount: number;
}

const GRAPH_NODE_TYPES = [
  "Part",
  "Chapter",
  "Section",
  "Subsection",
  "Article",
  "Clause",
  "ClausePoint",
];

export function GraphExplorerLegend({
  visibleTypes,
  toggleTypeVisibility,
  graphTypeCounts,
  visibleNodesCount,
  visibleEdgesCount,
}: GraphExplorerLegendProps) {
  return (
    <div
      className="graph-legend"
      style={{
        position: "absolute",
        top: "20px",
        right: "20px",
        background: "rgba(13, 17, 23, 0.7)",
        backdropFilter: "blur(4px)",
        padding: "12px",
        borderRadius: "8px",
        zIndex: 5,
        border: "1px solid rgba(255,255,255,0.05)",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      {GRAPH_NODE_TYPES.map((type) => (
        <label
          key={type}
          className="legend-item"
          style={{
            display: "flex",
            alignItems: "center",
            cursor: "pointer",
            gap: "8px",
            fontSize: "12px",
          }}
        >
          <input
            type="checkbox"
            checked={visibleTypes.includes(type)}
            onChange={() => toggleTypeVisibility(type)}
            style={{ accentColor: "var(--accent-blue)" }}
          />
          <span className={`color ${type.toLowerCase()}`}></span>
          {type} ({graphTypeCounts[type] || 0})
        </label>
      ))}
      <div
        style={{
          marginTop: "4px",
          paddingTop: "8px",
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          fontSize: "11px",
          color: "#94a3b8",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <span>Visible nodes:</span>
          <strong style={{ color: "#f8fafc" }}>{visibleNodesCount}</strong>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <span>Visible edges:</span>
          <strong style={{ color: "#f8fafc" }}>{visibleEdgesCount}</strong>
        </div>
      </div>
    </div>
  );
}
