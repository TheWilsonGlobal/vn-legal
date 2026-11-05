import type { Relation } from "../../types/index.ts";

interface KnowledgeRelationsTableProps {
  relationsLoading: boolean;
  relations: Relation[];
  selectedRelationNode: string | null;
  setSelectedRelationNode: (nodeId: string | null) => void;
  relationsPage: number;
  relationsTotalPages: number;
  relationsTotalItems: number;
  setRelationsPage: (page: number | ((prev: number) => number)) => void;
}

export function KnowledgeRelationsTable({
  relationsLoading,
  relations,
  selectedRelationNode,
  setSelectedRelationNode,
  relationsPage,
  relationsTotalPages,
  relationsTotalItems,
  setRelationsPage,
}: KnowledgeRelationsTableProps) {
  if (relationsLoading) {
    return (
      <div className="loading-placeholder">
        <div className="spinner"></div>
        <p>Đang tải danh sách quan hệ...</p>
      </div>
    );
  }

  return (
    <>
      <table className="data-table">
        <thead>
          <tr>
            <th>Nguồn (Source)</th>
            <th>Loại quan hệ</th>
            <th>Đích (Target)</th>
            <th>Chi tiết / Nội dung</th>
            <th>Hành động</th>
          </tr>
        </thead>
        <tbody>
          {relations.length > 0 ? (
            relations.map((rel) => (
              <tr
                key={rel.id}
                style={{
                  background:
                    selectedRelationNode === rel.sourceId ||
                    selectedRelationNode === rel.targetId
                      ? "rgba(59, 130, 246, 0.08)"
                      : "transparent",
                }}
              >
                <td>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <strong style={{ fontSize: "13px" }}>
                      {rel.sourceLabel}
                    </strong>
                    <span
                      className="type-tag node"
                      style={{
                        fontSize: "10px",
                        marginTop: "2px",
                        width: "fit-content",
                      }}
                    >
                      {rel.sourceType}
                    </span>
                  </div>
                </td>
                <td>
                  <span
                    className="type-tag edge"
                    style={{
                      fontSize: "11px",
                      textTransform: "none",
                    }}
                  >
                    {rel.type}
                  </span>
                </td>
                <td>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <strong style={{ fontSize: "13px" }}>
                      {rel.targetLabel}
                    </strong>
                    <span
                      className="type-tag node"
                      style={{
                        fontSize: "10px",
                        marginTop: "2px",
                        width: "fit-content",
                      }}
                    >
                      {rel.targetType}
                    </span>
                  </div>
                </td>
                <td
                  style={{
                    maxWidth: "250px",
                    fontSize: "12px",
                    color: "#94a3b8",
                  }}
                >
                  {rel.reference_text && (
                    <div>
                      <strong>Nội dung:</strong> {rel.reference_text}
                    </div>
                  )}
                  {rel.context && (
                    <div
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={rel.context}
                    >
                      <strong>Ngữ cảnh:</strong> {rel.context}
                    </div>
                  )}
                  {!rel.reference_text && !rel.context && "-"}
                </td>
                <td>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      className="btn-small"
                      onClick={() => setSelectedRelationNode(rel.sourceId)}
                      title="Xem đồ thị cục bộ của Nguồn"
                      style={{ padding: "4px 8px", fontSize: "11px" }}
                    >
                      <i className="fas fa-eye"></i> Nguồn
                    </button>
                    <button
                      className="btn-small"
                      onClick={() => setSelectedRelationNode(rel.targetId)}
                      title="Xem đồ thị cục bộ của Đích"
                      style={{ padding: "4px 8px", fontSize: "11px" }}
                    >
                      <i className="fas fa-eye"></i> Đích
                    </button>
                  </div>
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
                Không tìm thấy mối quan hệ nào khớp với bộ lọc.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {relationsTotalPages > 1 && (
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
            disabled={relationsPage === 1}
            onClick={() => setRelationsPage((p: number) => Math.max(p - 1, 1))}
            style={{ padding: "4px 10px", fontSize: "12px" }}
          >
            <i className="fas fa-chevron-left"></i> Trước
          </button>
          <span style={{ fontSize: "13px", color: "#94a3b8" }}>
            Trang <strong>{relationsPage}</strong> / {relationsTotalPages} (Tổng{" "}
            {relationsTotalItems})
          </span>
          <button
            className="btn-secondary"
            disabled={relationsPage === relationsTotalPages}
            onClick={() =>
              setRelationsPage((p: number) =>
                Math.min(p + 1, relationsTotalPages),
              )
            }
            style={{ padding: "4px 10px", fontSize: "12px" }}
          >
            Sau <i className="fas fa-chevron-right"></i>
          </button>
        </div>
      )}
    </>
  );
}
