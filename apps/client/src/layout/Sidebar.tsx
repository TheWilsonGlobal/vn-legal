import type { InfoState, ViewId } from "../types/views";
import { VIEWS } from "./viewRegistry";

interface SidebarProps {
  activeView: ViewId;
  onNavigate: (view: ViewId) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sessionId: string | null;
  info: InfoState;
}

function settingsDot(info: InfoState): { cls: string; title: string } {
  if (info.status === "loading")
    return { cls: "dot-connecting", title: "LLM: đang kiểm tra" };
  if (info.status === "error")
    return {
      cls: "dot-error",
      title: `Không đọc được trạng thái: ${info.message}`,
    };
  return info.info.llm_status === "connected"
    ? { cls: "dot-online", title: "LLM: đã kết nối" }
    : { cls: "dot-offline", title: "LLM: mất kết nối" };
}

export function Sidebar({
  activeView,
  onNavigate,
  collapsed,
  onToggleCollapsed,
  sessionId,
  info,
}: SidebarProps) {
  const dot = settingsDot(info);
  return (
    <aside
      className={`app-sidebar${collapsed ? " collapsed" : ""}`}
      aria-label="Thanh bên"
    >
      <div className="app-sidebar-header">
        <h1 className="visually-hidden">VinaLegal</h1>
        {!collapsed && (
          <div className="sidebar-brand">
            <span className="brand-title" aria-hidden="true">
              VinaLegal
            </span>
            <span className="brand-sub">TRỢ LÝ PHÁP LÝ</span>
            {sessionId && (
              <span className="sidebar-session mono" title={sessionId}>
                phiên {sessionId.slice(0, 8)}
              </span>
            )}
          </div>
        )}
        <button
          type="button"
          className="sidebar-toggle-btn"
          onClick={onToggleCollapsed}
          aria-label="Thu gọn thanh bên"
          aria-expanded={!collapsed}
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="Chức năng">
        <ul>
          {VIEWS.map((view) => {
            const isActive = view.id === activeView;
            return (
              <li key={view.id}>
                <button
                  type="button"
                  className={`sidebar-nav-btn${isActive ? " active" : ""}`}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={view.label}
                  aria-describedby={
                    view.id === "settings" ? "settings-status-text" : undefined
                  }
                  onClick={() => onNavigate(view.id)}
                  title={collapsed ? view.label : undefined}
                >
                  <span className="nav-icon" aria-hidden="true">
                    {view.icon}
                  </span>
                  {!collapsed && (
                    <span className="nav-label">{view.label}</span>
                  )}
                  {view.id === "settings" && (
                    <>
                      <span
                        className={`dot ${dot.cls} nav-dot`}
                        aria-hidden="true"
                        title={dot.title}
                      />
                      <span
                        id="settings-status-text"
                        className="visually-hidden"
                      >
                        {dot.title}
                      </span>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="sidebar-footer">
        {!collapsed ? (
          <div className="sidebar-llm-card">
            <div className="sidebar-llm-status">
              <span className={`dot ${dot.cls}`} aria-hidden="true" />
              <span className="sidebar-llm-status-text">
                {info.status === "ready"
                  ? info.info.llm_status === "connected"
                    ? "LLM đã kết nối"
                    : "LLM mất kết nối"
                  : info.status === "loading"
                    ? "Đang kết nối LLM..."
                    : "Lỗi kết nối LLM"}
              </span>
            </div>
            {info.status === "ready" && (
              <div className="sidebar-llm-details">
                <div className="sidebar-llm-row">
                  <span className="sidebar-llm-label">Chat:</span>
                  <span className="sidebar-llm-val mono" title={info.info.model}>
                    {info.info.model}
                  </span>
                </div>
                <div className="sidebar-llm-row">
                  <span className="sidebar-llm-label">Embedding:</span>
                  <span
                    className="sidebar-llm-val mono"
                    title={`${info.info.embedding.model} (${info.info.embedding.dim})`}
                  >
                    {info.info.embedding.model} · {info.info.embedding.dim}
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            className="sidebar-llm-collapsed"
            title={
              info.status === "ready"
                ? `Chat: ${info.info.model}\nEmbedding: ${info.info.embedding.model} · ${info.info.embedding.dim}\nTrạng thái: ${info.info.llm_status}`
                : dot.title
            }
          >
            <span className={`dot ${dot.cls}`} aria-hidden="true" />
          </div>
        )}
      </div>
    </aside>
  );
}
