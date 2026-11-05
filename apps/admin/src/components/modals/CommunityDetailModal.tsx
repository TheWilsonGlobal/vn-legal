import type { Community } from "../../types/index.ts";

interface CommunityDetailModalProps {
  selectedCommunity: Community | null;
  onClose: () => void;
}

export function CommunityDetailModal({
  selectedCommunity,
  onClose,
}: CommunityDetailModalProps) {
  if (!selectedCommunity) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content admin-modal glass-card animate-zoom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="header-title-group">
            <span
              className={`level-badge ${selectedCommunity.level === 0 ? "part" : "chapter"}`}
            >
              {selectedCommunity.level === 0 ? "PHẦN" : "CHƯƠNG"}
            </span>
            <h2>{selectedCommunity.title}</h2>
          </div>
          <button className="btn-close" onClick={onClose}>
            <i className="fas fa-times"></i>
          </button>
        </div>
        <div className="modal-body scrollable">
          <div className="modal-stats-row">
            <div className="m-stat">
              <label>Đánh giá</label>
              <div className="v">{selectedCommunity.rating}/10</div>
            </div>
            <div className="m-stat">
              <label>Số lượng Điều luật</label>
              <div className="v">{selectedCommunity.article_count} Điều</div>
            </div>
          </div>

          <div className="modal-section">
            <h3>
              <i className="fas fa-lightbulb"></i> Nguyên tắc cốt lõi
            </h3>
            <div className="principles-box">
              {selectedCommunity.principles || "N/A"}
            </div>
          </div>

          <div className="modal-section">
            <h3>
              <i className="fas fa-align-left"></i> Tóm tắt chi tiết
            </h3>
            <p className="full-summary">{selectedCommunity.summary}</p>
          </div>

          <div className="modal-section">
            <h3>
              <i className="fas fa-search"></i> Các phát hiện (Findings)
            </h3>
            <ul className="finding-list">
              {(selectedCommunity.findings || []).map(
                (
                  f: string | { explanation: string; articles?: string[] },
                  idx: number,
                ) => (
                  <li key={idx} className="finding-item">
                    <strong>{typeof f === "string" ? f : f.explanation}</strong>
                    {typeof f !== "string" && f.articles && (
                      <p>Cơ sở: {f.articles?.join(", ")}</p>
                    )}
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
