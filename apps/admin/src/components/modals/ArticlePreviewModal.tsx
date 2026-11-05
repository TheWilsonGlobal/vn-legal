import type { VectorResult } from "../../types/index.ts";

interface ArticlePreviewModalProps {
  previewArticle: VectorResult | null;
  onClose: () => void;
}

export function ArticlePreviewModal({
  previewArticle,
  onClose,
}: ArticlePreviewModalProps) {
  if (!previewArticle) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content glass-card animate-zoom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="result-id-badge">{previewArticle.article_id}</span>
            <h2>
              {previewArticle.title || `Điều ${previewArticle.article_number}`}
            </h2>
          </div>
          <button className="btn-close-lg" onClick={onClose}>
            <i className="fas fa-times"></i>
          </button>
        </div>
        <div className="modal-body">
          <div className="article-full-content">{previewArticle.content}</div>

          <div className="modal-metadata-grid">
            <div className="meta-box">
              <label>Phần (Part)</label>
              <div>{previewArticle.part || "N/A"}</div>
            </div>
            <div className="meta-box">
              <label>Chương (Chapter)</label>
              <div>{previewArticle.chapter || "N/A"}</div>
            </div>
            <div className="meta-box">
              <label>Từ khóa</label>
              <div>{previewArticle.keywords || "None"}</div>
            </div>
            <div className="meta-box">
              <label>Độ tương đồng</label>
              <div className="score-value score-high">
                {Math.round((1 - previewArticle._distance) * 100)}%
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
