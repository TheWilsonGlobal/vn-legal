import { useId } from "react";
import type { KeyboardEvent } from "react";

export const MAX_QUERY = 1000;

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
}

export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
}: Props) {
  const hintId = useId();
  const canSend = !streaming && value.trim().length > 0;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <div className="composer">
      <textarea
        aria-label="Câu hỏi"
        aria-describedby={hintId}
        placeholder="Nhập câu hỏi (Ctrl+Enter để gửi)"
        value={value}
        maxLength={MAX_QUERY}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="composer-bar">
        <span id={hintId} className="composer-hint">
          Ctrl+Enter để gửi
        </span>
        <span
          className={`composer-count${
            value.length >= MAX_QUERY ? " at-limit" : ""
          }`}
        >
          {value.length}/{MAX_QUERY}
          {value.length >= MAX_QUERY && (
            <span className="visually-hidden"> — đã đạt giới hạn</span>
          )}
        </span>
        {streaming && (
          <button type="button" className="btn-stop" onClick={onStop}>
            <span aria-hidden="true">■ </span>Dừng
          </button>
        )}
        <button
          type="button"
          className="btn-send"
          disabled={!canSend}
          onClick={onSend}
        >
          Gửi
        </button>
      </div>
    </div>
  );
}
