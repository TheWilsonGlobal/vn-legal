import type { Citation } from "../../types/agent";

function citationLabel(c: Citation): string {
  return `${c.breadcrumb.join(" › ")} (via ${c.via})`;
}

interface Props {
  citations: Citation[];
  onOpen: (citation: Citation) => void;
}

export default function CitationBreadcrumbs({ citations, onOpen }: Props) {
  return (
    <ul className="citations" aria-label="Trích dẫn">
      {citations.map((c, i) => (
        <li key={`${c.article_id}-${c.clause_id ?? ""}-${i}`}>
          <button
            type="button"
            className="citation-link"
            title="Mở điều luật"
            aria-haspopup="dialog"
            onClick={() => onOpen(c)}
          >
            {citationLabel(c)}
          </button>
        </li>
      ))}
    </ul>
  );
}
