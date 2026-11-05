import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  createSession,
  deleteSession,
  listSessions,
} from "../../api/agent";
import type { SessionListItem } from "../../types/agent";
import type { ViewProps } from "../../types/views";
import "../../styles/views.css";
import { errorMessage, formatTime, useApiResource } from "./useApiResource";

const shortId = (id: string) => id.slice(0, 8);

function ConfirmDelete({
  session,
  busy,
  onCancel,
  onConfirm,
}: {
  session: SessionListItem;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    cancelRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);
  // While busy both buttons are disabled: keep focus inside the dialog.
  useEffect(() => {
    if (busy) dialogRef.current?.focus();
  }, [busy]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (!busy) onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>("button:not([disabled])"),
    );
    if (focusable.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const current = document.activeElement;
    if (e.shiftKey && (current === first || current === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && current === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div
        ref={dialogRef}
        className="vw-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vw-del-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h3 id="vw-del-title">
          Xoá phiên <span className="mono">{shortId(session.session_id)}</span>?
        </h3>
        <p>
          Đây là xoá mềm: phiên chỉ bị ẩn khỏi danh sách và khỏi trợ lý, dữ liệu
          vẫn được giữ trên đĩa và không bị xoá vĩnh viễn.
        </p>
        <div className="vw-dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="vw-btn"
            onClick={onCancel}
            disabled={busy}
          >
            Huỷ
          </button>
          <button
            type="button"
            className="vw-btn danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Đang xoá..." : "Xoá (ẩn)"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SessionManagerView(props: ViewProps) {
  const { active, sessionId, setSessionId, openSession, openTraces } = props;
  const { resource, reload } = useApiResource(active, "sessions", (signal) =>
    listSessions(signal),
  );
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SessionListItem | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const sessions = resource.status === "ready" ? resource.data.sessions : null;

  const filtered = useMemo(() => {
    if (!sessions) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter(
      (s) =>
        s.session_id.toLowerCase().includes(needle) ||
        s.title.toLowerCase().includes(needle),
    );
  }, [sessions, search]);

  const totals = useMemo(() => {
    if (!sessions) return null;
    return {
      active: sessions.filter((s) => s.active).length,
      turns: sessions.reduce((n, s) => n + s.turns, 0),
      records: sessions.reduce((n, s) => n + s.record_count, 0),
    };
  }, [sessions]);

  const handleCreate = async () => {
    setCreating(true);
    setActionError(null);
    try {
      const created = await createSession();
      setSessionId(created.session_id);
      reload();
    } catch (err) {
      setActionError(`Không tạo được phiên mới: ${errorMessage(err)}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setDeleting(true);
    setActionError(null);
    setNotice(null);
    try {
      const res = await deleteSession(target.session_id);
      if (sessionId === target.session_id) setSessionId(null);
      setPendingDelete(null);
      if (res.mode !== "soft") {
        setActionError(
          `Máy chủ trả về mode "${String(res.mode)}" thay vì "soft" khi xoá phiên ${shortId(target.session_id)}.`,
        );
      } else {
        setNotice(
          `Đã ẩn phiên ${shortId(target.session_id)} (mode: ${res.mode}, dữ liệu vẫn còn trên đĩa).`,
        );
      }
      reload();
    } catch (err) {
      setPendingDelete(null);
      setActionError(
        `Không xoá được phiên ${shortId(target.session_id)}: ${errorMessage(err)}`,
      );
      // 404: the session is already gone, so the list on screen is stale.
      if (err instanceof ApiError && err.status === 404) reload();
    } finally {
      setDeleting(false);
    }
  };

  const handleCopy = async (id: string) => {
    setActionError(null);
    try {
      await navigator.clipboard.writeText(id);
      setCopied(id);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => {
        copyTimer.current = null;
        setCopied((c) => (c === id ? null : c));
      }, 1500);
    } catch (err) {
      setActionError(`Không sao chép được mã phiên: ${errorMessage(err)}`);
    }
  };

  return (
    <div className="vw-page">
      <div className="vw-head">
        <h2>Quản lý phiên</h2>
        <div className="vw-toolbar">
          <input
            type="search"
            className="vw-input"
            placeholder="Tìm theo mã hoặc tiêu đề..."
            aria-label="Tìm phiên theo mã hoặc tiêu đề"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="button" className="vw-btn" onClick={reload}>
            Làm mới
          </button>
          <button
            type="button"
            className="vw-btn primary"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? "Đang tạo..." : "+ Phiên mới"}
          </button>
        </div>
      </div>

      {actionError && (
        <div className="vw-alert" role="alert">
          {actionError}
        </div>
      )}

      {notice && (
        <div className="vw-state" role="status">
          {notice}
        </div>
      )}

      {resource.status === "error" && (
        <div className="vw-alert" role="alert">
          Không tải được danh sách phiên: {resource.message}{" "}
          <button type="button" className="link-btn" onClick={reload}>
            Thử lại
          </button>
        </div>
      )}

      {resource.status === "loading" && (
        <div className="vw-state" role="status">
          Đang tải danh sách phiên...
        </div>
      )}

      {sessions && totals && (
        <>
          <div className="vw-cards">
            <div className="vw-card">
              <div className="vw-card-label">Phiên đang hoạt động</div>
              <div className="vw-card-value">{totals.active}</div>
            </div>
            <div className="vw-card">
              <div className="vw-card-label">Tổng số lượt</div>
              <div className="vw-card-value">{totals.turns}</div>
            </div>
            <div className="vw-card">
              <div className="vw-card-label">Tổng số bản ghi</div>
              <div className="vw-card-value">{totals.records}</div>
            </div>
          </div>

          {sessions.length === 0 ? (
            <div className="vw-state">
              Chưa có phiên nào. Nhấn &quot;+ Phiên mới&quot; hoặc đặt câu hỏi
              trong Trợ lý.
            </div>
          ) : filtered.length === 0 ? (
            <div className="vw-state">
              Không có phiên nào khớp &quot;{search}&quot;.
            </div>
          ) : (
            <ul className="vw-list" aria-label="Danh sách phiên">
              {filtered.map((s) => (
                <li
                  key={s.session_id}
                  className={`vw-session-row${s.session_id === sessionId ? " selected" : ""}`}
                >
                  <div>
                    <div className="vw-idline">
                      <span className="mono" title={s.session_id}>
                        {shortId(s.session_id)}
                      </span>
                      <button
                        type="button"
                        className="vw-btn small"
                        onClick={() => handleCopy(s.session_id)}
                        aria-label={`Sao chép mã phiên ${shortId(s.session_id)}`}
                      >
                        {copied === s.session_id ? "Đã chép" : "Sao chép"}
                      </button>
                    </div>
                    <div className="vw-meta">
                      <span>
                        {s.message_count} tin nhắn · {s.turns} lượt ·{" "}
                        {s.record_count} bản ghi
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="vw-title">{s.title}</div>
                    <div className="vw-meta">
                      <span>Tạo: {formatTime(s.created_at)}</span>
                      <span>
                        Hoạt động cuối: {formatTime(s.last_active_at)}
                      </span>
                    </div>
                  </div>
                  <span className={`vw-badge ${s.active ? "green" : "grey"}`}>
                    {s.active ? "đang hoạt động" : "đã lưu"}
                  </span>
                  <div className="vw-actions">
                    <button
                      type="button"
                      className="vw-btn small"
                      onClick={() => openSession(s.session_id)}
                    >
                      Mở
                    </button>
                    <button
                      type="button"
                      className="vw-btn small"
                      onClick={() => openTraces(s.session_id)}
                    >
                      Xem vết
                    </button>
                    <button
                      type="button"
                      className="vw-btn small danger"
                      onClick={() => setPendingDelete(s)}
                    >
                      Xoá
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {pendingDelete && (
        <ConfirmDelete
          session={pendingDelete}
          busy={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
