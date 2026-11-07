import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  createSession,
  getExamples,
  getSession,
  isAbortError,
  listSessions,
  streamAgent,
} from "../../api/agent";
import type {
  AgentEvent,
  Citation,
  SessionListItem,
  SessionTurn,
} from "../../types/agent";
import type { ViewProps } from "../../types/views";
import "../../styles/assistant.css";
import ArticleModal from "./ArticleModal";
import Composer, { MAX_QUERY } from "./Composer";
import SuggestionChips, { type ExamplesState } from "./SuggestionChips";
import TurnView, { type TurnState } from "./TurnView";

const shortId = (id: string) => id.slice(0, 8);

function sessionLabel(s: SessionListItem): string {
  return `${shortId(s.session_id)} (${s.message_count} tin nhắn, ${
    s.active ? "đang hoạt động" : "đã lưu"
  })`;
}

function errMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.detail ? `${err.code}: ${err.detail}` : err.code;
  }
  return err instanceof Error ? err.message : String(err);
}

function replayTurn(t: SessionTurn): TurnState {
  return {
    key: t.run_id,
    query: t.query,
    answer: t.answer,
    steps: t.steps,
    status: t.ok ? "done" : "error",
    error: t.ok ? null : { code: null, detail: null },
    trace_url: t.trace_url,
  };
}

type SessionsState =
  | { status: "loading" }
  | { status: "ready"; items: SessionListItem[] }
  | { status: "error"; message: string };

export default function AssistantView(props: ViewProps) {
  const {
    active,
    sessionId,
    setSessionId,
    setLastContext,
    refreshInfo,
    setHierarchyControls,
    refreshSessions,
  } = props;

  const [turns, setTurns] = useState<TurnState[]>([]);
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [sessions, setSessions] = useState<SessionsState>({
    status: "loading",
  });
  const [examples, setExamples] = useState<ExamplesState>({ status: "idle" });
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  const turnSeq = useRef(0);
  // Session id whose turns are currently held in state (null = none).
  const loadedIdRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Latest callbacks for use inside long-lived async code.
  const cb = useRef({ setSessionId, setLastContext, refreshInfo });
  useEffect(() => {
    cb.current = { setSessionId, setLastContext, refreshInfo };
  });

  const loadSessions = useCallback(async () => {
    try {
      const res = await listSessions();
      setSessions({ status: "ready", items: res.sessions });
    } catch (err) {
      setSessions({ status: "error", message: errMessage(err) });
    }
  }, []);

  const loadExamples = useCallback(async () => {
    setExamples({ status: "loading" });
    try {
      setExamples({ status: "ready", items: await getExamples() });
    } catch (err) {
      setExamples({ status: "error", message: errMessage(err) });
    }
  }, []);

  // Fetch only once the tab is shown.
  const examplesRequested = useRef(false);
  useEffect(() => {
    if (!active) return;
    void loadSessions();
    if (!examplesRequested.current) {
      examplesRequested.current = true;
      void loadExamples();
    }
  }, [active, loadSessions, loadExamples]);

  // Reload the turns of the selected session (C5). Skipped while a run is in
  // flight: the id may have just been adopted from the `session` event.
  useEffect(() => {
    if (!active || streamingRef.current) return;
    setHistoryError(null);
    if (sessionId === null) {
      loadedIdRef.current = null;
      setTurns([]);
      return;
    }
    // Already showing this session (incl. local cancelled/error turns).
    if (loadedIdRef.current === sessionId) return;
    const ctrl = new AbortController();
    loadedIdRef.current = null;
    setTurns([]);
    setHistoryLoading(true);
    getSession(sessionId, ctrl.signal).then(
      (detail) => {
        loadedIdRef.current = sessionId;
        setTurns(detail.turns.map(replayTurn));
        setHistoryLoading(false);
      },
      (err: unknown) => {
        if (isAbortError(err)) return;
        setHistoryLoading(false);
        if (err instanceof ApiError && err.status === 404) {
          loadedIdRef.current = null;
          setTurns([]);
          setPageError(
            "Phiên không còn tồn tại (session_not_found). Hãy chọn phiên khác hoặc tạo phiên mới.",
          );
          cb.current.setSessionId(null);
        } else {
          setHistoryError(errMessage(err));
        }
      },
    );
    return () => ctrl.abort();
  }, [active, sessionId, historyAttempt]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [turns]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const patchTurn = useCallback(
    (key: string, patch: (t: TurnState) => TurnState) => {
      setTurns((all) => all.map((t) => (t.key === key ? patch(t) : t)));
    },
    [],
  );

  const handleEvent = useCallback(
    (key: string, ev: AgentEvent) => {
      switch (ev.event) {
        case "session":
          loadedIdRef.current = ev.data.session_id;
          cb.current.setSessionId(ev.data.session_id);
          break;
        case "step":
          patchTurn(key, (t) => ({ ...t, steps: [...t.steps, ev.data] }));
          break;
        case "token":
          patchTurn(key, (t) => ({ ...t, answer: t.answer + ev.data.text }));
          break;
        case "reset":
          patchTurn(key, (t) => ({ ...t, answer: "" }));
          break;
        case "done":
          cb.current.setLastContext(ev.data.context);
          refreshSessions?.();
          patchTurn(key, (t) => ({
            ...t,
            answer: ev.data.answer,
            steps: ev.data.steps,
            status: "done",
            trace_url: ev.data.trace_url,
          }));
          break;
        case "error":
          patchTurn(key, (t) => ({
            ...t,
            answer: "",
            status: "error",
            error: { code: ev.data.code, detail: ev.data.detail },
          }));
          break;
      }
    },
    [patchTurn],
  );

  const send = useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim();
      if (streamingRef.current || query === "" || query.length > MAX_QUERY) {
        return;
      }
      const key = `local-${++turnSeq.current}`;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      streamingRef.current = true;
      setStreaming(true);
      setPageError(null);
      setText("");
      setTurns((all) => [
        ...all,
        {
          key,
          query,
          answer: "",
          steps: [],
          status: "streaming",
          error: null,
          trace_url: null,
        },
      ]);
      try {
        await streamAgent(
          { query, session_id: sessionId },
          { signal: ctrl.signal, onEvent: (ev) => handleEvent(key, ev) },
        );
      } catch (err) {
        if (isAbortError(err)) {
          patchTurn(key, (t) => ({ ...t, status: "cancelled" }));
        } else if (err instanceof ApiError && err.status === 404) {
          // Stale session: never silently start a new one.
          setTurns((all) => all.filter((t) => t.key !== key));
          setPageError(
            "Phiên không còn tồn tại (session_not_found). Hãy chọn phiên khác hoặc tạo phiên mới.",
          );
          cb.current.setSessionId(null);
        } else {
          patchTurn(key, (t) => ({
            ...t,
            answer: "",
            status: "error",
            error: {
              code: err instanceof ApiError ? err.code : "client_error",
              detail: err instanceof ApiError ? err.detail : errMessage(err),
            },
          }));
        }
      } finally {
        streamingRef.current = false;
        abortRef.current = null;
        setStreaming(false);
        cb.current.refreshInfo();
        void loadSessions();
      }
    },
    [sessionId, handleEvent, patchTurn, loadSessions],
  );

  const closeCitation = useCallback(() => setOpenCitation(null), []);

  const stop = () => abortRef.current?.abort();

  const handleToggleSection = useCallback(
    (key: string, section: "query" | "steps" | "answer") => {
      setTurns((all) =>
        all.map((t) => {
          if (t.key !== key) return t;
          if (section === "query") return { ...t, queryOpen: !(t.queryOpen ?? true) };
          if (section === "steps") return { ...t, stepsOpen: !(t.stepsOpen ?? true) };
          if (section === "answer") return { ...t, answerOpen: !(t.answerOpen ?? true) };
          return t;
        }),
      );
    },
    [],
  );

  const expandAll = () => {
    setTurns((all) =>
      all.map((t) => ({ ...t, queryOpen: true, stepsOpen: true, answerOpen: true })),
    );
  };

  const collapseAll = () => {
    setTurns((all) =>
      all.map((t) => ({ ...t, queryOpen: false, stepsOpen: false, answerOpen: false })),
    );
  };

  const allQueriesOpen =
    turns.length > 0 && turns.every((t) => t.queryOpen !== false);
  const toggleAllQueries = () => {
    const next = !allQueriesOpen;
    setTurns((all) => all.map((t) => ({ ...t, queryOpen: next })));
  };

  const allStepsOpen =
    turns.length > 0 && turns.every((t) => t.stepsOpen !== false);
  const toggleAllSteps = () => {
    const next = !allStepsOpen;
    setTurns((all) => all.map((t) => ({ ...t, stepsOpen: next })));
  };

  const allAnswersOpen =
    turns.length > 0 && turns.every((t) => t.answerOpen !== false);
  const toggleAllAnswers = () => {
    const next = !allAnswersOpen;
    setTurns((all) => all.map((t) => ({ ...t, answerOpen: next })));
  };

  const newSession = async () => {
    setPageError(null);
    try {
      const created = await createSession();
      setSessionId(created.session_id);
      void loadSessions();
      refreshSessions?.();
    } catch (err) {
      setPageError(`Không tạo được phiên mới: ${errMessage(err)}`);
    }
  };

  useEffect(() => {
    if (!active) {
      setHierarchyControls?.(null);
      return;
    }
    setHierarchyControls?.({
      expandAll,
      collapseAll,
      turnCount: turns.length,
    });
    return () => {
      setHierarchyControls?.(null);
    };
  }, [active, turns.length, setHierarchyControls]);

  return (
    <div className="assistant-view">
      {pageError && (
        <div className="turn-error" role="alert">
          {pageError}
        </div>
      )}

      <div
        className="assistant-turns"
        role="region"
        aria-label="Lịch sử hội thoại"
        tabIndex={0}
      >
        {historyLoading && (
          <p className="muted" role="status">
            Đang tải lịch sử phiên…
          </p>
        )}
        {historyError !== null && (
          <div className="turn-error" role="alert">
            <span>Không tải được lịch sử phiên: {historyError}</span>{" "}
            <button
              type="button"
              className="btn-small"
              onClick={() => setHistoryAttempt((n) => n + 1)}
            >
              Thử lại
            </button>
          </div>
        )}
        {!historyLoading && historyError === null && turns.length === 0 && (
          <p className="muted assistant-empty" role="status">
            Chưa có câu hỏi nào. Chọn một gợi ý hoặc nhập câu hỏi bên dưới.
          </p>
        )}
        {turns.map((t) => (
          <TurnView
            key={t.key}
            turn={t}
            onOpenCitation={setOpenCitation}
            onToggleSection={handleToggleSection}
          />
        ))}
        <div ref={endRef} />
      </div>

      <SuggestionChips
        state={examples}
        disabled={streaming}
        onPick={(q) => void send(q)}
        onRetry={() => void loadExamples()}
      />
      <Composer
        value={text}
        onChange={setText}
        onSend={() => void send(text)}
        onStop={stop}
        streaming={streaming}
      />

      {openCitation && (
        <ArticleModal
          articleId={openCitation.article_id}
          breadcrumb={openCitation.breadcrumb}
          onClose={closeCitation}
        />
      )}
    </div>
  );
}
