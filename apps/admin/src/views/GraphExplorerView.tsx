import type React from "react";
import type {
  GraphData,
  GraphNode,
  CytoscapeInstance,
} from "../types/index.ts";
import { GraphVisualization } from "../components/graph/GraphVisualization.tsx";
import { GraphExplorerLegend } from "../components/graph/GraphExplorerLegend.tsx";

interface GraphExplorerViewProps {
  isFullScreen: boolean;
  setIsFullScreen: (fs: boolean) => void;
  zoomLevel: number;
  setZoomLevel: (z: number) => void;
  graphLayout: string;
  setGraphLayout: (layout: string) => void;
  graphData: GraphData | null;
  graphRendering: boolean;
  setGraphRendering: (loading: boolean) => void;
  visibleTypes: string[];
  toggleTypeVisibility: (type: string) => void;
  selectedNode: GraphNode | null;
  setSelectedNode: (node: GraphNode | null) => void;
  fetchGraphData: () => Promise<void>;
  cyRef: React.MutableRefObject<CytoscapeInstance | null>;
  graphTypeCounts: Record<string, number>;
  visibleNodesCount: number;
  visibleEdgesCount: number;
}

export function GraphExplorerView({
  isFullScreen,
  setIsFullScreen,
  zoomLevel,
  setZoomLevel,
  graphLayout,
  setGraphLayout,
  graphData,
  graphRendering,
  setGraphRendering,
  visibleTypes,
  toggleTypeVisibility,
  selectedNode,
  setSelectedNode,
  fetchGraphData,
  cyRef,
  graphTypeCounts,
  visibleNodesCount,
  visibleEdgesCount,
}: GraphExplorerViewProps) {
  return (
    <div className="view-section" key="graph">
      <div className="view-header">
        <h2>Quản lý Knowledge Graph</h2>
        <button className="btn-primary" onClick={fetchGraphData}>
          <i className="fas fa-sync-alt"></i> Rebuild Graph
        </button>
      </div>

      <div
        className={`card ${isFullScreen ? "graph-fullscreen" : ""}`}
        style={{ marginTop: "20px" }}
      >
        <div className="card-header">
          <h2>Visual Graph Explorer</h2>
          <div className="header-actions">
            <div className="zoom-control-header">
              <i className="fas fa-search-minus"></i>
              <input
                type="range"
                min="0.1"
                max="3"
                step="0.1"
                value={zoomLevel}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setZoomLevel(val);
                  if (cyRef.current) {
                    cyRef.current.zoom({
                      level: val,
                      renderedPosition: {
                        x: cyRef.current.width() / 2,
                        y: cyRef.current.height() / 2,
                      },
                    });
                  }
                }}
              />
              <i className="fas fa-search-plus"></i>
              <span className="zoom-value">{Math.round(zoomLevel * 100)}%</span>
            </div>

            <button
              className="btn-small"
              title="Full Screen"
              onClick={() => setIsFullScreen(!isFullScreen)}
            >
              <i
                className={`fas ${isFullScreen ? "fa-compress" : "fa-expand"}`}
              ></i>
            </button>

            <select
              className="layout-select-header"
              value={graphLayout}
              onChange={(e) => setGraphLayout(e.target.value)}
            >
              <option value="fcose">Clustered (fCose)</option>
              <option value="cose">Traditional (Cose)</option>
              <option value="cola">Organic (Cola)</option>
              <option value="dagre">Hierarchy (Dagre)</option>
              <option value="concentric">Concentric (Radar)</option>
              <option value="grid">Grid</option>
              <option value="circle">Circle</option>
              <option value="breadthfirst">Breadthfirst</option>
            </select>

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
              display: graphRendering || !graphData ? "flex" : "none",
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
            <p>
              {!graphData
                ? "Đang tải dữ liệu..."
                : "Đang tính toán bố cục đồ thị..."}
            </p>
          </div>

          <GraphVisualization
            data={graphData}
            layout={graphLayout}
            visibleTypes={visibleTypes}
            setSelectedNode={setSelectedNode}
            setZoomLevel={setZoomLevel}
            onRenderingChange={setGraphRendering}
            onInit={(cy: unknown) => (cyRef.current = cy as CytoscapeInstance)}
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

          <GraphExplorerLegend
            visibleTypes={visibleTypes}
            toggleTypeVisibility={toggleTypeVisibility}
            graphTypeCounts={graphTypeCounts}
            visibleNodesCount={visibleNodesCount}
            visibleEdgesCount={visibleEdgesCount}
          />
        </div>
      </div>
    </div>
  );
}
