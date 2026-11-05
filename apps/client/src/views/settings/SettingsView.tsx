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

export default function SettingsView(props: ViewProps) {
  const { active, info, refreshInfo } = props;
  const memory = useApiResource(active, "memory", (signal) =>
    getMemoryStats(signal),
  );

  const reloadAll = () => {
    refreshInfo();
    memory.reload();
  };

  const m = memory.resource;

  return (
    <div className="vw-page">
      <div className="vw-head">
        <h2>Cài đặt</h2>
        <button type="button" className="vw-btn" onClick={reloadAll}>
          Làm mới
        </button>
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
          <section className="vw-section" aria-labelledby="vw-set-llm">
            <h3 id="vw-set-llm">Mô hình ngôn ngữ (LLM)</h3>
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
                  className={`vw-badge ${info.info.llm_status === "connected" ? "green" : "red"}`}
                >
                  {info.info.llm_status === "connected"
                    ? "connected"
                    : "disconnected"}
                </span>
              </dd>
            </dl>
          </section>

          <section className="vw-section" aria-labelledby="vw-set-emb">
            <h3 id="vw-set-emb">Embedding</h3>
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
          </section>

          <section className="vw-section" aria-labelledby="vw-set-lf">
            <h3 id="vw-set-lf">Langfuse (quan sát)</h3>
            <dl className="vw-kv">
              <dt>Trạng thái</dt>
              <dd>
                <span
                  className={`vw-badge ${LANGFUSE_LABEL[info.info.observability.langfuse].tone}`}
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
          </section>
        </>
      )}

      <section className="vw-section" aria-labelledby="vw-set-mem">
        <h3 id="vw-set-mem">Bộ nhớ (C10)</h3>
        {m.status === "loading" && (
          <div className="muted" role="status">
            Đang tải số liệu bộ nhớ...
          </div>
        )}
        {m.status === "error" && (
          <div className="vw-alert" role="alert">
            Không tải được số liệu bộ nhớ: {m.message}{" "}
            <button type="button" className="link-btn" onClick={memory.reload}>
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
      </section>
    </div>
  );
}
