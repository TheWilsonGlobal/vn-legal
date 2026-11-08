import { useState, useCallback, useEffect } from "react";
import { getMemoryStats } from "../../api/agent";
import type { ObservabilityStatus } from "../../types/agent";
import type { ViewProps } from "../../types/views";
import "../../styles/views.css";
import { useApiResource } from "../sessions/useApiResource";

const LANGFUSE_LABEL: Record<
  ObservabilityStatus["langfuse"],
  { text: string; tone: "green" | "grey" | "amber" | "red" }
> = {
  enabled: { text: "Đang bật", tone: "green" },
  disabled_by_config: { text: "Tắt theo cấu hình", tone: "grey" },
  disabled_missing_keys: { text: "Tắt: thiếu khoá", tone: "amber" },
  degraded_export_errors: { text: "Suy giảm: lỗi xuất", tone: "red" },
};

const CAPTURE_LABEL: Record<ObservabilityStatus["capture"], string> = {
  full: "full (đầy đủ)",
  masked: "masked (đã che)",
  metadata_only: "metadata_only (chỉ siêu dữ liệu)",
};

interface ToolItem {
  id: string;
  name: string;
  funcName: string;
  type: string;
  badge: "primary" | "info" | "success" | "warning";
  description: string;
  parameters: string;
  usageInPipeline: string;
}

// The four tools the chat agent registers (apps/server/src/agent/graph/tools.ts).
const AGENT_TOOLS: ToolItem[] = [
  {
    id: "search_legal_articles",
    name: "Tra cứu điều luật (Search Legal Articles)",
    funcName: "search_legal_articles",
    type: "Hybrid Retrieval",
    badge: "primary",
    description:
      "Tìm các điều luật khớp ngữ nghĩa, mở rộng theo đồ thị tham chiếu giữa các điều, và kèm báo cáo tổng quan cộng đồng.",
    parameters: "query (string, tối đa 500 ký tự)",
    usageInPipeline:
      "Model gọi ở đầu lượt để tìm căn cứ pháp lý. Mỗi lượt gọi cho kết quả gồm điều khớp ngữ nghĩa, điều qua tham chiếu và báo cáo cộng đồng.",
  },
  {
    id: "get_article",
    name: "Lấy một điều luật (Get Article)",
    funcName: "get_article",
    type: "Lookup",
    badge: "info",
    description: "Lấy nội dung đúng một điều luật theo số điều.",
    parameters: "article_number (number, từ 1 đến 100000)",
    usageInPipeline:
      "Model gọi khi người dùng hỏi trực tiếp một điều cụ thể, ví dụ Điều 25.",
  },
  {
    id: "get_community_context",
    name: "Báo cáo tổng quan cộng đồng (Community Context)",
    funcName: "get_community_context",
    type: "Global Synthesis",
    badge: "warning",
    description:
      "Lấy các báo cáo tổng quan (community reports) về một chủ đề pháp luật.",
    parameters: "query (string, tối đa 500 ký tự)",
    usageInPipeline:
      "Model gọi khi câu hỏi mang tính khái quát hoặc tổng hợp theo chủ đề.",
  },
  {
    id: "recall_session",
    name: "Nhớ lại phiên hiện tại (Recall Session)",
    funcName: "recall_session",
    type: "Session Memory",
    badge: "success",
    description:
      "Tìm câu hỏi hoặc câu trả lời trước đó trong chính phiên này. Không đọc phiên khác.",
    parameters: "key (string, tối đa 200 ký tự)",
    usageInPipeline:
      "Model gọi khi người dùng hỏi lại nội dung đã trao đổi trong phiên.",
  },
];

type SectionKey = "llm" | "embedding" | "langfuse" | "memory" | "tools";

export default function SettingsView(props: ViewProps) {
  const { active, info, refreshInfo, setHierarchyControls } = props;
  const memory = useApiResource(active, "memory", (signal) =>
    getMemoryStats(signal),
  );

  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    llm: true,
    embedding: true,
    langfuse: true,
    memory: true,
    tools: true,
  });

  const toggleSection = (key: SectionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const expandAll = useCallback(() => {
    setOpenSections({
      llm: true,
      embedding: true,
      langfuse: true,
      memory: true,
      tools: true,
    });
  }, []);

  const collapseAll = useCallback(() => {
    setOpenSections({
      llm: false,
      embedding: false,
      langfuse: false,
      memory: false,
      tools: false,
    });
  }, []);

  // Hook into topbar header hierarchy controls when Settings view is active
  useEffect(() => {
    if (!active) return;
    setHierarchyControls?.({
      expandAll,
      collapseAll,
      turnCount: 5,
    });
    return () => {
      setHierarchyControls?.(null);
    };
  }, [active, expandAll, collapseAll, setHierarchyControls]);

  const reloadAll = () => {
    refreshInfo();
    memory.reload();
  };

  const m = memory.resource;
  const allOpen = Object.values(openSections).every(Boolean);

  return (
    <div className="vw-page">
      <div className="vw-head">
        <h2>Cài đặt</h2>
        <div className="vw-head-actions">
          <button
            type="button"
            className="vw-btn small"
            onClick={allOpen ? collapseAll : expandAll}
            title={allOpen ? "Thu gọn tất cả các phần" : "Mở rộng tất cả các phần"}
          >
            <span aria-hidden="true">{allOpen ? "▸▸ " : "▾▾ "}</span>
            {allOpen ? "Thu gọn tất cả" : "Mở rộng tất cả"}
          </button>
          <button type="button" className="vw-btn" onClick={reloadAll}>
            Làm mới
          </button>
        </div>
      </div>
      <p className="muted">
        Chỉ đọc. Cấu hình endpoint được sửa trong ứng dụng quản trị; giá trị
        khoá API không bao giờ được hiển thị ở đây.
      </p>

      {info.status === "loading" && (
        <div className="vw-state" role="status">
          Đang tải cấu hình...
        </div>
      )}
      {info.status === "error" && (
        <div className="vw-alert" role="alert">
          Không tải được cấu hình tác tử (C9): {info.message}{" "}
          <button type="button" className="link-btn" onClick={refreshInfo}>
            Thử lại
          </button>
        </div>
      )}

      {info.status === "ready" && (
        <>
          {/* Panel 1: Mô hình ngôn ngữ (LLM) */}
          <section className="vw-section" aria-labelledby="vw-set-llm">
            <button
              type="button"
              className="vw-section-head"
              onClick={() => toggleSection("llm")}
              aria-expanded={openSections.llm}
            >
              <h3 id="vw-set-llm">
                <span className="vw-section-chevron" aria-hidden="true">
                  {openSections.llm ? "▾" : "▸"}
                </span>
                Mô hình ngôn ngữ (LLM)
              </h3>
              <span className="muted" style={{ fontSize: "12px" }}>
                {info.info.model} · {info.info.tool_mode}
              </span>
            </button>
            {openSections.llm && (
              <div className="vw-section-body">
                <dl className="vw-kv">
                  <dt>Provider</dt>
                  <dd>{info.info.provider}</dd>
                  <dt>Model</dt>
                  <dd className="mono">{info.info.model}</dd>
                  <dt>Endpoint</dt>
                  <dd className="mono">{info.info.endpoint}</dd>
                  <dt>tool_mode</dt>
                  <dd>{info.info.tool_mode}</dd>
                  <dt>max_steps</dt>
                  <dd>{info.info.max_steps}</dd>
                  <dt>Trạng thái</dt>
                  <dd>
                    <span
                      className={`vw-badge ${
                        info.info.llm_status === "connected" ? "green" : "red"
                      }`}
                    >
                      {info.info.llm_status === "connected"
                        ? "connected"
                        : "disconnected"}
                    </span>
                  </dd>
                </dl>
              </div>
            )}
          </section>

          {/* Panel 2: Embedding */}
          <section className="vw-section" aria-labelledby="vw-set-emb">
            <button
              type="button"
              className="vw-section-head"
              onClick={() => toggleSection("embedding")}
              aria-expanded={openSections.embedding}
            >
              <h3 id="vw-set-emb">
                <span className="vw-section-chevron" aria-hidden="true">
                  {openSections.embedding ? "▾" : "▸"}
                </span>
                Embedding
              </h3>
              <span className="muted" style={{ fontSize: "12px" }}>
                {info.info.embedding.model} ({info.info.embedding.dim}d)
              </span>
            </button>
            {openSections.embedding && (
              <div className="vw-section-body">
                <dl className="vw-kv">
                  <dt>Provider</dt>
                  <dd>{info.info.embedding.provider}</dd>
                  <dt>Model</dt>
                  <dd className="mono">{info.info.embedding.model}</dd>
                  <dt>Số chiều (dim)</dt>
                  <dd>{info.info.embedding.dim}</dd>
                  <dt>index_id</dt>
                  <dd className="mono">{info.info.embedding.index_id}</dd>
                </dl>
              </div>
            )}
          </section>

          {/* Panel 3: Danh sách công cụ tác tử (Tool uses list) */}
          <section className="vw-section" aria-labelledby="vw-set-tools">
            <button
              type="button"
              className="vw-section-head"
              onClick={() => toggleSection("tools")}
              aria-expanded={openSections.tools}
            >
              <h3 id="vw-set-tools">
                <span className="vw-section-chevron" aria-hidden="true">
                  {openSections.tools ? "▾" : "▸"}
                </span>
                Danh sách công cụ tác tử ({AGENT_TOOLS.length} công cụ)
              </h3>
              <span className="muted" style={{ fontSize: "12px" }}>
                Chế độ gọi: {info.info.tool_mode} · Tối đa {info.info.max_steps} bước
              </span>
            </button>
            {openSections.tools && (
              <div className="vw-section-body">
                <div className="vw-tools-list">
                  {AGENT_TOOLS.map((t) => (
                    <div key={t.id} className="vw-tool-card">
                      <div className="vw-tool-head">
                        <div className="vw-tool-title-group">
                          <span className="vw-tool-name">{t.name}</span>
                          <code className="vw-tool-func mono">{t.funcName}</code>
                        </div>
                        <span className={`vw-tool-badge ${t.badge}`}>
                          {t.type}
                        </span>
                      </div>
                      <p className="vw-tool-desc">{t.description}</p>
                      <dl className="vw-tool-meta">
                        <dt>Tham số:</dt>
                        <dd className="mono">{t.parameters}</dd>
                        <dt>Vị trí pipeline:</dt>
                        <dd>{t.usageInPipeline}</dd>
                      </dl>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Panel 4: Langfuse (quan sát) */}
          <section className="vw-section" aria-labelledby="vw-set-lf">
            <button
              type="button"
              className="vw-section-head"
              onClick={() => toggleSection("langfuse")}
              aria-expanded={openSections.langfuse}
            >
              <h3 id="vw-set-lf">
                <span className="vw-section-chevron" aria-hidden="true">
                  {openSections.langfuse ? "▾" : "▸"}
                </span>
                Langfuse (quan sát)
              </h3>
              <span
                className={`vw-badge ${
                  LANGFUSE_LABEL[info.info.observability.langfuse].tone
                }`}
                style={{ fontSize: "11px" }}
              >
                {LANGFUSE_LABEL[info.info.observability.langfuse].text}
              </span>
            </button>
            {openSections.langfuse && (
              <div className="vw-section-body">
                <dl className="vw-kv">
                  <dt>Trạng thái</dt>
                  <dd>
                    <span
                      className={`vw-badge ${
                        LANGFUSE_LABEL[info.info.observability.langfuse].tone
                      }`}
                    >
                      {LANGFUSE_LABEL[info.info.observability.langfuse].text}
                    </span>
                  </dd>
                  <dt>Lý do</dt>
                  <dd>{info.info.observability.reason ?? "—"}</dd>
                  <dt>Chế độ ghi (capture)</dt>
                  <dd>{CAPTURE_LABEL[info.info.observability.capture]}</dd>
                  {info.info.observability.langfuse ===
                    "degraded_export_errors" && (
                    <>
                      <dt>Số lỗi xuất</dt>
                      <dd>{info.info.observability.export_errors}</dd>
                      <dt>Lỗi gần nhất</dt>
                      <dd>{info.info.observability.last_error_at ?? "—"}</dd>
                    </>
                  )}
                </dl>
              </div>
            )}
          </section>
        </>
      )}

      {/* Panel 5: Bộ nhớ (C10) */}
      <section className="vw-section" aria-labelledby="vw-set-mem">
        <button
          type="button"
          className="vw-section-head"
          onClick={() => toggleSection("memory")}
          aria-expanded={openSections.memory}
        >
          <h3 id="vw-set-mem">
            <span className="vw-section-chevron" aria-hidden="true">
              {openSections.memory ? "▾" : "▸"}
            </span>
            Bộ nhớ (C10)
          </h3>
          {m.status === "ready" && (
            <span className="muted" style={{ fontSize: "12px" }}>
              {m.data.short_term.active_sessions} phiên hoạt động ·{" "}
              {m.data.store.sessions} phiên lưu trữ
            </span>
          )}
        </button>
        {openSections.memory && (
          <div className="vw-section-body">
            {m.status === "loading" && (
              <div className="muted" role="status">
                Đang tải số liệu bộ nhớ...
              </div>
            )}
            {m.status === "error" && (
              <div className="vw-alert" role="alert">
                Không tải được số liệu bộ nhớ: {m.message}{" "}
                <button
                  type="button"
                  className="link-btn"
                  onClick={memory.reload}
                >
                  Thử lại
                </button>
              </div>
            )}
            {m.status === "ready" && (
              <dl className="vw-kv">
                <dt>Phiên đang hoạt động</dt>
                <dd>
                  {m.data.short_term.active_sessions} /{" "}
                  {m.data.short_term.max_sessions}
                </dd>
                <dt>Lượt trong bộ nhớ ngắn hạn</dt>
                <dd>
                  {m.data.short_term.turns} (tối đa {m.data.short_term.max_turns})
                </dd>
                <dt>Token trong bộ nhớ ngắn hạn</dt>
                <dd>
                  {m.data.short_term.tokens} (tối đa {m.data.short_term.max_tokens})
                </dd>
                <dt>TTL phiên</dt>
                <dd>{m.data.short_term.ttl_s} giây</dd>
                <dt>Kho lưu: phiên</dt>
                <dd>{m.data.store.sessions}</dd>
                <dt>Kho lưu: bản ghi</dt>
                <dd>{m.data.store.records}</dd>
                <dt>Kho lưu: đã ẩn</dt>
                <dd>{m.data.store.hidden}</dd>
                <dt>Recall: lượt gọi</dt>
                <dd>{m.data.recall.calls}</dd>
                <dt>Recall: có kết quả</dt>
                <dd>{m.data.recall.hits}</dd>
                <dt>Recall: rỗng</dt>
                <dd>{m.data.recall.empty}</dd>
              </dl>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
