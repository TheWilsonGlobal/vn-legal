interface LlmPromptLogsPanelProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  llmLog: any;
}

export function LlmPromptLogsPanel({ llmLog }: LlmPromptLogsPanelProps) {
  return (
    <div className="card animate-in">
      <div className="card-header">
        <h2>Lần truy vấn LLM gần nhất</h2>
        {llmLog?.timestamp && (
          <span className="badge-dim" style={{ fontSize: "0.8rem" }}>
            {new Date(llmLog.timestamp).toLocaleString()}
          </span>
        )}
      </div>
      <div
        className="card-body"
        style={{ display: "flex", flexDirection: "column", gap: "16px" }}
      >
        <div>
          <h4
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              color: "#8b5cf6",
              marginBottom: "8px",
            }}
          >
            <i className="fas fa-terminal"></i> System Prompt (Chỉ dẫn hệ thống)
          </h4>
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              padding: "12px",
              borderRadius: "6px",
              fontSize: "0.9rem",
              border: "1px solid rgba(255,255,255,0.05)",
              maxHeight: "150px",
              overflowY: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {llmLog?.systemPrompt || "Chưa có log hệ thống."}
          </div>
        </div>

        <div>
          <h4
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              color: "#3b82f6",
              marginBottom: "8px",
            }}
          >
            <i className="fas fa-user"></i> User Prompt & retrieved Context (Câu
            hỏi & ngữ cảnh)
          </h4>
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              padding: "12px",
              borderRadius: "6px",
              fontSize: "0.9rem",
              border: "1px solid rgba(255,255,255,0.05)",
              maxHeight: "250px",
              overflowY: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {llmLog?.userPrompt || "Chưa có log truy vấn người dùng."}
          </div>
        </div>

        <div>
          <h4
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              color: "#10b981",
              marginBottom: "8px",
            }}
          >
            <i className="fas fa-comment-dots"></i> LLM Response (Kết quả trả
            về)
          </h4>
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              padding: "12px",
              borderRadius: "6px",
              fontSize: "0.9rem",
              border: "1px solid rgba(255,255,255,0.05)",
              maxHeight: "250px",
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              color: "#f1f5f9",
            }}
          >
            {llmLog?.response || "Chưa có kết quả phản hồi."}
          </div>
        </div>
      </div>
    </div>
  );
}
