import type React from "react";
import { SigmaGraphVisualization } from "../../SigmaGraphVisualization";
import type { ConsultContext } from "../../types/agent";
import type { Resource } from "../sessions/useApiResource";
import { type GraphBuild, onActivate } from "./graph-builder";
import {
  EXPLORER_EDGE_TYPES,
  EXPLORER_NODE_TYPES,
  type CyInstance,
  type ExplorerConfig,
} from "./types";

interface GraphCanvasProps {
  config: {
    resource: Resource<ExplorerConfig>;
    reload: () => void;
  };
  cytoscapeMissing: boolean;
  lastContext: ConsultContext | null;
  graphBuild: GraphBuild | null;
  zoom: number;
  panelOpen: boolean;
  setPanelOpen: (updater: (prev: boolean) => boolean) => void;
  handleZoomChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  cyRef: React.MutableRefObject<CyInstance | null>;
  cyContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function GraphCanvas({
  config,
  cytoscapeMissing,
  lastContext,
  graphBuild,
  zoom,
  panelOpen,
  setPanelOpen,
  handleZoomChange,
  cyRef,
  cyContainerRef,
}: GraphCanvasProps) {
  if (config.resource.status === "loading") {
    return <div className="empty-msg large">Đang tải cấu hình...</div>;
  }
  if (config.resource.status === "error") {
    return (
      <div className="empty-msg large">
        <span className="vw-alert" role="alert">
          Không tải được cấu hình đồ thị: {config.resource.message}{" "}
          <button type="button" className="link-btn" onClick={config.reload}>
            Thử lại
          </button>
        </span>
      </div>
    );
  }
  const cfg = config.resource.data;
  if (cfg.mode === "explorer") {
    if (!cfg.graph) {
      return (
        <div className="empty-msg large">
          <span className="vw-alert" role="alert">
            /api/admin/graph/data không trả về dữ liệu đồ thị.
          </span>
        </div>
      );
    }
    return (
      <div
        className="visual-graph-wrapper"
        style={{ height: "100%", width: "100%", position: "relative" }}
      >
        <SigmaGraphVisualization
          data={cfg.graph}
          visibleTypes={EXPLORER_NODE_TYPES}
          visibleEdgeTypes={EXPLORER_EDGE_TYPES}
          setSelectedNode={() => undefined}
        />
      </div>
    );
  }
  if (cytoscapeMissing) {
    return (
      <div className="empty-msg large">
        <span className="vw-alert" role="alert">
          Thư viện Cytoscape (tải từ CDN) chưa sẵn sàng nên không vẽ được đồ
          thị. Kiểm tra kết nối mạng rồi tải lại trang.
        </span>
      </div>
    );
  }
  if (!lastContext) {
    return (
      <div className="empty-msg large">Chưa có ngữ cảnh — hãy hỏi trợ lý</div>
    );
  }
  return (
    <div
      className="visual-graph-wrapper"
      style={{ height: "100%", width: "100%", position: "relative" }}
    >
      {graphBuild && graphBuild.problems.length > 0 && (
        <div
          className="vw-alert"
          role="alert"
          style={{ position: "absolute", zIndex: 2, top: 8, left: 8 }}
        >
          Dữ liệu ngữ cảnh không khớp hợp đồng API, đồ thị có thể thiếu nút
          hoặc cạnh: {graphBuild.problems.join("; ")}
        </div>
      )}
      <div ref={cyContainerRef} style={{ height: "100%", width: "100%" }} />
      <div className={`graph-sidebar-panel ${!panelOpen ? "compact" : ""}`}>
        <div className="panel-section">
          <div
            className="compact-control-header"
            role="button"
            tabIndex={0}
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((prev) => !prev)}
            onKeyDown={onActivate(() => setPanelOpen((prev) => !prev))}
          >
            <span className="section-label">Zoom & Controls</span>
            <i className={`fas fa-chevron-${panelOpen ? "down" : "up"}`}></i>
          </div>
          <div className="zoom-control-block">
            <input
              type="range"
              min="0.1"
              max="3"
              step="0.01"
              value={zoom}
              aria-label="Thu phóng đồ thị"
              onChange={handleZoomChange}
              className="modern-slider"
            />
          </div>
          {panelOpen && (
            <div className="expanded-controls animate-fade-quick">
              <div className="zoom-icons">
                <button
                  type="button"
                  className="vw-btn small"
                  aria-label="Thu nhỏ"
                  onClick={() =>
                    cyRef.current?.zoom((cyRef.current?.zoom() ?? 1) * 0.8)
                  }
                >
                  −
                </button>
                <span className="zoom-pct">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  className="vw-btn small"
                  aria-label="Phóng to"
                  onClick={() =>
                    cyRef.current?.zoom((cyRef.current?.zoom() ?? 1) * 1.2)
                  }
                >
                  +
                </button>
              </div>
              <button
                type="button"
                className="modern-action-btn"
                onClick={() => {
                  cyRef.current?.fit();
                  cyRef.current?.center();
                }}
              >
                <i className="fas fa-expand"></i> Reset View
              </button>
              <div className="panel-divider"></div>
              <div className="section-label">Chú giải</div>
              <div className="modern-legend">
                <div className="m-legend-item">
                  <span className="l-dot q"></span>{" "}
                  <span className="l-txt">Truy vấn</span>
                </div>
                <div className="m-legend-item">
                  <span className="l-dot s"></span>{" "}
                  <span className="l-txt">Semantic Search</span>
                </div>
                <div className="m-legend-item">
                  <span className="l-dot p"></span>{" "}
                  <span className="l-txt">Path RAG (Bậc 1+)</span>
                </div>
                <div className="m-legend-item">
                  <span className="l-dot g"></span>{" "}
                  <span className="l-txt">Graph RAG (Bậc 0)</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
