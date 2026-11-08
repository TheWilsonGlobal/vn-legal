import { useCallback, useEffect, useState } from "react";
import {
  fetchAdminSessionsApi,
  fetchAllSessionRecordsApi,
} from "../api/adminApi.ts";
import type { AdminSession } from "../types/index.ts";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Read-only list of agent sessions of every owner. */
export function SessionsView() {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAdminSessionsApi();
      setSessions(data.sessions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const exportSession = async (s: AdminSession) => {
    setExportingId(s.session_id);
    setExportError(null);
    try {
      const records = await fetchAllSessionRecordsApi(s.session_id);
      const payload = {
        exported_at: new Date().toISOString(),
        session: s,
        record_count: records.length,
        records: [...records].sort((a, b) => a.seq - b.seq),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `phien-${s.session_id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingId(null);
    }
  };

  return (
    <div className="view-section" key="sessions">
      <div className="view-header">
        <h2>Phiên</h2>
        <button className="btn-primary" onClick={load} disabled={loading}>
          <i className="fas fa-sync-alt"></i> Tải lại
        </button>
      </div>
      <p className="text-muted">
        Phiên hội thoại của mọi người dùng (chỉ đọc). Phiên đã xóa không hiển thị.
      </p>
      <div className="card full-width" style={{ marginTop: "20px" }}>
        <div className="card-header">
          <h2>Danh sách phiên</h2>
          <span className="badge-dim">{sessions.length} phiên</span>
        </div>
        <div className="card-body">
          {error && <p className="text-muted">Không tải được phiên: {error}</p>}
          {!error && sessions.length === 0 && !loading && (
            <p className="text-muted">Chưa có phiên nào.</p>
          )}
          {sessions.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tiêu đề</th>
                  <th>Chủ sở hữu</th>
                  <th>Lượt hỏi</th>
                  <th>Bản ghi</th>
                  <th>Token (ước tính)</th>
                  <th>Trạng thái</th>
                  <th>Tạo lúc</th>
                  <th>Hoạt động cuối</th>
                  <th>Xuất</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.session_id}>
                    <td>{s.title || "(chưa có tiêu đề)"}</td>
                    <td className="mono" title={s.owner}>
                      {s.owner.slice(0, 8)}
                    </td>
                    <td>{s.turns}</td>
                    <td>{s.record_count}</td>
                    <td>{s.tokens}</td>
                    <td>{s.active ? "Đang hoạt động" : "Nghỉ"}</td>
                    <td>{formatTime(s.created_at)}</td>
                    <td>{formatTime(s.last_active_at)}</td>
                    <td>
                      <button
                        className="btn-secondary"
                        disabled={exportingId !== null}
                        onClick={() => void exportSession(s)}
                        title="Tải toàn bộ bản ghi của phiên dưới dạng .json"
                      >
                        <i className="fas fa-download"></i>{" "}
                        {exportingId === s.session_id ? "Đang xuất..." : "JSON"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {exportError && (
            <p className="text-muted">Không xuất được phiên: {exportError}</p>
          )}
        </div>
      </div>
    </div>
  );
}
