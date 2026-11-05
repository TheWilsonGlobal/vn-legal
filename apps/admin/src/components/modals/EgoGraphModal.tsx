import type { GraphData } from "../../types/index.ts";
import { GraphVisualization } from "../graph/GraphVisualization.tsx";

interface EgoGraphModalProps {
  selectedRelationNode: string | null;
  onClose: () => void;
  graphData: GraphData | null;
  relationsModalReady: boolean;
  computeEgoGraph: (nodeId: string) => GraphData | null;
  visibleTypes: string[];
  setSelectedRelationNode: (nodeId: string | null) => void;
  setZoomLevel: (level: number) => void;
}

export function EgoGraphModal({
  selectedRelationNode,
  onClose,
  graphData,
  relationsModalReady,
  computeEgoGraph,
  visibleTypes,
  setSelectedRelationNode,
  setZoomLevel,
}: EgoGraphModalProps) {
  if (!selectedRelationNode) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content admin-modal glass-card animate-zoom"
        style={{ maxWidth: "1000px", height: "80vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            <span
              className="type-tag edge"
              style={{
                background: "rgba(59, 130, 246, 0.15)",
                color: "#60a5fa",
                border: "1px solid rgba(59, 130, 246, 0.3)",
              }}
            >
              Ego-Graph
            </span>
            <h2>
              Trực quan hóa cục bộ:{" "}
              {graphData?.nodes?.find((n) => n.id === selectedRelationNode)
                ?.label || selectedRelationNode}
            </h2>
          </div>
          <button className="btn-close-lg" onClick={onClose}>
            <i className="fas fa-times"></i>
          </button>
        </div>
        <div
          className="modal-body"
          style={{
            position: "relative",
            padding: 0,
            overflow: "hidden",
            flex: 1,
            width: "100%",
            height: "100%",
          }}
        >
          {relationsModalReady ? (
            <GraphVisualization
              data={computeEgoGraph(selectedRelationNode)}
              layout="concentric"
              visibleTypes={visibleTypes}
              setSelectedNode={(node) => {
                if (node) setSelectedRelationNode(node.id);
              }}
              setZoomLevel={setZoomLevel}
              onRenderingChange={() => {}}
              onInit={() => {}}
            />
          ) : (
            <div
              className="loading-placeholder"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                width: "100%",
                height: "100%",
              }}
            >
              <div className="spinner"></div>
              <p
                style={{
                  marginTop: "10px",
                  fontSize: "14px",
                  color: "var(--text-dim)",
                }}
              >
                Đang tính toán sơ đồ liên kết cục bộ...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
