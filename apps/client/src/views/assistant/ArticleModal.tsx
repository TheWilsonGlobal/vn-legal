import { useEffect, useRef, useState } from "react";
import MarkdownView from "../../components/MarkdownView";

interface RelatedRef {
  id: string;
  article_number: number;
  title: string;
}

/** GET /api/article/:id (apps/server/src/api/routes/articles.ts). */
interface ArticleResponse {
  article: { article_number: number; title: string; content: string };
  related_articles: {
    references: RelatedRef[];
    referenced_by: RelatedRef[];
  };
}

type State =
  | { status: "loading" }
  | { status: "ready"; data: ArticleResponse }
  | { status: "error"; message: string };

async function fetchArticle(
  id: string,
  signal: AbortSignal,
): Promise<ArticleResponse> {
  const res = await fetch(`/api/article/${encodeURIComponent(id)}`, {
    credentials: "same-origin",
    signal,
  });
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "Không tìm thấy điều luật (404)"
        : `Máy chủ trả về lỗi ${res.status}`,
    );
  }
  const body = (await res.json()) as Partial<
    Omit<ArticleResponse, "article">
  > & { article?: Record<string, unknown> };
  if (
    !body.article ||
    typeof body.article !== "object" ||
    typeof body.article.article_number !== "number" ||
    typeof body.article.title !== "string" ||
    typeof body.article.content !== "string" ||
    !body.related_articles ||
    !Array.isArray(body.related_articles.references) ||
    !Array.isArray(body.related_articles.referenced_by)
  ) {
    throw new Error("Phản hồi điều luật không đúng định dạng");
  }
  return body as unknown as ArticleResponse;
}

function RelatedList({ title, items }: { title: string; items: RelatedRef[] }) {
  if (items.length === 0) return null;
  return (
    <div className="article-related">
      <h4>{title}</h4>
      <ul>
        {items.map((r) => (
          <li key={r.id}>
            Điều {r.article_number}. {r.title}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Props {
  articleId: string;
  breadcrumb: string[];
  onClose: () => void;
}

export default function ArticleModal({
  articleId,
  breadcrumb,
  onClose,
}: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Captured during render: autoFocus moves focus before effects run.
  const openerRef = useRef<HTMLElement | null>(
    document.activeElement as HTMLElement | null,
  );

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ status: "loading" });
    fetchArticle(articleId, ctrl.signal).then(
      (data) => setState({ status: "ready", data }),
      (err: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      },
    );
    return () => ctrl.abort();
  }, [articleId, attempt]);

  useEffect(() => {
    // WCAG 2.1.2 / 2.4.3: Esc closes, Tab is trapped inside the dialog.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (!dialogRef.current.contains(current)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Return focus to the opener when the dialog closes (WCAG 2.4.3).
  useEffect(() => {
    const opener = openerRef.current;
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  return (
    <div className="article-overlay" onClick={onClose}>
      <div
        className="article-modal"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Chi tiết điều luật"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="article-close"
          aria-label="Đóng"
          onClick={onClose}
          autoFocus
        >
          <span aria-hidden="true">✕</span>
        </button>
        <p className="muted article-crumb">{breadcrumb.join(" › ")}</p>
        {state.status === "loading" && (
          <p className="muted" role="status">
            Đang tải…
          </p>
        )}
        {state.status === "error" && (
          <div className="turn-error" role="alert">
            <span>{state.message}</span>{" "}
            <button
              type="button"
              className="btn-small"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Thử lại
            </button>
          </div>
        )}
        {state.status === "ready" && (
          <>
            <h3>
              Điều {state.data.article.article_number}.{" "}
              {state.data.article.title}
            </h3>
            <MarkdownView text={state.data.article.content} />
            <RelatedList
              title="Dẫn chiếu tới"
              items={state.data.related_articles.references}
            />
            <RelatedList
              title="Được dẫn chiếu bởi"
              items={state.data.related_articles.referenced_by}
            />
          </>
        )}
      </div>
    </div>
  );
}
