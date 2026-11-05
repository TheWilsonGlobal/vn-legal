interface KnowledgeGraphLegendProps {
  visibleTypes: string[];
  toggleTypeVisibility: (type: string) => void;
  visibleEdgeTypes: string[];
  toggleEdgeTypeVisibility: (type: string) => void;
  graphTypeCounts: Record<string, number>;
  graphEdgeCounts: Record<string, number>;
  visibleNodesCount: number;
  visibleEdgesCount: number;
}

const NODE_TYPES = [
  "Part",
  "Chapter",
  "Section",
  "Subsection",
  "Article",
  "Clause",
  "ClausePoint",
];

const EDGE_TYPES = [
  "HAS_CHAPTER",
  "HAS_SECTION",
  "HAS_SUBSECTION",
  "BELONGS_TO_SUBSECTION",
  "BELONGS_TO_SECTION",
  "BELONGS_TO_CHAPTER",
  "HAS_CLAUSE",
  "HAS_POINT",
];

export function KnowledgeGraphLegend({
  visibleTypes,
  toggleTypeVisibility,
  visibleEdgeTypes,
  toggleEdgeTypeVisibility,
  graphTypeCounts,
  graphEdgeCounts,
  visibleNodesCount,
  visibleEdgesCount,
}: KnowledgeGraphLegendProps) {
  return (
    <div
      className="graph-legend"
      style={{
        position: "absolute",
        top: "20px",
        left: "20px",
        background: "rgba(13, 17, 23, 0.7)",
        backdropFilter: "blur(4px)",
        padding: "12px 16px",
        borderRadius: "8px",
        zIndex: 5,
        border: "1px solid rgba(255,255,255,0.05)",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        maxWidth: "420px",
      }}
    >
      <div style={{ display: "flex", gap: "24px" }}>
        {/* Column 1: Nodes */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: "4px",
            }}
          >
            Nodes
          </div>
          {NODE_TYPES.map((type) => (
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
        </div>

        {/* Column 2: Edges */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: "4px",
            }}
          >
            Edges
          </div>
          {EDGE_TYPES.map((type) => (
            <label
              key={type}
              className="legend-item"
              style={{
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                gap: "8px",
                fontSize: "12px",
                whiteSpace: "nowrap",
              }}
            >
              <input
                type="checkbox"
                checked={visibleEdgeTypes.includes(type)}
                onChange={() => toggleEdgeTypeVisibility(type)}
                style={{ accentColor: "var(--accent-purple)" }}
              />
              <span
                style={{
                  width: "12px",
                  height: "2px",
                  background: "rgba(255,255,255,0.4)",
                  borderRadius: "1px",
                }}
              ></span>
              {type} ({graphEdgeCounts[type] || 0})
            </label>
          ))}
        </div>
      </div>

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
