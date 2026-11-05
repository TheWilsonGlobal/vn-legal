import type { GraphData, GraphNode } from "../../types/index.ts";
import { SigmaGraphVisualization } from "../graph/SigmaGraphVisualization.tsx";
import { KnowledgeGraphLegend } from "./KnowledgeGraphLegend.tsx";

interface KnowledgeGraphsTabProps {
  isFullScreen: boolean;
  setIsFullScreen: (fs: boolean) => void;
  fetchGraphData: () => Promise<void>;
  graphData: GraphData | null;
  visibleTypes: string[];
  visibleEdgeTypes: string[];
  setSelectedNode: (node: GraphNode | null) => void;
  selectedNode: GraphNode | null;
  toggleTypeVisibility: (type: string) => void;
  toggleEdgeTypeVisibility: (type: string) => void;
  graphTypeCounts: Record<string, number>;
  graphEdgeCounts: Record<string, number>;
  visibleNodesCount: number;
  visibleEdgesCount: number;
}

export function KnowledgeGraphsTab({
  isFullScreen,
  setIsFullScreen,
  fetchGraphData,
  graphData,
  visibleTypes,
  visibleEdgeTypes,
  setSelectedNode,
  selectedNode,
  toggleTypeVisibility,
  toggleEdgeTypeVisibility,
  graphTypeCounts,
  graphEdgeCounts,
  visibleNodesCount,
  visibleEdgesCount,
}: KnowledgeGraphsTabProps) {
  return (
    <div
      className={`card ${isFullScreen ? "graph-fullscreen animate-zoom" : "animate-zoom"}`}
      style={{ marginTop: "20px" }}
    >
      <div className="card-header">
        <h2>Visual Graph Explorer (Sigma v3)</h2>
        <div className="header-actions">
          <button
            className="btn-small"
            title="Full Screen"
            onClick={() => setIsFullScreen(!isFullScreen)}
          >
            <i
              className={`fas ${isFullScreen ? "fa-compress" : "fa-expand"}`}
            ></i>
          </button>
          <button
            className="btn-small"
            title="Tải lại đồ thị"
            onClick={fetchGraphData}
          >
            <i className="fas fa-sync-alt"></i>
          </button>
        </div>
      </div>
      <div
        className="card-body"
        style={{
          overflow: "hidden",
          position: "relative",
          display: "flex",
          height: isFullScreen ? "calc(100vh - 120px)" : "600px",
        }}
      >
        <div
          className="graph-loading-overlay"
          style={{
            display: !graphData ? "flex" : "none",
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 100,
            background: "rgba(13, 17, 23, 0.8)",
            backdropFilter: "blur(4px)",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div className="spinner"></div>
          <p>Đang tải dữ liệu đồ thị...</p>
        </div>

        <SigmaGraphVisualization
          data={graphData}
          visibleTypes={visibleTypes}
          visibleEdgeTypes={visibleEdgeTypes}
          setSelectedNode={setSelectedNode}
        />

        {selectedNode && (
          <div className="graph-sidebar">
            <div className="sidebar-header">
              <span className={`type-tag ${selectedNode.type.toLowerCase()}`}>
                {selectedNode.type}
              </span>
              <button
                className="btn-close"
                onClick={() => setSelectedNode(null)}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="sidebar-content">
              <h3>{selectedNode.label}</h3>
              <div className="meta-info">
                <p>
                  <strong>ID:</strong> {selectedNode.id}
                </p>
              </div>
              <div className="node-description">
                <p>
                  Thông tin chi tiết về đối tượng pháp lý này sẽ được hiển thị
                  tại đây.
                </p>
              </div>
            </div>
          </div>
        )}

        <KnowledgeGraphLegend
          visibleTypes={visibleTypes}
          toggleTypeVisibility={toggleTypeVisibility}
          visibleEdgeTypes={visibleEdgeTypes}
          toggleEdgeTypeVisibility={toggleEdgeTypeVisibility}
          graphTypeCounts={graphTypeCounts}
          graphEdgeCounts={graphEdgeCounts}
          visibleNodesCount={visibleNodesCount}
          visibleEdgesCount={visibleEdgesCount}
        />
      </div>
    </div>
  );
}
