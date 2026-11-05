import type React from "react";
import type {
  VectorStoreStatus,
  AppConfig,
  AdminStats,
} from "../../types/index.ts";

interface VectorGeneralTabProps {
  vectorStoreStatus: VectorStoreStatus | null;
  config: AppConfig | null;
  stats: AdminStats | null;
  handleFileUpload: (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => Promise<void>;
  uploadLoading: boolean;
  uploadMessage: string;
}

export function VectorGeneralTab({
  vectorStoreStatus,
  config,
  stats,
  handleFileUpload,
  uploadLoading,
  uploadMessage,
}: VectorGeneralTabProps) {
  return (
    <div className="animate-zoom">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-info">
            <h3>Loại Vector Store</h3>
            <div className="value">
              {!vectorStoreStatus
                ? "Đang tải..."
                : vectorStoreStatus.type === "congraph"
                  ? "ConGraphDB"
                  : "LanceDB"}
            </div>
            <span>
              {vectorStoreStatus?.ready ? "Đã kết nối" : "Chưa kết nối"}
            </span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-info">
            <h3>Kích thước Vector</h3>
            <div className="value">{config?.embeddingDimension || 384}</div>
            <span>
              {config?.embeddingModel ||
                "paraphrase-multilingual-MiniLM-L12-v2"}
            </span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-info">
            <h3>Tổng số Chunks</h3>
            <div className="value">{stats?.vector?.total_chunks || "..."}</div>
            <span>Tất cả các bảng</span>
          </div>
        </div>
      </div>
      <div className="card" style={{ marginTop: "20px" }}>
        <div className="card-header">
          <h2>Thêm mới Vector Store</h2>
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
              <i className="fas fa-file-export"></i>
            </div>
            <h3>Tải lên tệp tri thức mới</h3>
            <p style={{ fontSize: "12px" }}>
              Tự động bổ sung vào Vector Index mà không xóa dữ liệu cũ
            </p>

            <label
              className="btn-primary"
              style={{
                cursor: "pointer",
                display: "inline-block",
                marginTop: "15px",
              }}
            >
              <i className="fas fa-plus-circle"></i> Chọn tệp JSON
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
              <i className="fas fa-info-circle"></i> Cập nhật bổ sung
            </h4>
            <ul style={{ fontSize: "13px", lineHeight: "1.6" }}>
              <li>
                Dữ liệu mới sẽ được Vector hóa và lưu trữ vào{" "}
                {vectorStoreStatus?.type === "congraph"
                  ? "ConGraphDB"
                  : "LanceDB"}
                .
              </li>
              <li>
                Sử dụng model:{" "}
                {config?.embeddingModel ||
                  "paraphrase-multilingual-MiniLM-L12-v2"}
                .
              </li>
              <li>
                Tìm kiếm ngữ nghĩa sẽ khả dụng ngay sau khi quá trình tải lên
                hoàn tất.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
