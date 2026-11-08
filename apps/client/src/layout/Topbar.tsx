import type { InfoState, ViewId } from "../types/views";
import { VIEWS } from "./viewRegistry";
import { signInWithGoogle, signOut } from "../api/auth";
import type { SessionListItem } from "../types/agent";
import SegmentedToggle from "../components/SegmentedToggle";

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  role: string;
}

interface TopbarProps {
  activeView: ViewId;
  info: InfoState;
  onRetryInfo: () => void;
  user: UserProfile | null;
  requireLogin?: boolean;
  onAuthRefresh?: () => void;
  // Session controls
  sessionId: string | null;
  sessions: SessionListItem[];
  onSelectSession: (id: string | null) => void;
  onNewSession: () => void;
  // Global hierarchy controls
  hierarchyControls?: {
    expandAll: () => void;
    collapseAll: () => void;
    turnCount: number;
  } | null;
}

export function Topbar({
  activeView,
  info: _info,
  onRetryInfo: _onRetryInfo,
  user,
  onAuthRefresh,
  sessionId,
  sessions,
  onSelectSession,
  onNewSession,
  hierarchyControls,
}: TopbarProps) {
  const title = VIEWS.find((v) => v.id === activeView)?.label ?? activeView;
  const known =
    sessionId !== null && sessions.some((s) => s.session_id === sessionId);

  const handleLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (e) {
      console.error("Google sign in failed", e);
      alert("Không thể khởi động đăng nhập Google.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
      if (onAuthRefresh) onAuthRefresh();
    } catch (e) {
      console.error("Sign out failed", e);
    }
  };

  return (
    <header className="workbench-topbar">
      <div className="workbench-topbar-left">
        <h2 className="workbench-topbar-title">{title}</h2>

        {/* Session selector + New button + Session ID display in header */}
        <div className="topbar-session-bar" role="toolbar" aria-label="Quản lý phiên">
          <label htmlFor="topbar-session-select" className="topbar-session-label">
            Phiên
          </label>
          <select
            id="topbar-session-select"
            className="topbar-session-select"
            value={sessionId ?? ""}
            onChange={(e) => onSelectSession(e.target.value || null)}
            aria-label="Chọn phiên"
          >
            <option value="">— Chưa chọn phiên —</option>
            {sessionId !== null && !known && (
              <option value={sessionId}>{sessionId.slice(0, 8)}</option>
            )}
            {sessions.map((s) => (
              <option key={s.session_id} value={s.session_id}>
                {s.session_id.slice(0, 8)} ({s.message_count} tin nhắn,{" "}
                {s.active ? "đang hoạt động" : "đã lưu"})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="topbar-btn-new"
            aria-label="Tạo phiên mới"
            onClick={onNewSession}
          >
            <span aria-hidden="true">+ </span>New
          </button>

          <span
            className={`topbar-session-chip mono${sessionId ? " is-active" : " is-empty"}`}
            title={
              sessionId
                ? `Mã phiên đầy đủ: ${sessionId}`
                : "Chưa chọn phiên (hệ thống sẽ tự động gán khi đặt câu hỏi)"
            }
          >
            Phiên ID: {sessionId ? sessionId.slice(0, 8) : "—"}
          </span>
        </div>

        {/* Mở rộng / Thu gọn tất cả in header when in assistant or settings view */}
        {(activeView === "assistant" || activeView === "settings") &&
          hierarchyControls &&
          hierarchyControls.turnCount > 0 && (
            <div className="topbar-hierarchy-controls">
              <SegmentedToggle
                ariaLabel="Mở rộng hoặc thu gọn tất cả các phần"
                options={[
                  {
                    label: "Mở rộng tất cả",
                    icon: "expand",
                    onSelect: hierarchyControls.expandAll,
                  },
                  {
                    label: "Thu gọn tất cả",
                    icon: "collapse",
                    onSelect: hierarchyControls.collapseAll,
                  },
                ]}
              />
            </div>
          )}
      </div>

      <div className="workbench-topbar-right">
        {user ? (
          <div
            className="topbar-user"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginRight: "4px",
            }}
          >
            {user.picture ? (
              <img
                src={user.picture}
                alt={user.name}
                style={{ width: "24px", height: "24px", borderRadius: "50%" }}
              />
            ) : (
              <span className="dot dot-online" aria-hidden="true" />
            )}
            <span style={{ fontSize: "13px", fontWeight: 500 }}>
              {user.name}
            </span>
            <button
              type="button"
              className="link-btn"
              onClick={handleLogout}
              style={{ fontSize: "12px", marginLeft: "4px" }}
            >
              Đăng xuất
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="topbar-pill"
            onClick={handleLogin}
            style={{
              cursor: "pointer",
              background: "#2563eb",
              color: "#fff",
              fontWeight: 600,
              border: "none",
            }}
          >
            Đăng nhập Google
          </button>
        )}
      </div>
    </header>
  );
}
