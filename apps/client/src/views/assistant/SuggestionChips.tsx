import type { ExampleChip } from "../../types/agent";

export type ExamplesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; items: ExampleChip[] }
  | { status: "error"; message: string };

interface Props {
  state: ExamplesState;
  disabled: boolean;
  onPick: (query: string) => void;
  onRetry: () => void;
}

export default function SuggestionChips({
  state,
  disabled,
  onPick,
  onRetry,
}: Props) {
  if (state.status === "error") {
    return (
      <div className="chips-error" role="alert">
        <span>Không tải được gợi ý: {state.message}</span>
        <button type="button" className="btn-small" onClick={onRetry}>
          Thử lại
        </button>
      </div>
    );
  }
  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return (
      <p className="muted chips-loading" role="status">
        Đang tải gợi ý…
      </p>
    );
  }
  return (
    <div className="chips" role="group" aria-label="Gợi ý câu hỏi">
      {state.items.map((c) => (
        <button
          key={c.label}
          type="button"
          className="chip"
          disabled={disabled}
          title={c.query}
          onClick={() => onPick(c.query)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
