import type { InfoState, ViewId } from "../types/views";
import { VIEWS } from "./viewRegistry";

interface TopbarProps {
  activeView: ViewId;
  info: InfoState;
  onRetryInfo: () => void;
}

export function Topbar({ activeView, info, onRetryInfo }: TopbarProps) {
  const title = VIEWS.find((v) => v.id === activeView)?.label ?? activeView;
  return (
    <header className="workbench-topbar">
      <h2 className="workbench-topbar-title">{title}</h2>
      <div className="workbench-topbar-right">
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
