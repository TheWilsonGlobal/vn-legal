interface LlmDiagnosticPanelProps {
  diagPrompt: string;
  setDiagPrompt: (prompt: string) => void;
  diagLoading: boolean;
  handleRunDiagnostic: () => Promise<void>;
  diagResponse: string | null;
  diagDuration: number | null;
  diagError: string | null;
}

export function LlmDiagnosticPanel({
  diagPrompt,
  setDiagPrompt,
  diagLoading,
  handleRunDiagnostic,
  diagResponse,
  diagDuration,
  diagError,
}: LlmDiagnosticPanelProps) {
  return (
    <div className="card animate-in" style={{ animationDelay: "0.1s" }}>
      <div className="card-header">
        <h2>Diagnostic Console (Chẩn đoán)</h2>
      </div>
      <div
        className="card-body"
        style={{ display: "flex", flexDirection: "column", gap: "16px" }}
      >
        <div className="form-group">
          <label
            style={{
              display: "block",
              marginBottom: "8px",
              fontSize: "0.9rem",
            }}
          >
            Diagnostic Test Prompt
          </label>
          <textarea
            className="modern-input"
            style={{
              width: "100%",
              height: "80px",
              padding: "10px",
              borderRadius: "6px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#fff",
              resize: "none",
            }}
            value={diagPrompt}
            onChange={(e) => setDiagPrompt(e.target.value)}
          />
        </div>

        <button
          className="btn-primary"
          style={{
            width: "100%",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "8px",
          }}
          onClick={handleRunDiagnostic}
          disabled={diagLoading}
        >
          {diagLoading ? (
            <>
              <i className="fas fa-spinner fa-spin"></i> Đang chạy...
            </>
          ) : (
            <>
              <i className="fas fa-vial"></i> Gửi truy vấn test
            </>
          )}
        </button>

        <div
          className="panel-divider"
          style={{
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            margin: "8px 0",
          }}
        ></div>

        <div>
          <h4
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "0.95rem",
              color: "#f59e0b",
              marginBottom: "8px",
            }}
          >
            <i className="fas fa-vials"></i> Kết quả chẩn đoán
          </h4>
          {diagLoading && (
            <div
              style={{
                color: "rgba(255,255,255,0.5)",
                fontSize: "0.9rem",
              }}
            >
              Đang chờ kết quả từ LLM...
            </div>
          )}

          {diagResponse && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div
                style={{
                  background: "rgba(20,184,166,0.1)",
                  border: "1px solid rgba(20,184,166,0.3)",
                  padding: "10px",
                  borderRadius: "6px",
                  color: "#14b8a6",
                  fontSize: "0.85rem",
                }}
              >
                <i className="fas fa-check-circle"></i> Kết nối thành công! Thời
                gian xử lý: <strong>{diagDuration}ms</strong>
              </div>
              <div
                style={{
                  background: "rgba(0,0,0,0.3)",
                  padding: "10px",
                  borderRadius: "6px",
                  fontSize: "0.85rem",
                  border: "1px solid rgba(255,255,255,0.05)",
                  maxHeight: "150px",
                  overflowY: "auto",
                }}
              >
                {diagResponse}
              </div>
            </div>
          )}

          {diagError && (
            <div
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                padding: "10px",
                borderRadius: "6px",
                color: "#ef4444",
                fontSize: "0.85rem",
              }}
            >
              <i className="fas fa-exclamation-circle"></i> Kết nối thất bại:{" "}
              <br />
              <code style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>
                {diagError}
              </code>
            </div>
          )}

          {!diagLoading && !diagResponse && !diagError && (
            <div
              style={{
                color: "rgba(255,255,255,0.3)",
                fontSize: "0.85rem",
                textAlign: "center",
                padding: "20px 0",
              }}
            >
              Chưa chạy chẩn đoán kết nối.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
