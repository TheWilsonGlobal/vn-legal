import type { AppConfig } from "../types/index.ts";

interface SettingsViewProps {
  tempClientGraphMode: string;
  setTempClientGraphMode: (mode: string) => void;
  tempVectorStoreType: string;
  setTempVectorStoreType: (type: string) => void;
  config: AppConfig | null;
  handleSaveConfig: () => Promise<void>;
}

export function SettingsView({
  tempClientGraphMode,
  setTempClientGraphMode,
  tempVectorStoreType,
  setTempVectorStoreType,
  config,
  handleSaveConfig,
}: SettingsViewProps) {
  return (
    <div className="view-section" key="settings">
      <div className="view-header">
        <h2>Cấu hình hệ thống</h2>
      </div>
      <div className="card">
        <div className="card-body">
          <form className="settings-form" onSubmit={(e) => e.preventDefault()}>
            <div className="form-group">
              <label>Đường dẫn Database Graph</label>
              <input type="text" value="/storage/graph.cgraph" readOnly />
            </div>
            <div className="form-group">
              <label>Chế độ hiển thị đồ thị của Client</label>
              <select
                value={tempClientGraphMode}
                onChange={(e) => setTempClientGraphMode(e.target.value)}
              >
                <option value="query">Kết quả Truy vấn (Mặc định)</option>
                <option value="explorer">Đồ thị Tổng thể (Sigma)</option>
              </select>
              <small className="text-muted">
                Thay đổi cách hiển thị đồ thị bên ứng dụng người dùng.
              </small>
            </div>
            <div className="form-group">
              <label>Loại Vector Store</label>
              <select
                value={tempVectorStoreType || "congraph"}
                onChange={(e) => setTempVectorStoreType(e.target.value)}
              >
                <option value="congraph">ConGraphDB (Khuyên dùng)</option>
                <option value="lancedb">LanceDB</option>
              </select>
              <small className="text-muted">
                {tempVectorStoreType !== config?.vectorStoreType
                  ? "⚠️ Thay đổi này sẽ có hiệu lực sau khi khởi động lại server."
                  : "Lưu ý: Chuyển đổi loại Vector Store sẽ yêu cầu xây dựng lại chỉ mục vector."}
              </small>
            </div>
            <div className="form-group">
              <label>Model Embedding</label>
              <input
                type="text"
                value={
                  config?.embeddingModel ||
                  "paraphrase-multilingual-MiniLM-L12-v2"
                }
                readOnly
              />
            </div>
            <div className="form-group">
              <label>Hệ thống Embedding (Backend)</label>
              <input
                type="text"
                value={
                  config?.embeddingBackend === "api"
                    ? "Python API (FastAPI)"
                    : "WebAssembly (transformers.js)"
                }
                readOnly
              />
              <small className="text-muted">
                {config?.embeddingBackend === "api"
                  ? "🚀 Đang sử dụng Python service cho hiệu suất cao."
                  : "🐢 Đang sử dụng WebAssembly chạy tại Node.js (Chậm hơn)."}
              </small>
            </div>
            <div className="form-group">
              <label>Kích thước Vector</label>
              <input
                type="text"
                value={config?.embeddingDimension || 384}
                readOnly
              />
            </div>
            <div className="form-group">
              <label>Model LLM sử dụng</label>
              <select value={config?.llmModel || "gpt-4o"}>
                <option value="gpt-4o">GPT-4o (Khuyên dùng)</option>
              </select>
            </div>
            <div className="form-actions">
              <button className="btn-primary" onClick={handleSaveConfig}>
                Lưu cấu hình
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
