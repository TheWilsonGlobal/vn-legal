import { useId } from "react";
import SegmentedToggle from "../../components/SegmentedToggle";
import MarkdownView, {
  countResponseSections,
  type SectionsForce,
} from "../../components/MarkdownView";
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
  /** Last group action on the answer's response sections. */
  sectionsForce?: SectionsForce;
  /** Last group action on the steps. */
  stepsForce?: SectionsForce;
}

interface Props {
  turn: TurnState;
  onOpenCitation: (citation: Citation) => void;
  onToggleSection?: (key: string, section: "query" | "steps" | "answer") => void;
  /** Opens (true) or closes (false) the steps section of every turn. */
  onSetAllSteps?: (open: boolean) => void;
  /** Opens (true) or closes (false) the answer section of every turn. */
  onSetAllAnswers?: (open: boolean) => void;
}

/** Mở rộng / Thu gọn tất cả, shown at the right end of a section header. */
function GroupControls({
  onOpen,
  label,
}: {
  onOpen: (open: boolean) => void;
  label: string;
}) {
  return (
    <span className="turn-group-controls">
      <SegmentedToggle
        ariaLabel={`${label}: mở rộng hoặc thu gọn`}
        options={[
          { label: "Mở rộng", icon: "expand", onSelect: () => onOpen(true) },
          { label: "Thu gọn", icon: "collapse", onSelect: () => onOpen(false) },
        ]}
      />
    </span>
  );
}

export default function TurnView({
  turn,
  onOpenCitation,
  onToggleSection,
  onSetAllSteps,
  onSetAllAnswers,
}: Props) {
  // The parent's flags are the single source of truth. Local copies drifted
  // from them, so a group "collapse" could be a no-op.
  const queryOpen = turn.queryOpen ?? true;
  const stepsOpen = turn.stepsOpen ?? true;
  const answerOpen = turn.answerOpen ?? true;

  const stepsId = useId();
  const queryId = useId();
  const answerId = useId();
  const streaming = turn.status === "streaming";
  const showAnswer = turn.status !== "error" && turn.answer !== "";
  const answerSections = countResponseSections(turn.answer);

  const handleToggleQuery = () => onToggleSection?.(turn.key, "query");
  const handleToggleSteps = () => onToggleSection?.(turn.key, "steps");
  const handleToggleAnswer = () => onToggleSection?.(turn.key, "answer");

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

      {/* 2. Các bước suy luận (Reasoning Steps - excludes final answer step) */}
      {(() => {
        const reasoningSteps = turn.steps.filter((s) => s.kind !== "final");
        if (reasoningSteps.length === 0) return null;

        return (
          <div className="turn-section turn-steps-section">
            <div className="turn-group-header">
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
                <span>Các bước thực thi ({reasoningSteps.length})</span>
                {streaming && <span className="muted"> · đang chạy…</span>}
              </button>
              {onSetAllSteps && (
                <GroupControls label="Các bước thực thi" onOpen={onSetAllSteps} />
              )}
            </div>
            {stepsOpen && (
              <ol className="steps" id={stepsId} role="list">
                {reasoningSteps.map((s, idx) => (
                  <StepItem
                    key={s.index ?? idx}
                    step={s}
                    onOpenCitation={onOpenCitation}
                    forceOpen={turn.stepsForce}
                  />
                ))}
              </ol>
            )}
          </div>
        );
      })()}

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
          <div className="turn-answer-header turn-group-header">
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
              <span className="turn-role assistant-role">
                Trợ lý
                {answerSections > 0 && ` (${answerSections})`}
              </span>
            </button>
            {onSetAllAnswers && (
              <GroupControls label="Trợ lý" onOpen={onSetAllAnswers} />
            )}
          </div>
          {answerOpen && (
            <div
              className="turn-answer"
              id={answerId}
              aria-live="polite"
              aria-atomic="false"
              aria-busy={streaming}
            >
              {showAnswer && (
                <MarkdownView text={turn.answer} forceSections={turn.sectionsForce} />
              )}
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
