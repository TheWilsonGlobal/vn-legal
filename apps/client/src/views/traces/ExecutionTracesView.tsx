import { createContext, useContext, useEffect, useState } from "react";
import { getSession, getTraces, verifyTraces } from "../../api/agent";
import type {
  SessionDetail,
  SessionRecord,
  VerifyTracesResponse,
} from "../../types/agent";
import type { ViewProps } from "../../types/views";
import "../../styles/views.css";
import {
  errorMessage,
  formatTime,
  useApiResource,
} from "../sessions/useApiResource";

const PAGE_SIZES = [25, 50, 100] as const;

type SessionCache = Map<string, Promise<SessionDetail>>;

/** One C5 fetch per session, shared by every expanded row of that session. */
const SessionCacheContext = createContext<SessionCache | null>(null);

function fetchSessionOnce(
  cache: SessionCache,
  sessionId: string,
): Promise<SessionDetail> {
  const hit = cache.get(sessionId);
  if (hit) return hit;
  const p = getSession(sessionId);
  // A failed fetch is not cached: the next expansion retries it.
  p.catch(() => {
    if (cache.get(sessionId) === p) cache.delete(sessionId);
  });
  cache.set(sessionId, p);
  return p;
}

/** Langfuse link for one record: trace_url lives on the C5 turn of its run. */
function LangfuseLink({ record }: { record: SessionRecord }) {
  const cache = useContext(SessionCacheContext);
  if (cache === null) throw new Error("SessionCacheContext is missing");
  const { resource } = useApiResource(
    record.trace_id != null && record.run_id != null,
    `session:${record.session_id}`,
    () => fetchSessionOnce(cache, record.session_id),
  );
  if (record.trace_id == null || record.run_id == null) return null;
  if (resource.status === "loading") {
    return <span className="muted">Đang tìm liên kết Langfuse...</span>;
  }
  if (resource.status === "error") {
    return (
      <span className="vw-alert" role="alert">
        Không tải được liên kết Langfuse: {resource.message}
      </span>
    );
  }
  const turn = resource.data.turns.find((t) => t.run_id === record.run_id);
  if (!turn || !turn.trace_url) return null;
  return (
    <a
      className="vw-link"
      href={turn.trace_url}
      target="_blank"
      rel="noopener noreferrer"
    >
      Mở trong Langfuse ↗
    </a>
  );
}

function RecordRow({ record }: { record: SessionRecord }) {
  const [open, setOpen] = useState(false);
  const detailId = `vw-rec-${record.session_id}-${record.seq}`;
  const failed = record.ok === false || record.kind === "error";
  return (
    <li className="vw-record">
      <button
        type="button"
        className="vw-row-toggle"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="mono">#{record.seq}</span>
        <span className="muted">{formatTime(record.created_at)}</span>
        <span className={`vw-badge ${failed ? "red" : ""}`}>{record.kind}</span>
        <span>
          {record.step_kind ?? ""}
          {record.tool ? ` · ${record.tool}` : ""}
        </span>
        <span>
          {record.ok === undefined ? (
            ""
          ) : (
            <span className={`vw-badge ${record.ok ? "green" : "red"}`}>
              {record.ok ? "ok" : "failed"}
            </span>
          )}
        </span>
        <span className="vw-preview">{record.content}</span>
      </button>
      <div className="vw-detail" id={detailId} hidden={!open}>
        {open && (
          <>
            <pre className="vw-pre">{record.content}</pre>
            <dl>
              <dt>Phiên</dt>
              <dd className="mono">{record.session_id}</dd>
              <dt>Run</dt>
              <dd className="mono">{record.run_id ?? "—"}</dd>
              <dt>Tool</dt>
              <dd>{record.tool ?? "—"}</dd>
              <dt>ok</dt>
              <dd>{record.ok === undefined ? "—" : String(record.ok)}</dd>
              <dt>Trace id</dt>
              <dd className="mono">{record.trace_id ?? "—"}</dd>
            </dl>
            <LangfuseLink record={record} />
          </>
        )}
      </div>
    </li>
  );
}

export default function ExecutionTracesView(props: ViewProps) {
  const { active, traceSessionFilter, setTraceSessionFilter } = props;
  const [kind, setKind] = useState<string | null>(null);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState<number>(25);
  const [page, setPage] = useState<{ key: string; offset: number }>({
    key: "",
    offset: 0,
  });
  const [sessionCache] = useState<SessionCache>(() => new Map());
  const [verify, setVerify] = useState<
    | { status: "idle" }
    | { status: "running" }
    | { status: "done"; result: VerifyTracesResponse }
    | { status: "error"; message: string }
  >({ status: "idle" });

  // Debounce the search box into the applied query.
  useEffect(() => {
    const id = window.setTimeout(() => setQ(qInput.trim()), 300);
    return () => window.clearTimeout(id);
  }, [qInput]);

  // Any change of filter or page size restarts at the first page.
  const filterKey = JSON.stringify([traceSessionFilter, kind, q, limit]);
  const offset = page.key === filterKey ? page.offset : 0;

  const { resource, reload: reloadList } = useApiResource(
    active,
    JSON.stringify([filterKey, offset]),
    (signal) =>
      getTraces(
        {
          session_id: traceSessionFilter ?? undefined,
          kind: (kind ?? undefined) as SessionRecord["kind"] | undefined,
          q: q || undefined,
          offset,
          limit,
        },
        signal,
      ),
  );

  const reload = () => {
    sessionCache.clear();
    reloadList();
  };

  const runVerify = async () => {
    setVerify({ status: "running" });
    try {
      setVerify({ status: "done", result: await verifyTraces() });
    } catch (err) {
      setVerify({ status: "error", message: errorMessage(err) });
    }
  };

  const data = resource.status === "ready" ? resource.data : null;
  // A stale offset (list shrank, e.g. after a refresh) restarts at page one.
  if (data && data.total > 0 && offset >= data.total) {
    setPage({ key: filterKey, offset: 0 });
  }
  const kindCounts = data ? Object.entries(data.kind_counts) : [];
  const kindTotal = kindCounts.reduce((n, [, c]) => n + c, 0);
  const from = data && data.total > 0 ? offset + 1 : 0;
  const to = data ? Math.min(offset + data.records.length, data.total) : 0;

  return (
    <SessionCacheContext value={sessionCache}>
      <div className="vw-page">
        <div className="vw-head">
          <h2>Vết thực thi</h2>
          <div className="vw-toolbar">
            <input
              type="search"
              className="vw-input"
              placeholder="Tìm trong nội dung..."
              aria-label="Tìm trong vết thực thi"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
            <button type="button" className="vw-btn" onClick={reload}>
              Làm mới
            </button>
            <button
              type="button"
              className="vw-btn"
              onClick={runVerify}
              disabled={verify.status === "running"}
            >
              {verify.status === "running"
                ? "Đang kiểm tra..."
                : "Kiểm tra toàn vẹn"}
            </button>
          </div>
        </div>

        {traceSessionFilter && (
          <div className="vw-toolbar">
            <span className="vw-badge">
              Phiên: <span className="mono">{traceSessionFilter}</span>
            </span>
            <button
              type="button"
              className="vw-btn small"
              onClick={() => setTraceSessionFilter(null)}
            >
              Bỏ lọc phiên ×
            </button>
          </div>
        )}

        {verify.status === "done" &&
          (verify.result.ok ? (
            <div className="vw-ok" role="status">
              Chuỗi băm toàn vẹn: {verify.result.records} bản ghi hợp lệ.
            </div>
          ) : (
            <div className="vw-alert" role="alert">
              Chuỗi băm bị hỏng
              {verify.result.first_bad
                ? ` tại phiên ${verify.result.first_bad.session_id}, dòng ${verify.result.first_bad.line}`
                : ""}
              . Đã kiểm tra {verify.result.records} bản ghi.
            </div>
          ))}
        {verify.status === "error" && (
          <div className="vw-alert" role="alert">
            Không kiểm tra được toàn vẹn: {verify.message}
          </div>
        )}

        {resource.status === "error" && (
          <div className="vw-alert" role="alert">
            Không tải được vết thực thi: {resource.message}{" "}
            <button type="button" className="link-btn" onClick={reload}>
              Thử lại
            </button>
          </div>
        )}

        {data && (
          <div className="vw-pills" role="group" aria-label="Lọc theo loại">
            <button
              type="button"
              className="vw-pill"
              aria-pressed={kind === null}
              onClick={() => setKind(null)}
            >
              Tất cả{kind === null ? ` (${kindTotal})` : ""}
            </button>
            {kindCounts.map(([k, count]) => (
              <button
                key={k}
                type="button"
                className="vw-pill"
                aria-pressed={kind === k}
                onClick={() => setKind(kind === k ? null : k)}
              >
                {k} ({count})
              </button>
            ))}
          </div>
        )}

        {resource.status === "loading" && (
          <div className="vw-state" role="status">
            Đang tải vết thực thi...
          </div>
        )}

        {data &&
          (data.total === 0 ? (
            <div className="vw-state">
              {kind || q || traceSessionFilter
                ? "Không có bản ghi nào khớp bộ lọc."
                : "Chưa có bản ghi vết nào."}
            </div>
          ) : (
            <ul className="vw-list" aria-label="Bản ghi vết">
              {data.records.map((r) => (
                <RecordRow key={`${r.session_id}-${r.seq}`} record={r} />
              ))}
            </ul>
          ))}

        {data && (
          <div className="vw-pager">
            <span aria-live="polite">
              Hiển thị {from}–{to} / {data.total}
            </span>
            <span className="vw-toolbar">
              <label>
                Mỗi trang{" "}
                <select
                  className="vw-select"
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="vw-btn small"
                disabled={offset === 0}
                onClick={() =>
                  setPage({
                    key: filterKey,
                    offset: Math.max(0, offset - limit),
                  })
                }
              >
                Trước
              </button>
              <button
                type="button"
                className="vw-btn small"
                disabled={offset + limit >= data.total}
                onClick={() =>
                  setPage({ key: filterKey, offset: offset + limit })
                }
              >
                Sau
              </button>
            </span>
          </div>
        )}
      </div>
    </SessionCacheContext>
  );
}
