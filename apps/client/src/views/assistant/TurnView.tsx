import { useId, useState, useEffect } from "react";
import MarkdownView from "../../components/MarkdownView";
import type { AgentStep, Citation } from "../../types/agent";
import StepItem from "./StepItem";

export type TurnStatus = "streaming" | "done" | "error" | "cancelled";

export interface TurnState {
  key: string;
  query: string;
  answer: string;
  steps: AgentStep[];
  status: TurnStatus;
  /** code is null when derived client-side from ok:false (no server code). */
  error: { code: string | null; detail: string | null } | null;
  trace_url: string | null;
  queryOpen?: boolean;
  stepsOpen?: boolean;
  answerOpen?: boolean;
}

interface Props {
  turn: TurnState;
  onOpenCitation: (citation: Citation) => void;
  onToggleSection?: (key: string, section: "query" | "steps" | "answer") => void;
}

export default function TurnView({
  turn,
  onOpenCitation,
  onToggleSection,
}: Props) {
  const [queryOpen, setQueryOpen] = useState(turn.queryOpen ?? true);
  const [stepsOpen, setStepsOpen] = useState(turn.stepsOpen ?? true);
  const [answerOpen, setAnswerOpen] = useState(turn.answerOpen ?? true);

  // Sync with parent props when changed globally
  useEffect(() => {
    if (turn.queryOpen !== undefined) setQueryOpen(turn.queryOpen);
  }, [turn.queryOpen]);

  useEffect(() => {
    if (turn.stepsOpen !== undefined) setStepsOpen(turn.stepsOpen);
  }, [turn.stepsOpen]);

  useEffect(() => {
    if (turn.answerOpen !== undefined) setAnswerOpen(turn.answerOpen);
  }, [turn.answerOpen]);

  const stepsId = useId();
  const queryId = useId();
  const answerId = useId();
  const streaming = turn.status === "streaming";
  const showAnswer = turn.status !== "error" && turn.answer !== "";

  const handleToggleQuery = () => {
    setQueryOpen((v) => {
      onToggleSection?.(turn.key, "query");
      return !v;
    });
  };

  const handleToggleSteps = () => {
    setStepsOpen((v) => {
      onToggleSection?.(turn.key, "steps");
      return !v;
    });
  };

  const handleToggleAnswer = () => {
    setAnswerOpen((v) => {
      onToggleSection?.(turn.key, "answer");
      return !v;
    });
  };

  return (
    <article className="turn glass-card">
      {/* 1. Câu hỏi (Question) */}
      <div className="turn-section turn-query-section">
        <button
          type="button"
          className="section-toggle turn-query-toggle"
          aria-expanded={queryOpen}
          aria-controls={queryId}
          onClick={handleToggleQuery}
        >
          <span className="toggle-chevron" aria-hidden="true">
            {queryOpen ? "▾" : "▸"}
          </span>
          <span className="turn-role">Bạn</span>
          {!queryOpen && (
            <span className="query-snippet muted">
              : {turn.query.length > 70 ? `${turn.query.slice(0, 70)}…` : turn.query}
            </span>
          )}
        </button>
        {queryOpen && (
          <div className="turn-query-body" id={queryId}>
            <p className="turn-query-text">{turn.query}</p>
          </div>
        )}
      </div>

      {/* 2. Các bước suy luận (Reasoning Steps) */}
      {turn.steps.length > 0 && (
        <div className="turn-section turn-steps-section">
          <button
            type="button"
            className="trace-toggle section-toggle"
            aria-expanded={stepsOpen}
            aria-controls={stepsId}
            onClick={handleToggleSteps}
          >
            <span className="toggle-chevron" aria-hidden="true">
              {stepsOpen ? "▾" : "▸"}
            </span>
            <span>Các bước thực thi ({turn.steps.length})</span>
            {streaming && <span className="muted"> · đang chạy…</span>}
          </button>
          {stepsOpen && (
            <ol className="steps" id={stepsId} role="list">
              {turn.steps.map((s) => (
                <StepItem
                  key={s.index}
                  step={s}
                  onOpenCitation={onOpenCitation}
                />
              ))}
            </ol>
          )}
        </div>
      )}

      {turn.status === "error" && turn.error && (
        <div className="turn-error" role="alert">
          <strong>
            {turn.error.code === null
              ? "Lượt chạy thất bại"
              : `Lỗi: ${turn.error.code}`}
          </strong>
          {turn.error.code === null && (
            <span className="muted"> (suy ra từ ok:false)</span>
          )}
          {turn.error.detail && <span> — {turn.error.detail}</span>}
        </div>
      )}

      {turn.status === "cancelled" && (
        <p className="turn-cancelled muted" role="status">
          Đã dừng (cancelled).
        </p>
      )}

      {/* 3. Phản hồi / Câu trả lời (Response) */}
      {(showAnswer || streaming) && (
        <div className="turn-section turn-answer-section">
          <div className="turn-answer-header">
            <button
              type="button"
              className="section-toggle turn-answer-toggle"
              aria-expanded={answerOpen}
              aria-controls={answerId}
              onClick={handleToggleAnswer}
            >
              <span className="toggle-chevron" aria-hidden="true">
                {answerOpen ? "▾" : "▸"}
              </span>
              <span className="turn-role assistant-role">Trợ lý</span>
              {!answerOpen && (
                <span className="answer-snippet muted">
                  : {turn.answer.trim().slice(0, 80).replace(/[#*`_]/g, "")}…
                </span>
              )}
            </button>
          </div>
          {answerOpen && (
            <div
              className="turn-answer"
              id={answerId}
              aria-live="polite"
              aria-atomic="false"
              aria-busy={streaming}
            >
              {showAnswer && <MarkdownView text={turn.answer} />}
            </div>
          )}
        </div>
      )}

      {turn.trace_url !== null && (
        <a
          className="langfuse-link"
          href={turn.trace_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Mở trong Langfuse
          <span aria-hidden="true"> ↗</span>
          <span className="visually-hidden"> (mở trong tab mới)</span>
        </a>
      )}
    </article>
  );
}
