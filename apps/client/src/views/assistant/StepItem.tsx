import type { AgentStep, Citation } from "../../types/agent";
import CitationBreadcrumbs from "./CitationBreadcrumbs";

const TOOL_ICONS: Record<string, string> = {
  search_legal_articles: "🔍",
  traverse_references: "🔗",
  get_community_context: "🏛",
  get_article: "📄",
  recall_session: "🧠",
};

function ToolChip({ tool }: { tool: string | null }) {
  if (!tool) return null;
  const icon = TOOL_ICONS[tool];
  return (
    <span className="badge badge-tool mono">
      {icon && <span aria-hidden="true">{icon} </span>}
      {tool}
    </span>
  );
}

interface Props {
  step: AgentStep;
  onOpenCitation: (citation: Citation) => void;
}

export default function StepItem({ step, onOpenCitation }: Props) {
  return (
    <li
      className={`step${step.ok ? "" : " step-failed"}${
        step.kind === "final" ? " step-final" : ""
      }`}
    >
      <div className="step-head">
        <span
          className="badge badge-step-num mono"
          aria-label={`Bước ${step.index + 1}`}
        >
          #{step.index + 1}
        </span>
        <span className={`badge badge-kind-${step.kind}`}>{step.kind}</span>
        <ToolChip tool={step.tool} />
        {!step.ok && (
          <span className="badge badge-bad">
            <span aria-hidden="true">✕ </span>failed
          </span>
        )}
        <span className="muted step-dur">{step.duration_ms.toFixed(1)} ms</span>
      </div>
      <p className="step-content">
        {step.content.trim() ? (
          step.content
        ) : (
          <span className="muted">(no output)</span>
        )}
      </p>
      {step.tool_input && <pre className="step-input">{step.tool_input}</pre>}
      {step.citations && step.citations.length > 0 && (
        <CitationBreadcrumbs
          citations={step.citations}
          onOpen={onOpenCitation}
        />
      )}
    </li>
  );
}
