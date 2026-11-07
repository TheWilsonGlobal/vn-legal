import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { createSession, getInfo, isAbortError, listSessions } from "./api/agent";
import { initAuth, onAuthChange, signInWithGoogle } from "./api/auth";
import { Sidebar } from "./layout/Sidebar";
import { Topbar, type UserProfile } from "./layout/Topbar";
import { VIEWS, resolveView } from "./layout/viewRegistry";
import type { ConsultContext, SessionListItem } from "./types/agent";
import type { InfoState, ViewId, ViewProps } from "./types/views";
import "./styles/workbench.css";

interface BoundaryProps {
  label: string;
  children: ReactNode;
}

/** Contains a render crash in one view so the rest of the shell survives. */
class ViewErrorBoundary extends Component<
  BoundaryProps,
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`View "${this.props.label}" crashed`, error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="view-missing" role="alert">
        <h3>Giao diện &quot;{this.props.label}&quot; gặp lỗi</h3>
        <p>{error.message}</p>
        <button type="button" onClick={() => this.setState({ error: null })}>
          Thử lại
        </button>
      </div>
    );
  }
}

/**
 * Workbench shell: sidebar + topbar + one slot per view. Views are discovered
 * by layout/viewRegistry.ts; this file never imports them by name.
 */
function App() {
  const [activeView, setActiveView] = useState<ViewId>("assistant");
  const [collapsed, setCollapsed] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lastContext, setLastContext] = useState<ConsultContext | null>(null);
  const [traceSessionFilter, setTraceSessionFilter] = useState<string | null>(
    null,
  );
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [hierarchyControls, setHierarchyControls] = useState<{
    expandAll: () => void;
    collapseAll: () => void;
    turnCount: number;
  } | null>(null);
  const [info, setInfo] = useState<InfoState>({ status: "loading" });
  const [user, setUser] = useState<UserProfile | null>(null);
  const [requireLogin, setRequireLogin] = useState<boolean>(true);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const infoAbort = useRef<AbortController | null>(null);

  const refreshSessions = useCallback(async () => {
    try {
      const res = await listSessions();
      setSessions(res.sessions);
      setSessionId((curr) => {
        if (curr === null && res.sessions.length > 0) {
          return res.sessions[0].session_id;
        }
        return curr;
      });
    } catch (err) {
      console.error("Failed to load sessions in App", err);
    }
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const handleNewSession = useCallback(async () => {
    try {
      const res = await createSession();
      setSessionId(res.session_id);
      setActiveView("assistant");
      await refreshSessions();
    } catch (err) {
      console.error("Failed to create session", err);
    }
  }, [refreshSessions]);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        setRequireLogin(Boolean(data.requireLogin));
        if (data.authenticated && data.user) {
          setUser(data.user);
        } else {
          setUser(null);
        }
      }
    } catch (e) {
      console.error("Failed to check auth state", e);
    } finally {
      setAuthChecking(false);
    }
  }, []);

  useEffect(() => {
    initAuth()
      .then((status) => {
        setRequireLogin(status.requireLogin);
        fetchCurrentUser();
      })
      .catch((err) => {
        console.error("Auth init failed", err);
        setAuthChecking(false);
      });

    return onAuthChange(() => {
      fetchCurrentUser();
    });
  }, [fetchCurrentUser]);

  const refreshInfo = useCallback(() => {
    infoAbort.current?.abort();
    const controller = new AbortController();
    infoAbort.current = controller;
    getInfo(controller.signal)
      .then((data) => setInfo({ status: "ready", info: data }))
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setInfo({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }, []);

  useEffect(() => {
    refreshInfo();
    return () => infoAbort.current?.abort();
  }, [refreshInfo]);

  const openTraces = useCallback((id: string | null) => {
    setTraceSessionFilter(id);
    setActiveView("traces");
  }, []);

  const openSession = useCallback((id: string) => {
    setSessionId(id);
    setActiveView("assistant");
  }, []);

  const viewProps = (id: ViewId): ViewProps => ({
    active: id === activeView,
    sessionId,
    setSessionId,
    lastContext,
    setLastContext,
    traceSessionFilter,
    setTraceSessionFilter,
    openTraces,
    openSession,
    navigate: setActiveView,
    info,
    refreshInfo,
    setHierarchyControls,
    refreshSessions,
  });

  return (
    <div className="app-shell">
      <Sidebar
        activeView={activeView}
        onNavigate={setActiveView}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        sessionId={sessionId}
        info={info}
      />
      <div className="app-main-content">
        <Topbar
          activeView={activeView}
          info={info}
          onRetryInfo={refreshInfo}
          user={user}
          requireLogin={requireLogin}
          onAuthRefresh={fetchCurrentUser}
          sessionId={sessionId}
          sessions={sessions}
          onSelectSession={(id) => {
            setSessionId(id);
            if (id) setActiveView("assistant");
          }}
          onNewSession={handleNewSession}
          hierarchyControls={hierarchyControls}
        />
        <main className="workbench">
          {requireLogin && !user && !authChecking ? (
            <div
              className="view-missing"
              role="alert"
              style={{
                maxWidth: "480px",
                margin: "40px auto",
                textAlign: "center",
                padding: "32px",
                borderRadius: "12px",
                background: "var(--card-bg, #ffffff)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
              }}
            >
              <h3 style={{ fontSize: "20px", marginBottom: "12px" }}>
                Yêu cầu đăng nhập
              </h3>
              <p style={{ color: "var(--muted, #64748b)", marginBottom: "24px" }}>
                Hệ thống Tra cứu & Tư vấn Pháp luật yêu cầu đăng nhập tài khoản Google để tiếp tục.
              </p>
              <button
                type="button"
                className="topbar-pill"
                onClick={() => signInWithGoogle().catch(console.error)}
                style={{
                  cursor: "pointer",
                  background: "#2563eb",
                  color: "#ffffff",
                  padding: "10px 24px",
                  fontSize: "14px",
                  fontWeight: 600,
                  borderRadius: "8px",
                  border: "none",
                }}
              >
                Đăng nhập với Google
              </button>
            </div>
          ) : (
            VIEWS.map(({ id, label }) => {
            const entry = resolveView(id);
            const isActive = id === activeView;
            return (
              <section
                key={id}
                id={`view-${id}`}
                className="view-slot"
                aria-label={label}
                hidden={!isActive}
              >
                {entry.status === "ready" ? (
                  <ViewErrorBoundary label={label}>
                    <entry.Component {...viewProps(id)} />
                  </ViewErrorBoundary>
                ) : (
                  <div className="view-missing" role="alert">
                    <h3>Chưa có giao diện</h3>
                    <p>
                      {entry.status === "missing"
                        ? "Không tìm thấy tệp"
                        : "Tệp không xuất khẩu mặc định một component:"}{" "}
                      <code>{entry.file.replace("../", "src/")}</code>
                    </p>
                  </div>
                )}
              </section>
            );
          })
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
