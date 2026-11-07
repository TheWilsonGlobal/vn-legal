import type { ConsultCommunityReport } from "../../types/agent";
import { textOr } from "./graph-builder";
import { NO_SUMMARY, NO_TITLE } from "./types";

export function ReportModal({
  report,
  onClose,
}: {
  report: ConsultCommunityReport;
  onClose: () => void;
}) {
  const findings = report.findings;
  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className="modal-content glass-card global-modal animate-zoom"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vw-report-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="item-head badge global-badge">
              <i className="fas fa-globe-asia"></i> GLOBAL REPORT
            </span>
            <h2 id="vw-report-title">{textOr(report.title, NO_TITLE)}</h2>
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
        <div className="modal-body scrollable-modal-body">
          <div className="report-summary-box">
            <h3>
              <i className="fas fa-align-left"></i> Tóm tắt vĩ mô
            </h3>
            <p>{textOr(report.summary, NO_SUMMARY)}</p>
          </div>
          {findings.length > 0 && (
            <div className="report-section">
              <h3>
                <i className="fas fa-search"></i> Các phát hiện chính
              </h3>
              <div className="findings-grid-client">
                {findings.map((finding, i) => (
                  <div key={i} className="finding-card-client">
                    <span className="finding-num">{i + 1}</span>
                    <p>{finding}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="modal-metadata-grid">
            <div className="meta-box">
              <label>Độ tin cậy (Rating)</label>
              <div className="meta-value highlight-gold">
                <i className="fas fa-star"></i> {report.rating}/10
              </div>
            </div>
            <div className="meta-box">
              <label>Cấp độ phân tích</label>
              <div className="meta-value">
                {report.level === 0
                  ? "Phần (Part Level)"
                  : "Chương (Chapter Level)"}
              </div>
            </div>
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
