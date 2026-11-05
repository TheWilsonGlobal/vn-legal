import { useId, useState } from "react";
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
}

interface Props {
  turn: TurnState;
  onOpenCitation: (citation: Citation) => void;
}

export default function TurnView({ turn, onOpenCitation }: Props) {
  const [open, setOpen] = useState(true);
  const stepsId = useId();
  const streaming = turn.status === "streaming";
  const showAnswer = turn.status !== "error" && turn.answer !== "";

  return (
    <article className="turn glass-card">
      <div className="turn-query">
        <span className="turn-role">Bạn</span>
        <p>{turn.query}</p>
      </div>

      <button
        type="button"
        className="trace-toggle"
        aria-expanded={open}
        aria-controls={stepsId}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"} </span>
        Các bước thực thi ({turn.steps.length})
        {streaming && <span className="muted"> · đang chạy…</span>}
      </button>
      {open && turn.steps.length > 0 && (
        <ol className="steps" id={stepsId} role="list">
          {turn.steps.map((s) => (
            <StepItem key={s.index} step={s} onOpenCitation={onOpenCitation} />
          ))}
        </ol>
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

      {(showAnswer || streaming) && (
        <div
          className="turn-answer"
          aria-live="polite"
          aria-atomic="false"
          aria-busy={streaming}
        >
          {showAnswer && <MarkdownView text={turn.answer} />}
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
