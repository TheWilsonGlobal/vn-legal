import type { GraphData } from "../../types/index.ts";
import type { ProcessedGraphNode } from "./KnowledgeNodesTab.tsx";

interface KnowledgeNodesTableProps {
  graphData: GraphData | null;
  paginatedNodes: ProcessedGraphNode[];
  processedNodesCount: number;
  selectedRelationNode: string | null;
  setSelectedRelationNode: (nodeId: string | null) => void;
  nodesPage: number;
  nodesTotalPages: number;
  setNodesPage: (page: number | ((prev: number) => number)) => void;
}

export function KnowledgeNodesTable({
  graphData,
  paginatedNodes,
  processedNodesCount,
  selectedRelationNode,
  setSelectedRelationNode,
  nodesPage,
  nodesTotalPages,
  setNodesPage,
}: KnowledgeNodesTableProps) {
  if (!graphData) {
    return (
      <div className="loading-placeholder">
        <div className="spinner"></div>
        <p>Đang tải danh sách nút...</p>
      </div>
    );
  }

  return (
    <>
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: "15%" }}>ID Nút</th>
            <th style={{ width: "15%" }}>Loại Nút</th>
            <th>Tên / Nhãn Nút</th>
            <th style={{ width: "15%", textAlign: "center" }}>
              Số liên kết (Degree)
            </th>
            <th style={{ width: "15%" }}>Hành động</th>
          </tr>
        </thead>
        <tbody>
          {paginatedNodes.length > 0 ? (
            paginatedNodes.map((node) => (
              <tr
                key={node.id}
                style={{
                  background:
                    selectedRelationNode === node.id
                      ? "rgba(59, 130, 246, 0.08)"
                      : "transparent",
                }}
              >
                <td>
                  <code
                    style={{
                      fontSize: "11px",
                      color: "var(--text-dim)",
                    }}
                  >
                    {node.id}
                  </code>
                </td>
                <td>
                  <span
                    className={`type-tag node ${node.type.toLowerCase()}`}
                    style={{
                      fontSize: "10px",
                      width: "fit-content",
                    }}
                  >
                    {node.type}
                  </span>
                </td>
                <td>
                  <strong
                    style={{
                      fontSize: "13px",
                      color: "var(--text-main)",
                    }}
                  >
                    {node.label}
                  </strong>
                </td>
                <td style={{ textAlign: "center" }}>
                  <span
                    className="badge-dim"
                    style={{
                      padding: "4px 8px",
                      fontSize: "11px",
                      fontWeight: "bold",
                    }}
                  >
                    {node.degree} liên kết
                  </span>
                </td>
                <td>
                  <button
                    className="btn-small"
                    onClick={() => setSelectedRelationNode(node.id)}
                    title="Xem đồ thị cục bộ (Ego-Graph) của nút này"
                    style={{
                      padding: "4px 8px",
                      fontSize: "11px",
                    }}
                  >
                    <i className="fas fa-eye"></i> Xem Ego-Graph
                  </button>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td
                colSpan={5}
                style={{
                  textAlign: "center",
                  color: "#64748b",
                  padding: "30px",
                }}
              >
                Không tìm thấy nút nào khớp với bộ lọc.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {nodesTotalPages > 1 && (
        <div
          className="pagination"
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "12px",
            marginTop: "20px",
          }}
        >
          <button
            className="btn-secondary"
            disabled={nodesPage === 1}
            onClick={() => setNodesPage((p: number) => Math.max(p - 1, 1))}
            style={{
              padding: "4px 10px",
              fontSize: "12px",
            }}
          >
            <i className="fas fa-chevron-left"></i> Trước
          </button>
          <span style={{ fontSize: "13px", color: "#94a3b8" }}>
            Trang <strong>{nodesPage}</strong> / {nodesTotalPages} (Tổng{" "}
            {processedNodesCount})
          </span>
          <button
            className="btn-secondary"
            disabled={nodesPage === nodesTotalPages}
            onClick={() =>
              setNodesPage((p: number) => Math.min(p + 1, nodesTotalPages))
            }
            style={{
              padding: "4px 10px",
              fontSize: "12px",
            }}
          >
            Sau <i className="fas fa-chevron-right"></i>
          </button>
        </div>
      )}
    </>
  );
}
