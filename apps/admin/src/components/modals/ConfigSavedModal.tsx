import type { AppConfig } from "../../types/index.ts";

interface ConfigSavedModalProps {
  show: boolean;
  onClose: () => void;
  tempVectorStoreType: string;
  config: AppConfig | null;
}

export function ConfigSavedModal({
  show,
  onClose,
  tempVectorStoreType,
  config,
}: ConfigSavedModalProps) {
  if (!show) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content glass-card animate-zoom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Xác nhận lưu cấu hình</h2>
          <button className="btn-close" onClick={onClose}>
            <i className="fas fa-times"></i>
          </button>
        </div>
        <div className="modal-body">
          {tempVectorStoreType !== config?.vectorStoreType ? (
            <>
              <div
                className="alert-warning"
                style={{
                  background: "rgba(245, 158, 11, 0.1)",
                  border: "1px solid rgba(245, 158, 11, 0.3)",
                  borderRadius: "8px",
                  padding: "16px",
                  marginBottom: "16px",
                }}
              >
                <i
                  className="fas fa-exclamation-triangle"
                  style={{ color: "#f59e0b", marginRight: "8px" }}
                ></i>
                <strong>Thay đổi được phát hiện!</strong>
              </div>
              <p style={{ marginBottom: "16px" }}>
                Bạn đã thay đổi loại Vector Store từ{" "}
                <strong>
                  {config?.vectorStoreType === "congraph"
                    ? "ConGraphDB"
                    : "LanceDB"}
                </strong>{" "}
                sang{" "}
                <strong>
                  {tempVectorStoreType === "congraph"
                    ? "ConGraphDB"
                    : "LanceDB"}
                </strong>
                .
              </p>
              <p style={{ marginBottom: "16px" }}>
                Để áp dụng thay đổi này, bạn cần:
              </p>
              <ol style={{ marginBottom: "16px", paddingLeft: "20px" }}>
                <li>
                  Cập nhật biến môi nghiệp{" "}
                  <code>VECTOR_STORE_TYPE={tempVectorStoreType}</code>
                </li>
                <li>Khởi động lại server (npm run dev)</li>
                <li>
                  Nếu chuyển sang ConGraphDB lần đầu: Chạy{" "}
                  <code>npm run build-index</code>
                </li>
              </ol>
            </>
          ) : (
            <>
              <div
                className="alert-success"
                style={{
                  background: "rgba(16, 185, 129, 0.1)",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                  borderRadius: "8px",
                  padding: "16px",
                  marginBottom: "16px",
                }}
              >
                <i
                  className="fas fa-check-circle"
                  style={{ color: "#10b981", marginRight: "8px" }}
                ></i>
                <strong>Cấu hình đã được xác nhận!</strong>
              </div>
              <p style={{ marginBottom: "16px" }}>
                Cấu hình hiện tại của hệ thống đã được xác nhận. Không có thay
                đổi nào được thực hiện.
              </p>
              <p style={{ marginBottom: "16px", opacity: 0.7 }}>
                <small>
                  Lưu ý: Để thay đổi cấu hình hệ thống, vui lòng sửa file{" "}
                  <code>.env</code> hoặc biến môi trường và khởi động lại
                  server.
                </small>
              </p>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>
            Đã hiểu
          </button>
        </div>
      </div>
    </div>
  );
}
