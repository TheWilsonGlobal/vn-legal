import { useCallback, useEffect, useState, type FormEvent } from "react";
import { fetchAdminTracesApi } from "../api/adminApi.ts";
import type { TraceRecord, TracesPage } from "../types/index.ts";

const PAGE_SIZE = 50;

const KINDS: { value: string; label: string }[] = [
  { value: "", label: "Tất cả loại" },
  { value: "session_created", label: "Tạo phiên" },
  { value: "query", label: "Câu hỏi" },
  { value: "step", label: "Bước thực thi" },
  { value: "answer", label: "Câu trả lời" },
  { value: "error", label: "Lỗi" },
  { value: "deleted", label: "Đã xóa" },
  { value: "llm_call", label: "Lời gọi LLM" },
];

function LlmCallView({ llm }: { llm: NonNullable<TraceRecord["llm"]> }) {
  const block = (value: unknown) => (
    <pre style={{ whiteSpace: "pre-wrap", margin: "4px 0 12px", maxHeight: "480px", overflow: "auto" }}>
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
  return (
    <div>
      <p className="text-muted" style={{ margin: "4px 0" }}>
        Mô hình {llm.model} · {llm.latency_ms} ms · token vào/ra:{" "}
        {llm.usage ? `${llm.usage.input}/${llm.usage.output}` : "không có"}
      </p>
      <strong>System prompt</strong>
      {block(llm.system)}
      <strong>Tin nhắn gửi đi ({llm.messages.length})</strong>
      {block(llm.messages)}
      <strong>Phản hồi của mô hình</strong>
      {block(llm.response)}
    </div>
  );
}

interface Filters {
  sessionId: string;
  kind: string;
  q: string;
}

const EMPTY_FILTERS: Filters = { sessionId: "", kind: "", q: "" };

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Read-only trace of session records across every owner, newest first. */
export function TracesView() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<TracesPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAdminTracesApi({
        sessionId: filters.sessionId.trim() || undefined,
        kind: filters.kind || undefined,
        q: filters.q.trim() || undefined,
        offset,
        limit: PAGE_SIZE,
      });
      setPage(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filters, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const onApply = (e: FormEvent) => {
    e.preventDefault();
    setOffset(0);
    setFilters(draft);
  };

  const total = page?.total ?? 0;
  const records: TraceRecord[] = page?.records ?? [];
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <div className="view-section" key="traces">
      <div className="view-header">
        <h2>Vết thực thi toàn cục</h2>
        <button className="btn-primary" onClick={load} disabled={loading}>
          <i className="fas fa-sync-alt"></i> Tải lại
        </button>
      </div>
      <p className="text-muted">
        Bản ghi của mọi phiên, mọi người dùng, mới nhất trước (chỉ đọc).
      </p>

      <form
        className="settings-form"
        onSubmit={onApply}
        style={{ display: "flex", gap: "8px", flexWrap: "wrap", margin: "16px 0" }}
      >
        <input
          type="text"
          placeholder="ID phiên (UUID)"
          value={draft.sessionId}
          onChange={(e) => setDraft({ ...draft, sessionId: e.target.value })}
        />
        <select
          value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
              {page && k.value ? ` (${page.kind_counts[k.value] ?? 0})` : ""}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Tìm trong nội dung"
          value={draft.q}
          onChange={(e) => setDraft({ ...draft, q: e.target.value })}
        />
        <button className="btn-secondary" type="submit">
          Lọc
        </button>
      </form>

      <div className="card full-width">
        <div className="card-header">
          <h2>Bản ghi</h2>
          <span className="badge-dim">{total} bản ghi</span>
        </div>
        <div className="card-body">
          {error && <p className="text-muted">Không tải được vết thực thi: {error}</p>}
          {!error && records.length === 0 && !loading && (
            <p className="text-muted">Không có bản ghi nào khớp bộ lọc.</p>
          )}
          {records.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Thời điểm</th>
                  <th>Phiên</th>
                  <th>Seq</th>
                  <th>Loại</th>
                  <th>Nội dung</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={`${r.session_id}-${r.seq}`}>
                    <td>{formatTime(r.created_at)}</td>
                    <td className="mono" title={r.session_id}>
                      {r.session_id.slice(0, 8)}
                    </td>
                    <td>{r.seq}</td>
                    <td>{r.kind}</td>
                    <td style={{ whiteSpace: "pre-wrap", maxWidth: "520px" }}>
                      {r.llm ? (
                        <details>
                          <summary>{r.content}</summary>
                          <LlmCallView llm={r.llm} />
                        </details>
                      ) : (
                        r.content || <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {total > PAGE_SIZE && (
            <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
              <button
                className="btn-secondary"
                disabled={!hasPrev || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Trang trước
              </button>
              <button
                className="btn-secondary"
                disabled={!hasNext || loading}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Trang sau
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
