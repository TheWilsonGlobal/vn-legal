import type { VectorResult } from "../../types/index.ts";

export interface ChunkItem {
  id: string;
  type: string;
  title: string;
  content: string;
  article_id?: string;
  clause_number?: number;
  metadata: {
    part?: string;
    chapter?: string;
    article_title?: string;
    [key: string]: unknown;
  };
}

interface VectorChunksTabProps {
  chunksTotalItems: number;
  tempChunksSearch: string;
  setTempChunksSearch: (search: string) => void;
  setChunksSearch: (search: string) => void;
  chunksType: string;
  setChunksType: (type: string) => void;
  chunksLoading: boolean;
  chunks: ChunkItem[];
  chunksPage: number;
  chunksTotalPages: number;
  setChunksPage: (page: number | ((prev: number) => number)) => void;
  setPreviewArticle: (article: VectorResult | null) => void;
}

export function VectorChunksTab({
  chunksTotalItems,
  tempChunksSearch,
  setTempChunksSearch,
  setChunksSearch,
  chunksType,
  setChunksType,
  chunksLoading,
  chunks,
  chunksPage,
  chunksTotalPages,
  setChunksPage,
  setPreviewArticle,
}: VectorChunksTabProps) {
  return (
    <div className="card animate-zoom" style={{ marginTop: "20px" }}>
      <div className="card-header">
        <h2>Tất cả Vector Chunks</h2>
        <span className="badge-dim">Tổng số: {chunksTotalItems}</span>
      </div>
      <div className="card-body">
        <div className="chunk-filters">
          <div className="chunk-search">
            <i className="fas fa-search"></i>
            <input
              type="text"
              placeholder="Tìm kiếm theo tiêu đề, nội dung, ID..."
              value={tempChunksSearch}
              onChange={(e) => setTempChunksSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setChunksSearch(tempChunksSearch);
                  setChunksPage(1);
                }
              }}
            />
          </div>
          <div className="filter-group">
            <button
              className="btn-primary"
              onClick={() => {
                setChunksSearch(tempChunksSearch);
                setChunksPage(1);
              }}
            >
              Tìm kiếm
            </button>
            <select
              className="filter-select"
              value={chunksType}
              onChange={(e) => {
                setChunksType(e.target.value);
                setChunksPage(1);
              }}
            >
              <option value="all">Tất cả Loại</option>
              <option value="article">Điều luật (Articles)</option>
              <option value="clause">Khoản luật (Clauses)</option>
            </select>
          </div>
        </div>

        <div className="chunk-table-container">
          {chunksLoading ? (
            <div
              style={{
                padding: "40px",
                textAlign: "center",
              }}
              className="placeholder-text"
            >
              <div className="spinner" style={{ margin: "0 auto 15px" }}></div>
              Đang tải danh sách chunks...
            </div>
          ) : chunks.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Loại</th>
                  <th>ID</th>
                  <th>Tiêu đề</th>
                  <th>Nội dung</th>
                  <th>Vị trí</th>
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {chunks.map((chunk, index) => (
                  <tr key={chunk.id || index}>
                    <td>
                      <span className={`type-tag tag-${chunk.type}`}>
                        {chunk.type === "article" ? "Điều" : "Khoản"}
                      </span>
                    </td>
                    <td
                      style={{
                        fontFamily: "monospace",
                        fontSize: "12px",
                      }}
                    >
                      {chunk.id}
                    </td>
                    <td
                      style={{
                        fontWeight: 600,
                        color: "var(--accent-blue)",
                      }}
                    >
                      {chunk.title}
                    </td>
                    <td>
                      <div className="chunk-content-cell" title={chunk.content}>
                        {chunk.content}
                      </div>
                    </td>
                    <td
                      style={{
                        color: "var(--text-dim)",
                        fontSize: "12px",
                      }}
                    >
                      {chunk.metadata?.part && `${chunk.metadata.part} • `}
                      {chunk.metadata?.chapter}
                    </td>
                    <td>
                      <button
                        className="btn-small"
                        onClick={() => {
                          const previewObj: VectorResult = {
                            id: chunk.id,
                            type: chunk.type,
                            title:
                              chunk.type === "clause"
                                ? chunk.metadata?.article_title
                                : chunk.title,
                            content: chunk.content,
                            article_id:
                              chunk.type === "clause"
                                ? chunk.article_id || ""
                                : chunk.id,
                            clause_number:
                              chunk.type === "clause"
                                ? chunk.clause_number
                                : undefined,
                            article_title:
                              chunk.type === "clause"
                                ? chunk.metadata?.article_title
                                : chunk.title,
                            _distance: 0,
                            score: 1,
                          };
                          setPreviewArticle(previewObj);
                        }}
                      >
                        <i className="fas fa-eye"></i> Xem
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: "40px" }} className="placeholder-text">
              Không tìm thấy chunks nào phù hợp.
            </div>
          )}
        </div>

        {chunksTotalPages > 1 && (
          <div className="pagination-container">
            <div>
              Trang {chunksPage} / {chunksTotalPages} (Hiển thị{" "}
              {(chunksPage - 1) * 20 + 1} -{" "}
              {Math.min(chunksPage * 20, chunksTotalItems)} trong số{" "}
              {chunksTotalItems} chunks)
            </div>
            <div className="pagination-buttons">
              <button
                className="pagination-btn"
                disabled={chunksPage === 1 || chunksLoading}
                onClick={() => setChunksPage(1)}
              >
                Đầu
              </button>
              <button
                className="pagination-btn"
                disabled={chunksPage === 1 || chunksLoading}
                onClick={() =>
                  setChunksPage((prev: number) => Math.max(prev - 1, 1))
                }
              >
                Trước
              </button>
              <button
                className="pagination-btn"
                disabled={chunksPage === chunksTotalPages || chunksLoading}
                onClick={() =>
                  setChunksPage((prev: number) =>
                    Math.min(prev + 1, chunksTotalPages),
                  )
                }
              >
                Sau
              </button>
              <button
                className="pagination-btn"
                disabled={chunksPage === chunksTotalPages || chunksLoading}
                onClick={() => setChunksPage(chunksTotalPages)}
              >
                Cuối
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
