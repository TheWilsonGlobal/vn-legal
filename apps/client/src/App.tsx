import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { getInfo, isAbortError } from "./api/agent";
import { Sidebar } from "./layout/Sidebar";
import { Topbar } from "./layout/Topbar";
import { VIEWS, resolveView } from "./layout/viewRegistry";
import type { ConsultContext } from "./types/agent";
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
  const [info, setInfo] = useState<InfoState>({ status: "loading" });
  const infoAbort = useRef<AbortController | null>(null);

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
        <Topbar activeView={activeView} info={info} onRetryInfo={refreshInfo} />
        <main className="workbench">
          {VIEWS.map(({ id, label }) => {
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
          })}
        </main>
      </div>
    </div>
  );
}

export default App;
