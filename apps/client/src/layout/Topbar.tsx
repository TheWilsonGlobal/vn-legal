import type { InfoState, ViewId } from "../types/views";
import { VIEWS } from "./viewRegistry";
import { signInWithGoogle, signOut } from "../api/auth";

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
}

export function Topbar({
  activeView,
  info,
  onRetryInfo,
  user,
  onAuthRefresh,
}: TopbarProps) {
  const title = VIEWS.find((v) => v.id === activeView)?.label ?? activeView;

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
      <h2 className="workbench-topbar-title">{title}</h2>
      <div className="workbench-topbar-right">
        {user ? (
          <div className="topbar-user" style={{ display: "flex", alignItems: "center", gap: "8px", marginRight: "12px" }}>
            {user.picture ? (
              <img
                src={user.picture}
                alt={user.name}
                style={{ width: "24px", height: "24px", borderRadius: "50%" }}
              />
            ) : (
              <span className="dot dot-online" aria-hidden="true" />
            )}
            <span style={{ fontSize: "13px", fontWeight: 500 }}>{user.name}</span>
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
            style={{ cursor: "pointer", background: "#2563eb", color: "#fff", fontWeight: 600, border: "none" }}
          >
            Đăng nhập Google
          </button>
        )}

        {info.status === "loading" && (
          <span className="topbar-pill muted">
            <span className="dot dot-connecting" aria-hidden="true" />
            Đang tải thông tin mô hình…
          </span>
        )}
        {info.status === "error" && (
          <span className="topbar-pill topbar-error" role="alert">
            <span className="dot dot-error" aria-hidden="true" />
            Không tải được thông tin mô hình ({info.message})
            <button type="button" className="link-btn" onClick={onRetryInfo}>
              Thử lại
            </button>
          </span>
        )}
        {info.status === "ready" && (
          <>
            <span className="topbar-pill" title="Mô hình chat">
              <span className="muted">Chat</span>
              <span className="mono">{info.info.model}</span>
            </span>
            <span className="topbar-pill" title="Mô hình embedding · số chiều">
              <span className="muted">Embedding</span>
              <span className="mono">
                {info.info.embedding.model} · {info.info.embedding.dim}
              </span>
            </span>
            <span
              className="topbar-pill"
              title={`LLM: ${info.info.llm_status}`}
              role="status"
            >
              <span
                className={`dot ${
                  info.info.llm_status === "connected"
                    ? "dot-online"
                    : "dot-offline"
                }`}
                aria-hidden="true"
              />
              {info.info.llm_status === "connected"
                ? "LLM đã kết nối"
                : "LLM mất kết nối"}
            </span>
          </>
        )}
      </div>
    </header>
  );
}
