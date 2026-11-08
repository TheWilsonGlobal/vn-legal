import { useEffect, useState } from "react";
import type { AgentStep, Citation } from "../../types/agent";
import type { SectionsForce } from "../../components/MarkdownView";
import CitationBreadcrumbs from "./CitationBreadcrumbs";
import ObservationGraphView from "./ObservationGraphView";
import CommunityReports from "./CommunityReports";

type PaneKind = "text" | "graph" | "reports";

const TAB_LABEL: Record<PaneKind, string> = {
  text: "Văn bản",
  graph: "Đồ thị",
  reports: "Tổng hợp",
};

const TOOL_ICONS: Record<string, string> = {
  search_legal_articles: "🔍",
  traverse_references: "🔗",
  get_community_context: "🌐",
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
  defaultOpen?: boolean;
  /** Group action from the parent: open or close this step's details. */
  forceOpen?: SectionsForce;
}

export default function StepItem({
  step,
  onOpenCitation,
  defaultOpen = true,
  forceOpen,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [view, setView] = useState<PaneKind>("text");

  // Panes this step has data for. Text is shown first, then graph, then synthesis.
  const tabs: PaneKind[] = [
    ...(step.citations && step.citations.length > 0 ? (["text"] as const) : []),
    ...(step.graph && step.graph.nodes.length > 0 ? (["graph"] as const) : []),
    ...(step.reports && step.reports.length > 0 ? (["reports"] as const) : []),
  ];
  const current: PaneKind = tabs.includes(view) ? view : (tabs[0] ?? "text");

  useEffect(() => {
    if (forceOpen) setOpen(forceOpen.open);
  }, [forceOpen]);

  return (
    <li
      className={`step${step.ok ? "" : " step-failed"}${
        step.kind === "final" ? " step-final" : ""
      }`}
    >
      <div
        className="step-head"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        title="Nhấn để thu gọn / mở rộng chi tiết bước này"
      >
        <span className="step-toggle-icon" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
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
      {open && (
        <div className="step-body">
          <p className="step-content">
            {step.content.trim() ? (
              step.content
            ) : (
              <span className="muted">(no output)</span>
            )}
          </p>
          {step.tool_input && <pre className="step-input">{step.tool_input}</pre>}
          {tabs.length > 0 && (
            <>
              {tabs.length > 1 && (
                <div className="seg-toggle obs-tabs" role="tablist" aria-label="Kiểu hiển thị kết quả">
                  {tabs.map((v) => (
                    <button
                      key={v}
                      type="button"
                      role="tab"
                      aria-selected={current === v}
                      className={`seg-toggle-btn${current === v ? " is-active" : ""}`}
                      onClick={() => setView(v)}
                    >
                      {TAB_LABEL[v]}
                    </button>
                  ))}
                </div>
              )}
              {current === "text" && step.citations && (
                <CitationBreadcrumbs citations={step.citations} onOpen={onOpenCitation} />
              )}
              {current === "graph" && step.graph && <ObservationGraphView graph={step.graph} />}
              {current === "reports" && step.reports && <CommunityReports reports={step.reports} />}
            </>
          )}
        </div>
      )}
    </li>
  );
}
