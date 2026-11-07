import type { ConsultCommunityReport, ConsultContext } from "../../types/agent";
import {
  getUniqueCount,
  idOf,
  onActivate,
  renderTitle,
  summaryExcerpt,
  textOr,
} from "./graph-builder";
import { type ArticleItem, NO_TITLE } from "./types";

interface ResultsAccordionProps {
  lastContext: ConsultContext | null;
  expanded: string[];
  toggleSection: (name: string) => void;
  onSelectArticle: (article: ArticleItem) => void;
  onSelectReport: (report: ConsultCommunityReport) => void;
  onNavigateAssistant: () => void;
}

export function ResultsAccordion({
  lastContext,
  expanded,
  toggleSection,
  onSelectArticle,
  onSelectReport,
  onNavigateAssistant,
}: ResultsAccordionProps) {
  const header = (
    name: string,
    cls: string,
    icon: string,
    title: string,
    count: number | null,
    countLabel: string,
  ) => (
    <div
      className={`accordion-header ${cls} ${expanded.includes(name) ? "active" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={expanded.includes(name)}
      onClick={() => toggleSection(name)}
      onKeyDown={onActivate(() => toggleSection(name))}
    >
      <h3>
        <i className={icon}></i> {title}{" "}
        {count !== null && (
          <span className="source-count small">
            {count} {countLabel}
          </span>
        )}
      </h3>
      <i className="fas fa-chevron-down"></i>
    </div>
  );

  const itemProps = (open: () => void, idx: number) => ({
    className: "context-item animate-in clickable",
    style: { animationDelay: `${idx * 0.1}s` },
    role: "button" as const,
    tabIndex: 0,
    onClick: open,
    onKeyDown: onActivate(open),
  });

  const emptyContext = (
    <div className="initial-state">
      Chưa có ngữ cảnh — hãy hỏi trợ lý.{" "}
      <button
        type="button"
        className="link-btn"
        onClick={onNavigateAssistant}
      >
        Mở Trợ lý
      </button>
    </div>
  );

  return (
    <div className="results-list-panel glass-card">
      <div className="sidebar-header">
        <h2>
          <i className="fas fa-book-open"></i> Tài liệu Pháp lý
        </h2>
        {lastContext && (
          <span className="source-count">
            {getUniqueCount(lastContext)} kết quả
          </span>
        )}
      </div>
      {lastContext && (
        <p className="muted">Truy vấn: {lastContext.query}</p>
      )}

      <div className="accordion-container">
        {lastContext && lastContext.community_reports.length > 0 && (
          <div className="accordion-item">
            {header(
              "global",
              "global-accent",
              "fas fa-globe-asia",
              "Global Synthesis",
              lastContext.community_reports.length,
              "báo cáo",
            )}
            {expanded.includes("global") && (
              <div className="accordion-content">
                <div className="scroll-content">
                  <div className="results-grid">
                    {lastContext.community_reports.map((r, idx) => (
                      <div
                        key={r.id}
                        {...itemProps(() => onSelectReport(r), idx)}
                      >
                        <div className="report-item-header">
                          <h5>{textOr(r.title, NO_TITLE)}</h5>
                          <span className="rating-badge">
                            <i className="fas fa-star"></i> {r.rating}/10
                          </span>
                        </div>
                        <p className="summary-text-sm">
                          {summaryExcerpt(r.summary)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="accordion-item">
          {header(
            "semantic",
            "",
            "fas fa-microchip",
            "Semantic Search",
            lastContext ? lastContext.seed_articles.length : null,
            "kết quả",
          )}
          {expanded.includes("semantic") && (
            <div className="accordion-content">
              <div className="scroll-content">
                {lastContext ? (
                  <div className="results-grid">
                    {lastContext.seed_articles.map((i, idx) => (
                      <div
                        key={`${idOf(i) ?? "no-id"}-${idx}`}
                        {...itemProps(() => onSelectArticle(i), idx)}
                      >
                        <h5>
                          <span className="item-title">
                            {renderTitle(i)}
                          </span>
                          <span className="item-head badge">
                            <span className="relevance">
                              {Math.round(i.score * 100)}% Match
                            </span>
                          </span>
                        </h5>
                      </div>
                    ))}
                  </div>
                ) : (
                  emptyContext
                )}
              </div>
            </div>
          )}
        </div>

        <div className="accordion-item">
          {header(
            "graph",
            "",
            "fas fa-project-diagram",
            "Graph Traversal",
            lastContext ? lastContext.path_context.length : null,
            "kết quả",
          )}
          {expanded.includes("graph") && (
            <div className="accordion-content">
              <div className="scroll-content">
                {lastContext ? (
                  <div className="results-grid">
                    {lastContext.path_context.map((i, idx) => (
                      <div
                        key={`${idOf(i) ?? "no-id"}-${idx}`}
                        {...itemProps(() => onSelectArticle(i), idx)}
                      >
                        <h5>
                          <span className="item-title">
                            {renderTitle(i)}
                          </span>
                          <span className="item-head badge">
                            <span className="depth">BẬC {i.depth}</span>
                          </span>
                        </h5>
                      </div>
                    ))}
                  </div>
                ) : (
                  emptyContext
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
