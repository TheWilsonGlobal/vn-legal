import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { SigmaGraphVisualization } from "../../SigmaGraphVisualization";
import type { GraphData } from "../../SigmaGraphVisualization";
import type {
  ConsultCommunityReport,
  ConsultContext,
  ConsultPathArticle,
  ConsultSeedArticle,
} from "../../types/agent";
import type { ViewProps } from "../../types/views";
import "../../styles/views.css";
import { useApiResource } from "../sessions/useApiResource";

type ArticleItem = ConsultSeedArticle | ConsultPathArticle;

/** Minimal surface of the Cytoscape instance used here (CDN script). */
interface CyInstance {
  zoom(): number;
  zoom(level: number): void;
  center(): void;
  fit(): void;
  on(event: string, cb: () => void): void;
  destroy(): void;
}
type CytoscapeFactory = (options: Record<string, unknown>) => CyInstance;

function getCytoscape(): CytoscapeFactory | null {
  const cy = (window as unknown as { cytoscape?: unknown }).cytoscape;
  return typeof cy === "function" ? (cy as CytoscapeFactory) : null;
}

interface ExplorerConfig {
  mode: "query" | "explorer";
  graph: GraphData | null;
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function loadExplorerConfig(
  signal: AbortSignal,
): Promise<ExplorerConfig> {
  const config = (await fetchJson("/api/config", signal)) as {
    clientGraphMode?: unknown;
  };
  if (
    config.clientGraphMode !== "query" &&
    config.clientGraphMode !== "explorer"
  ) {
    throw new Error(
      `/api/config returned an unknown clientGraphMode: ${String(config.clientGraphMode)}`,
    );
  }
  if (config.clientGraphMode === "query") {
    return { mode: "query", graph: null };
  }
  const graph = (await fetchJson("/api/admin/graph/data", signal)) as GraphData;
  return { mode: "explorer", graph };
}

const EXPLORER_NODE_TYPES = [
  "Part",
  "Chapter",
  "Section",
  "Subsection",
  "Article",
  "Clause",
];
const EXPLORER_EDGE_TYPES = [
  "HAS_PART",
  "HAS_CHAPTER",
  "HAS_SECTION",
  "HAS_SUBSECTION",
  "HAS_ARTICLE",
  "HAS_CLAUSE",
];

/** Stable id of an article: article_id, else id. Undefined when the server sent neither. */
const idOf = (i: ArticleItem): string | undefined => i.article_id ?? i.id;

const NO_TITLE = "(không có tiêu đề)";
const NO_SUMMARY = "(không có tóm tắt)";

/** Text, or an explicit label when the field is absent. */
function textOr(value: unknown, label: string): string {
  return typeof value === "string" && value.length > 0 ? value : label;
}

function summaryExcerpt(summary: unknown): string {
  if (typeof summary !== "string" || summary.length === 0) return NO_SUMMARY;
  return summary.length > 120 ? `${summary.substring(0, 120)}...` : summary;
}

/** "Điều N" / "Khoản K, Điều N" built only from the fields that exist. */
function articlePrefix(i: ArticleItem): string | null {
  const clause = i.matched_entity_id?.match(/clause_(\d+)/i);
  const article =
    i.article_number === undefined ? null : `Điều ${i.article_number}`;
  if (clause) {
    return article ? `Khoản ${clause[1]}, ${article}` : `Khoản ${clause[1]}`;
  }
  return article;
}

function nodeLabel(i: ArticleItem): string {
  return articlePrefix(i) ?? i.title ?? NO_TITLE;
}

function renderTitle(item: ArticleItem): string {
  const prefix = articlePrefix(item);
  if (item.title === undefined) return prefix ?? NO_TITLE;
  if (prefix === null) return item.title;
  if (item.article_number === undefined) return `${prefix}. ${item.title}`;
  const base = `Điều ${item.article_number}`;
  if (item.title.startsWith(base)) {
    if (prefix.startsWith("Khoản")) {
      return `${prefix} - ${item.title
        .substring(base.length)
        .trim()
        .replace(/^[.-]\s*/, "")}`;
    }
    return item.title;
  }
  return `${prefix}. ${item.title}`;
}

/** Display text of a hierarchy value: node object (name) or plain string; "—" when absent. */
function nodeText(x: unknown): string {
  if (typeof x === "string") return x.length > 0 ? x : "—";
  if (x !== null && typeof x === "object") {
    const n = x as { name?: unknown; name_short?: unknown };
    if (typeof n.name === "string" && n.name.length > 0) return n.name;
    if (typeof n.name_short === "string" && n.name_short.length > 0) {
      return n.name_short;
    }
  }
  return "—";
}

function getUniqueCount(ctx: ConsultContext): number {
  // An article without any id cannot be de-duplicated: it counts as itself.
  const ids = new Set<string | ArticleItem>();
  ctx.seed_articles.forEach((i) => ids.add(idOf(i) ?? i));
  ctx.path_context.forEach((i) => ids.add(idOf(i) ?? i));
  return ids.size + ctx.community_reports.length;
}

interface GraphBuild {
  nodes: { data: Record<string, unknown> }[];
  edges: { data: Record<string, unknown> }[];
  /** Contract violations found while building; shown to the user, never hidden. */
  problems: string[];
}

/** Build the Cytoscape elements for one retrieval context. */
function buildElements(ctx: ConsultContext): GraphBuild {
  const problems: string[] = [];
  const nodeMap = new Map<string, { data: Record<string, unknown> }>();
  nodeMap.set("search-query", {
    data: { id: "search-query", label: "Truy vấn", type: "query" },
  });
  const queryTargets: string[] = [];
  ctx.seed_articles.forEach((i, idx) => {
    const id = idOf(i);
    if (id === undefined) {
      problems.push(`seed_articles[${idx}] không có article_id/id`);
      return;
    }
    if (!queryTargets.includes(id)) queryTargets.push(id);
    nodeMap.set(id, {
      data: { id, label: nodeLabel(i), title: i.title, type: "seed" },
    });
  });
  ctx.path_context.forEach((i, idx) => {
    const id = idOf(i);
    if (id === undefined) {
      problems.push(`path_context[${idx}] không có article_id/id`);
      return;
    }
    if (i.depth === 0 && !queryTargets.includes(id)) queryTargets.push(id);
    if (nodeMap.has(id)) return;
    nodeMap.set(id, {
      data: {
        id,
        label: nodeLabel(i),
        title: i.title,
        type: "context",
        ragType: i.depth > 0 ? "path-rag" : "graph-rag",
      },
    });
  });

  const edgeMap = new Map<string, { data: Record<string, unknown> }>();
  const addEdge = (prefix: string, source: string, target: string) => {
    const id = `${prefix}:${source}->${target}`;
    edgeMap.set(id, { data: { id, source, target } });
  };
  queryTargets.forEach((target) => addEdge("eq", "search-query", target));
  ctx.path_context.forEach((i, idx) => {
    const id = idOf(i);
    if (id === undefined || i.depth <= 0) return;
    if (i.path.length < 2) {
      problems.push(
        `path_context[${idx}] (bậc ${i.depth}) có path < 2 phần tử`,
      );
      return;
    }
    const parentId = i.path[i.path.length - 2];
    if (!nodeMap.has(parentId)) {
      problems.push(
        `path_context[${idx}]: nút cha "${parentId}" trong path không khớp nút nào`,
      );
      return;
    }
    addEdge("ep", parentId, id);
  });
  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
    problems,
  };
}

const CY_STYLE = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "background-color": "#6366f1",
      color: "#fff",
      "font-size": "10px",
      "text-valign": "center",
      "text-halign": "center",
      width: "50px",
      height: "50px",
      "border-width": 2,
      "border-color": "#fff",
    },
  },
  {
    selector: 'node[type="query"]',
    style: {
      "background-color": "#a855f7",
      width: "70px",
      height: "70px",
      "font-weight": "bold",
      "font-size": "12px",
    },
  },
  {
    selector: 'node[type="seed"]',
    style: { "background-color": "#6366f1", width: "55px", height: "55px" },
  },
  {
    selector: 'node[ragType="path-rag"]',
    style: {
      "background-color": "#14b8a6",
      width: "45px",
      height: "45px",
      "font-size": "9px",
    },
  },
  {
    selector: 'node[ragType="graph-rag"]',
    style: {
      "background-color": "#f59e0b",
      width: "45px",
      height: "45px",
      "font-size": "9px",
    },
  },
  {
    selector: "edge",
    style: {
      width: 2,
      "line-color": "rgba(168, 85, 247, 0.4)",
      "target-arrow-color": "rgba(168, 85, 247, 0.4)",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
    },
  },
];

function onActivate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

function ArticleModal({
  article,
  onClose,
}: {
  article: ArticleItem;
  onClose: () => void;
}) {
  const clauses = article.clauses;
  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className="modal-content glass-card animate-zoom"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vw-article-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            {article.article_number !== undefined && (
              <span className="item-head badge">
                <span className="depth">ĐIỀU {article.article_number}</span>
              </span>
            )}
            <h2 id="vw-article-title">{article.title ?? NO_TITLE}</h2>
          </div>
          <button
            type="button"
            className="btn-close-lg"
            onClick={onClose}
            aria-label="Đóng"
            autoFocus
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
        <div className="modal-body">
          <div className="article-full-content">
            {article.content || "Không có nội dung cho điều luật này."}
          </div>
          {clauses.length > 0 && (
            <div className="article-clauses" style={{ marginTop: "16px" }}>
              <h4 style={{ color: "#a855f7", marginBottom: "8px" }}>
                Các Khoản:
              </h4>
              <div
                style={{ display: "flex", flexDirection: "column", gap: "8px" }}
              >
                {clauses.map((clause, idx) => (
                  <div
                    key={idx}
                    className="clause-item"
                    style={{
                      padding: "8px",
                      background: "rgba(255, 255, 255, 0.05)",
                      borderRadius: "4px",
                    }}
                  >
                    <span style={{ fontWeight: "bold", color: "#14b8a6" }}>
                      Khoản {clause.clause_number}:
                    </span>{" "}
                    {clause.text}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="modal-metadata-grid">
            <div className="meta-box">
              <label>Phần (Part)</label>
              <div className="meta-value">{nodeText(article.part)}</div>
            </div>
            <div className="meta-box">
              <label>Chương (Chapter)</label>
              <div className="meta-value">{nodeText(article.chapter)}</div>
            </div>
            {"score" in article && (
              <div className="meta-box">
                <label>Độ tương đồng</label>
                <div className="score-value highlight">
                  {Math.round(article.score * 100)}% Match
                </div>
              </div>
            )}
            {"depth" in article && (
              <div className="meta-box">
                <label>Khoảng cách đồ thị</label>
                <div>Bậc {article.depth}</div>
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="modern-action-btn primary"
            onClick={onClose}
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportModal({
  report,
  onClose,
}: {
  report: ConsultCommunityReport;
  onClose: () => void;
}) {
  const findings = report.findings;
  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className="modal-content glass-card global-modal animate-zoom"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vw-report-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="item-head badge global-badge">
              <i className="fas fa-globe-asia"></i> GLOBAL REPORT
            </span>
            <h2 id="vw-report-title">{textOr(report.title, NO_TITLE)}</h2>
          </div>
          <button
            type="button"
            className="btn-close-lg"
            onClick={onClose}
            aria-label="Đóng"
            autoFocus
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
        <div className="modal-body scrollable-modal-body">
          <div className="report-summary-box">
            <h3>
              <i className="fas fa-align-left"></i> Tóm tắt vĩ mô
            </h3>
            <p>{textOr(report.summary, NO_SUMMARY)}</p>
          </div>
          {findings.length > 0 && (
            <div className="report-section">
              <h3>
                <i className="fas fa-search"></i> Các phát hiện chính
              </h3>
              <div className="findings-grid-client">
                {findings.map((finding, i) => (
                  <div key={i} className="finding-card-client">
                    <span className="finding-num">{i + 1}</span>
                    <p>{finding}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="modal-metadata-grid">
            <div className="meta-box">
              <label>Độ tin cậy (Rating)</label>
              <div className="meta-value highlight-gold">
                <i className="fas fa-star"></i> {report.rating}/10
              </div>
            </div>
            <div className="meta-box">
              <label>Cấp độ phân tích</label>
              <div className="meta-value">
                {report.level === 0
                  ? "Phần (Part Level)"
                  : "Chương (Chapter Level)"}
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="modern-action-btn primary"
            onClick={onClose}
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

export default function KnowledgeExplorerView(props: ViewProps) {
  const { active, lastContext, navigate } = props;
  const config = useApiResource(active, "explorer-config", loadExplorerConfig);

  const [expanded, setExpanded] = useState<string[]>(["semantic", "graph"]);
  const [zoom, setZoom] = useState(1);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<ArticleItem | null>(
    null,
  );
  const [selectedReport, setSelectedReport] =
    useState<ConsultCommunityReport | null>(null);
  const cyRef = useRef<CyInstance | null>(null);
  const cyContainerRef = useRef<HTMLDivElement>(null);

  const mode =
    config.resource.status === "ready" ? config.resource.data.mode : null;
  const cytoscapeMissing = mode === "query" && getCytoscape() === null;
  const showQueryGraph = mode === "query" && lastContext !== null;
  const graphBuild = useMemo(
    () => (showQueryGraph && lastContext ? buildElements(lastContext) : null),
    [showQueryGraph, lastContext],
  );

  // Cytoscape lives only while this view is visible: a hidden (display:none)
  // container has size 0 and would lay the graph out in a point.
  useEffect(() => {
    if (!active || !graphBuild) return;
    const factory = getCytoscape();
    if (!factory || !cyContainerRef.current) return;
    const cy = factory({
      container: cyContainerRef.current,
      elements: { nodes: graphBuild.nodes, edges: graphBuild.edges },
      style: CY_STYLE,
      layout: {
        name: "fcose",
        randomize: true,
        animate: true,
        fit: true,
        padding: 30,
      },
    });
    cyRef.current = cy;
    cy.on("zoom", () => setZoom(cy.zoom()));
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [active, graphBuild]);

  const toggleSection = (name: string) =>
    setExpanded((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name],
    );

  const handleZoomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setZoom(val);
    cyRef.current?.zoom(val);
    cyRef.current?.center();
  };

  const renderGraph = () => {
    if (config.resource.status === "loading") {
      return <div className="empty-msg large">Đang tải cấu hình...</div>;
    }
    if (config.resource.status === "error") {
      return (
        <div className="empty-msg large">
          <span className="vw-alert" role="alert">
            Không tải được cấu hình đồ thị: {config.resource.message}{" "}
            <button type="button" className="link-btn" onClick={config.reload}>
              Thử lại
            </button>
          </span>
        </div>
      );
    }
    const cfg = config.resource.data;
    if (cfg.mode === "explorer") {
      if (!cfg.graph) {
        return (
          <div className="empty-msg large">
            <span className="vw-alert" role="alert">
              /api/admin/graph/data không trả về dữ liệu đồ thị.
            </span>
          </div>
        );
      }
      return (
        <div
          className="visual-graph-wrapper"
          style={{ height: "100%", width: "100%", position: "relative" }}
        >
          <SigmaGraphVisualization
            data={cfg.graph}
            visibleTypes={EXPLORER_NODE_TYPES}
            visibleEdgeTypes={EXPLORER_EDGE_TYPES}
            setSelectedNode={() => undefined}
          />
        </div>
      );
    }
    if (cytoscapeMissing) {
      return (
        <div className="empty-msg large">
          <span className="vw-alert" role="alert">
            Thư viện Cytoscape (tải từ CDN) chưa sẵn sàng nên không vẽ được đồ
            thị. Kiểm tra kết nối mạng rồi tải lại trang.
          </span>
        </div>
      );
    }
    if (!lastContext) {
      return (
        <div className="empty-msg large">Chưa có ngữ cảnh — hãy hỏi trợ lý</div>
      );
    }
    return (
      <div
        className="visual-graph-wrapper"
        style={{ height: "100%", width: "100%", position: "relative" }}
      >
        {graphBuild && graphBuild.problems.length > 0 && (
          <div
            className="vw-alert"
            role="alert"
            style={{ position: "absolute", zIndex: 2, top: 8, left: 8 }}
          >
            Dữ liệu ngữ cảnh không khớp hợp đồng API, đồ thị có thể thiếu nút
            hoặc cạnh: {graphBuild.problems.join("; ")}
          </div>
        )}
        <div ref={cyContainerRef} style={{ height: "100%", width: "100%" }} />
        <div className={`graph-sidebar-panel ${!panelOpen ? "compact" : ""}`}>
          <div className="panel-section">
            <div
              className="compact-control-header"
              role="button"
              tabIndex={0}
              aria-expanded={panelOpen}
              onClick={() => setPanelOpen(!panelOpen)}
              onKeyDown={onActivate(() => setPanelOpen(!panelOpen))}
            >
              <span className="section-label">Zoom & Controls</span>
              <i className={`fas fa-chevron-${panelOpen ? "down" : "up"}`}></i>
            </div>
            <div className="zoom-control-block">
              <input
                type="range"
                min="0.1"
                max="3"
                step="0.01"
                value={zoom}
                aria-label="Thu phóng đồ thị"
                onChange={handleZoomChange}
                className="modern-slider"
              />
            </div>
            {panelOpen && (
              <div className="expanded-controls animate-fade-quick">
                <div className="zoom-icons">
                  <button
                    type="button"
                    className="vw-btn small"
                    aria-label="Thu nhỏ"
                    onClick={() =>
                      cyRef.current?.zoom((cyRef.current?.zoom() ?? 1) * 0.8)
                    }
                  >
                    −
                  </button>
                  <span className="zoom-pct">{Math.round(zoom * 100)}%</span>
                  <button
                    type="button"
                    className="vw-btn small"
                    aria-label="Phóng to"
                    onClick={() =>
                      cyRef.current?.zoom((cyRef.current?.zoom() ?? 1) * 1.2)
                    }
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  className="modern-action-btn"
                  onClick={() => {
                    cyRef.current?.fit();
                    cyRef.current?.center();
                  }}
                >
                  <i className="fas fa-expand"></i> Reset View
                </button>
                <div className="panel-divider"></div>
                <div className="section-label">Chú giải</div>
                <div className="modern-legend">
                  <div className="m-legend-item">
                    <span className="l-dot q"></span>{" "}
                    <span className="l-txt">Truy vấn</span>
                  </div>
                  <div className="m-legend-item">
                    <span className="l-dot s"></span>{" "}
                    <span className="l-txt">Semantic Search</span>
                  </div>
                  <div className="m-legend-item">
                    <span className="l-dot p"></span>{" "}
                    <span className="l-txt">Path RAG (Bậc 1+)</span>
                  </div>
                  <div className="m-legend-item">
                    <span className="l-dot g"></span>{" "}
                    <span className="l-txt">Graph RAG (Bậc 0)</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const emptyContext = (
    <div className="initial-state">
      Chưa có ngữ cảnh — hãy hỏi trợ lý.{" "}
      <button
        type="button"
        className="link-btn"
        onClick={() => navigate("assistant")}
      >
        Mở Trợ lý
      </button>
    </div>
  );

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

  return (
    <div className="vw-knowledge">
      <div className="top-section">
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
                            {...itemProps(() => setSelectedReport(r), idx)}
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
                            {...itemProps(() => setSelectedArticle(i), idx)}
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
                            {...itemProps(() => setSelectedArticle(i), idx)}
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

        <div className="graph-main-panel glass-card">
          <div className="panel-header">
            <h3>
              <i className="fas fa-network-wired"></i> Trực quan hóa Đồ thị
            </h3>
          </div>
          <div className="graph-content-wrapper">{renderGraph()}</div>
        </div>
      </div>

      {selectedReport && (
        <ReportModal
          report={selectedReport}
          onClose={() => setSelectedReport(null)}
        />
      )}
      {selectedArticle && (
        <ArticleModal
          article={selectedArticle}
          onClose={() => setSelectedArticle(null)}
        />
      )}
    </div>
  );
}
