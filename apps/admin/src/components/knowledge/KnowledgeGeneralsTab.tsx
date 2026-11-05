import type React from "react";
import type { AdminStats } from "../../types/index.ts";

interface KnowledgeGeneralsTabProps {
  stats: AdminStats | null;
  handleFileUpload: (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => Promise<void>;
  uploadLoading: boolean;
  uploadMessage: string;
}

export function KnowledgeGeneralsTab({
  stats,
  handleFileUpload,
  uploadLoading,
  uploadMessage,
}: KnowledgeGeneralsTabProps) {
  return (
    <div className="animate-zoom">
      <div className="card" style={{ marginBottom: "24px" }}>
        <div className="card-header">
          <h2>Trạng thái dữ liệu hiện tại</h2>
        </div>
        <div className="card-body">
          <div
            className="stats-grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "16px",
              marginBottom: 0,
            }}
          >
            <div className="stat-card mini purple">
              <div className="stat-mini-info">
                <span className="label">Tổng số Phân</span>
                <span className="value">{stats?.graph?.Part || 0}</span>
              </div>
              <div className="mini-icon">
                <i className="fas fa-layer-group"></i>
              </div>
            </div>
            <div className="stat-card mini blue">
              <div className="stat-mini-info">
                <span className="label">Chương</span>
                <span className="value">{stats?.graph?.Chapter || 0}</span>
              </div>
              <div className="mini-icon">
                <i className="fas fa-book"></i>
              </div>
            </div>
            <div className="stat-card mini green">
              <div className="stat-mini-info">
                <span className="label">Điều luật</span>
                <span className="value">{stats?.graph?.Article || 0}</span>
              </div>
              <div className="mini-icon">
                <i className="fas fa-gavel"></i>
              </div>
            </div>
            <div className="stat-card mini orange">
              <div className="stat-mini-info">
                <span className="label">Khoản</span>
                <span className="value">{stats?.graph?.Clause || 0}</span>
              </div>
              <div className="mini-icon">
                <i className="fas fa-list-ol"></i>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "24px" }}>
        <div className="card-header">
          <h2>Thêm mới dữ liệu pháp luật</h2>
        </div>
        <div
          className="card-body"
          style={{
            display: "flex",
            gap: "24px",
            alignItems: "center",
          }}
        >
          <div
            className="upload-container"
            style={{ flex: 1, padding: "20px" }}
          >
            <div
              className="upload-icon"
              style={{ fontSize: "32px", marginBottom: "10px" }}
            >
              <i className="fas fa-cloud-upload-alt"></i>
            </div>
            <h3>Kéo thả hoặc chọn tệp JSON</h3>
            <p style={{ fontSize: "12px" }}>
              Hỗ trợ tệp định dạng .json theo cấu trúc dữ liệu VinaLegal
            </p>

            <label
              className="btn-primary"
              style={{
                cursor: "pointer",
                display: "inline-block",
                marginTop: "15px",
              }}
            >
              <i className="fas fa-file-import"></i> Chọn tệp dữ liệu
              <input
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                style={{ display: "none" }}
              />
            </label>

            {uploadLoading && (
              <div style={{ marginTop: "15px" }}>
                <div
                  className="spinner"
                  style={{
                    margin: "0 auto 10px",
                    width: "20px",
                    height: "20px",
                  }}
                ></div>
                <p style={{ fontSize: "13px" }}>{uploadMessage}</p>
              </div>
            )}

            {!uploadLoading && uploadMessage && (
              <div
                style={{
                  marginTop: "15px",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  background: uploadMessage.startsWith("Thành công")
                    ? "rgba(16, 185, 129, 0.1)"
                    : "rgba(239, 68, 68, 0.1)",
                  color: uploadMessage.startsWith("Thành công")
                    ? "#10b981"
                    : "#ef4444",
                  border: `1px solid ${uploadMessage.startsWith("Thành công") ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)"}`,
                }}
              >
                {uploadMessage}
              </div>
            )}
          </div>

          <div
            className="info-box"
            style={{ flex: 1, height: "100%", margin: 0 }}
          >
            <h4 style={{ fontSize: "14px", marginBottom: "10px" }}>
              <i className="fas fa-info-circle"></i> Hướng dẫn
            </h4>
            <ul style={{ fontSize: "13px", lineHeight: "1.6" }}>
              <li>
                Dữ liệu sau khi tải lên sẽ được tự động cập nhật vào Knowledge
                Graph và Vector Store.
              </li>
              <li>
                Hệ thống sẽ thực hiện phân tích cấu trúc Điều/Khoản/Điểm và các
                mối quan hệ tham chiếu.
              </li>
              <li>
                Dữ liệu mới sẽ khả dụng cho cả tìm kiếm đồ thị và tìm kiếm ngữ
                nghĩa ngay lập tức.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
