import { nodeText } from "./graph-builder";
import { type ArticleItem, NO_TITLE } from "./types";

export function ArticleModal({
  article,
  onClose,
}: {
  article: ArticleItem;
  onClose: () => void;
}) {
  const clauses = article.clauses;
  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className="modal-content glass-card animate-zoom"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vw-article-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            {article.article_number !== undefined && (
              <span className="item-head badge">
                <span className="depth">ĐIỀU {article.article_number}</span>
              </span>
            )}
            <h2 id="vw-article-title">{article.title ?? NO_TITLE}</h2>
          </div>
          <button
            type="button"
            className="btn-close-lg"
            onClick={onClose}
            aria-label="Đóng"
            autoFocus
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
        <div className="modal-body">
          <div className="article-full-content">
            {article.content || "Không có nội dung cho điều luật này."}
          </div>
          {clauses.length > 0 && (
            <div className="article-clauses" style={{ marginTop: "16px" }}>
              <h4 style={{ color: "#a855f7", marginBottom: "8px" }}>
                Các Khoản:
              </h4>
              <div
                style={{ display: "flex", flexDirection: "column", gap: "8px" }}
              >
                {clauses.map((clause, idx) => (
                  <div
                    key={idx}
                    className="clause-item"
                    style={{
                      padding: "8px",
                      background: "rgba(255, 255, 255, 0.05)",
                      borderRadius: "4px",
                    }}
                  >
                    <span style={{ fontWeight: "bold", color: "#14b8a6" }}>
                      Khoản {clause.clause_number}:
                    </span>{" "}
                    {clause.text}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="modal-metadata-grid">
            <div className="meta-box">
              <label>Phần (Part)</label>
              <div className="meta-value">{nodeText(article.part)}</div>
            </div>
            <div className="meta-box">
              <label>Chương (Chapter)</label>
              <div className="meta-value">{nodeText(article.chapter)}</div>
            </div>
            {"score" in article && (
              <div className="meta-box">
                <label>Độ tương đồng</label>
                <div className="score-value highlight">
                  {Math.round(article.score * 100)}% Match
                </div>
              </div>
            )}
            {"depth" in article && (
              <div className="meta-box">
                <label>Khoảng cách đồ thị</label>
                <div>Bậc {article.depth}</div>
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="modern-action-btn primary"
            onClick={onClose}
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
