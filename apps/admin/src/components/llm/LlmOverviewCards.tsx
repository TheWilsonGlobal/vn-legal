interface LlmOverviewCardsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  llmStatus: any;
  endpointEditing: boolean;
  setEndpointEditing: (editing: boolean) => void;
  endpointDraft: string;
  setEndpointDraft: (draft: string) => void;
  endpointSaving: boolean;
  handleSaveEndpoint: () => Promise<void>;
  endpointError: string | null;
  setEndpointError: (error: string | null) => void;
  endpointNotice: string | null;
  setEndpointNotice: (notice: string | null) => void;
}

export function LlmOverviewCards({
  llmStatus,
  endpointEditing,
  setEndpointEditing,
  endpointDraft,
  setEndpointDraft,
  endpointSaving,
  handleSaveEndpoint,
  endpointError,
  setEndpointError,
  endpointNotice,
  setEndpointNotice,
}: LlmOverviewCardsProps) {
  return (
    <div
      className="stats-grid"
      style={{
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: "20px",
        marginTop: "20px",
      }}
    >
      <div className="stat-card animate-in">
        <div className="stat-icon purple">
          <i className="fas fa-robot"></i>
        </div>
        <div className="stat-info">
          <h3>Provider</h3>
          <div className="value" style={{ fontSize: "1.5rem" }}>
            {llmStatus?.provider?.toUpperCase() || "Tải..."}
          </div>
        </div>
      </div>
      <div className="stat-card animate-in" style={{ animationDelay: "0.1s" }}>
        <div className="stat-icon blue">
          <i className="fas fa-brain"></i>
        </div>
        <div className="stat-info">
          <h3>Model</h3>
          <div
            className="value"
            style={{
              fontSize: "1.1rem",
              textOverflow: "ellipsis",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {llmStatus?.model || "Tải..."}
          </div>
        </div>
      </div>
      <div className="stat-card animate-in" style={{ animationDelay: "0.2s" }}>
        <div className="stat-icon green">
          <i
            className={`fas ${llmStatus?.status === "connected" ? "fa-circle-check" : "fa-circle-xmark"}`}
          ></i>
        </div>
        <div className="stat-info">
          <h3>Trạng thái Kết nối</h3>
          <div className="value">
            <span
              className={`status-badge ${llmStatus?.status === "connected" ? "active" : "inactive"}`}
              style={{ fontSize: "1.1rem", padding: "4px 12px" }}
            >
              {llmStatus?.status === "connected" ? "Sẵn sàng" : "Mất kết nối"}
            </span>
          </div>
        </div>
      </div>
      <div className="stat-card animate-in" style={{ animationDelay: "0.3s" }}>
        <div className="stat-icon orange">
          <i className="fas fa-network-wired"></i>
        </div>
        <div className="stat-info" style={{ minWidth: 0, flex: 1 }}>
          <h3>
            Endpoint
            {llmStatus?.editableEndpoint && !endpointEditing && (
              <button
                onClick={() => {
                  setEndpointDraft(llmStatus?.apiUrl || "");
                  setEndpointError(null);
                  setEndpointNotice(null);
                  setEndpointEditing(true);
                }}
                title="Sửa endpoint"
                style={{
                  marginLeft: "8px",
                  background: "none",
                  border: "none",
                  color: "#8b5cf6",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: "0.85rem",
                }}
              >
                <i className="fas fa-pen-to-square"></i> Sửa
              </button>
            )}
          </h3>

          {endpointEditing ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                marginTop: "4px",
              }}
            >
              <input
                type="text"
                value={endpointDraft}
                autoFocus
                spellCheck={false}
                placeholder="http://localhost:5814"
                onChange={(e) => setEndpointDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveEndpoint();
                  if (e.key === "Escape") setEndpointEditing(false);
                }}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  border: "1px solid #3f3f52",
                  background: "#16161f",
                  color: "#e5e7eb",
                  fontSize: "0.85rem",
                  fontFamily: "monospace",
                }}
              />
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  className="btn-primary"
                  disabled={endpointSaving}
                  onClick={handleSaveEndpoint}
                  style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                >
                  {endpointSaving ? "Đang lưu..." : "Lưu"}
                </button>
                <button
                  onClick={() => {
                    setEndpointEditing(false);
                    setEndpointError(null);
                  }}
                  style={{
                    padding: "4px 10px",
                    fontSize: "0.8rem",
                    borderRadius: "6px",
                    border: "1px solid #3f3f52",
                    background: "transparent",
                    color: "#9ca3af",
                    cursor: "pointer",
                  }}
                >
                  Hủy
                </button>
                {llmStatus?.defaultApiUrl &&
                  endpointDraft !== llmStatus.defaultApiUrl && (
                    <button
                      title={`Mặc định: ${llmStatus.defaultApiUrl}`}
                      onClick={() => setEndpointDraft(llmStatus.defaultApiUrl)}
                      style={{
                        padding: "4px 10px",
                        fontSize: "0.8rem",
                        borderRadius: "6px",
                        border: "1px solid #3f3f52",
                        background: "transparent",
                        color: "#9ca3af",
                        cursor: "pointer",
                      }}
                    >
                      Mặc định
                    </button>
                  )}
              </div>
            </div>
          ) : (
            <div
              className="value"
              style={{ fontSize: "0.9rem", wordBreak: "break-all" }}
            >
              {llmStatus?.apiUrl || "N/A"}
            </div>
          )}

          {endpointError && (
            <div
              style={{
                color: "#f87171",
                fontSize: "0.78rem",
                marginTop: "6px",
              }}
            >
              {endpointError}
            </div>
          )}
          {endpointNotice && !endpointEditing && (
            <div
              style={{
                color:
                  llmStatus?.status === "connected" ? "#34d399" : "#fbbf24",
                fontSize: "0.78rem",
                marginTop: "6px",
              }}
            >
              {endpointNotice}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
