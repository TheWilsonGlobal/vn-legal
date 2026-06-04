import { useState, useEffect, useRef } from "react";
import { SigmaGraphVisualization } from "./SigmaGraphVisualization";
import type { GraphData } from "./SigmaGraphVisualization";
import "./index.css";

function App() {
  const SUGGESTIONS = [
    "Quyền của người chưa thành niên",
    "Điều kiện kết hợp đồng",
    "Sở hữu tài sản chung",
    "Thừa kế theo pháp luật",
    "Bồi thường thiệt hại",
    "Quyền nhân thân (Điều 25)",
    "Giám hộ (Điều 46)",
    "Năng lực hành vi dân sự",
  ];

  const [query, setQuery] = useState("");
  const [mode] = useState<"local" | "global" | "auto">("auto");
  const [loading, setLoading] = useState(false);
  const [llmLoading, setLlmLoading] = useState(false);
  const [results, setResults] = useState<Record<string, unknown> | null>(null);
  const [expandedSections, setExpandedSections] = useState<string[]>([
    "semantic",
    "graph",
  ]);
  const [zoom, setZoom] = useState(1);
  const [isPanelExpanded, setIsPanelExpanded] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [selectedReport, setSelectedReport] = useState<Record<
    string,
    unknown
  > | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cyRef = useRef<any>(null);
  const cyContainerRef = useRef<HTMLDivElement>(null);

  const [clientGraphMode, setClientGraphMode] = useState<"query" | "explorer">(
    "query",
  );
  const [globalGraphData, setGlobalGraphData] = useState<GraphData | null>(
    null,
  );

  useEffect(() => {
    const initApp = async () => {
      try {
        const configRes = await fetch("/api/config");
        const configData = await configRes.json();
        setClientGraphMode(configData.clientGraphMode || "query");

        if (configData.clientGraphMode === "explorer") {
          const graphRes = await fetch("/api/admin/graph/data");
          const graphData = await graphRes.json();
          setGlobalGraphData(graphData);
        }
      } catch (err) {
        console.error("Failed to init config:", err);
      }
    };
    initApp();
  }, []);

  const handleSearch = async (overrideQuery?: string) => {
    const searchQuery = overrideQuery || query;
    if (!searchQuery.trim()) return;
    setLoading(true);
    setLlmLoading(false);

    if (cyRef.current) {
      cyRef.current.destroy();
      cyRef.current = null;
    }
    setResults(null);

    try {
      // Step 1: Fetch retrieval context first (very fast!)
      const fastRes = await fetch("/api/consult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery, mode, retrievalOnly: true }),
      });
      const fastData = await fastRes.json();
      setResults(fastData);

      // Stop the main loading spinner so the graph & documents list can render immediately
      setLoading(false);

      // Start background LLM loading spinner in the consultation box
      setLlmLoading(true);

      // Step 2: Fetch the full consultation in the background
      const fullRes = await fetch("/api/consult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: searchQuery,
          mode,
          retrievalOnly: false,
        }),
      });
      const fullData = await fullRes.json();

      // Merge results: keep the fast context but update the response text from the LLM
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setResults((prev: any) => ({
        ...prev,
        response: fullData.response,
        answer: fullData.answer,
      }));
    } catch (err) {
      console.error("Error during search:", err);
    } finally {
      setLoading(false);
      setLlmLoading(false);
    }
  };

  const handleSuggestionClick = (text: string) => {
    setQuery(text);
    handleSearch(text);
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) =>
      prev.includes(section)
        ? prev.filter((s) => s !== section)
        : [...prev, section],
    );
  };

  // Cytoscape Lifecycle Management
  useEffect(() => {
    if (!results?.context || !cyContainerRef.current) return;

    if (cyRef.current) {
      setTimeout(() => {
        cyRef.current.resize();
        cyRef.current.fit();
      }, 100);
      return;
    }

    const { seed_articles = [], path_context = [] } = results.context as Record<
      string,
      unknown[]
    >;
    const nodeMap = new Map();

    nodeMap.set("search-query", {
      data: { id: "search-query", label: "Truy vấn", type: "query" },
    });

    const getNodeLabel = (i: Record<string, unknown>) => {
      const matchedId = i.matched_entity_id as string | undefined;
      if (matchedId) {
        const clauseMatch = matchedId.match(/clause_(\d+)/i);
        if (clauseMatch) {
          return `Khoản ${clauseMatch[1]}, Điều ${i.article_number}`;
        }
      }
      return `Điều ${i.article_number}`;
    };

    seed_articles.forEach((item: unknown) => {
      const i = item as Record<string, unknown>;
      const id = (i.id as string) || `node-${i.article_number}`;
      nodeMap.set(id, {
        data: {
          id,
          label: getNodeLabel(i),
          title: i.title,
          type: "seed",
        },
      });
    });

    path_context.forEach((item: unknown) => {
      const i = item as Record<string, unknown>;
      const id = (i.id as string) || `node-${i.article_number}`;
      if (!nodeMap.has(id)) {
        const ragType = (i.depth as number) > 0 ? "path-rag" : "graph-rag";
        nodeMap.set(id, {
          data: {
            id,
            label: getNodeLabel(i),
            title: i.title,
            type: "context",
            ragType: ragType,
          },
        });
      }
    });

    const nodes = Array.from(nodeMap.values());
    const edges: Record<string, unknown>[] = [];
    const allSeeds = [...seed_articles] as Record<string, unknown>[];
    path_context.forEach((item: unknown) => {
      const i = item as Record<string, unknown>;
      if (
        i.depth === 0 &&
        !allSeeds.some((s) => s.article_number === i.article_number)
      ) {
        allSeeds.push(i);
      }
    });

    allSeeds.forEach((item: Record<string, unknown>) => {
      edges.push({
        data: {
          id: `eq-${item.article_number}`,
          source: "search-query",
          target: (item.id as string) || `node-${item.article_number}`,
        },
      });
    });

    path_context.forEach((item: unknown) => {
      const i = item as Record<string, unknown>;
      if ((i.depth as number) > 0) {
        const targetId = (i.id as string) || `node-${i.article_number}`;
        let parentId = allSeeds[0]
          ? (allSeeds[0].id as string) || `node-${allSeeds[0].article_number}`
          : "";

        // Use actual parent from the BFS path if available
        if (Array.isArray(i.path) && i.path.length > 1) {
          parentId = i.path[i.path.length - 2];
        }

        if (parentId) {
          edges.push({
            data: {
              id: `ep-${i.article_number}`,
              source: parentId,
              target: targetId,
            },
          });
        }
      }
    });

    cyRef.current = window.cytoscape({
      container: cyContainerRef.current,
      elements: { nodes, edges },
      style: [
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
          style: {
            "background-color": "#6366f1",
            width: "55px",
            height: "55px",
          },
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
      ],
      layout: {
        name: "fcose",
        randomize: true,
        animate: true,
        fit: true,
        padding: 30,
      },
    });

    (cyRef.current as { on: (event: string, cb: () => void) => void }).on(
      "zoom",
      () => {
        setZoom((cyRef.current as { zoom: () => number }).zoom());
      },
    );

    return () => {
      if (cyRef.current) {
        (cyRef.current as { destroy: () => void }).destroy();
        cyRef.current = null;
      }
    };
  }, [results?.context]);

  const handleZoomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setZoom(val);
    if (cyRef.current) {
      (cyRef.current as { zoom: (v: number) => void; center: () => void }).zoom(
        val,
      );
      (
        cyRef.current as { zoom: (v: number) => void; center: () => void }
      ).center();
    }
  };

  const renderTitle = (item: Record<string, unknown>) => {
    let prefix = `Điều ${item.article_number}`;
    const matchedId = item.matched_entity_id as string | undefined;

    if (matchedId) {
      const clauseMatch = matchedId.match(/clause_(\d+)/i);
      if (clauseMatch) {
        prefix = `Khoản ${clauseMatch[1]}, Điều ${item.article_number}`;
      }
    }

    const title = (item.title as string) || "";
    const baseArticleTitle = `Điều ${item.article_number}`;

    if (title.startsWith(baseArticleTitle)) {
      if (prefix.startsWith("Khoản")) {
        return `${prefix} - ${title
          .substring(baseArticleTitle.length)
          .trim()
          .replace(/^[.-]\s*/, "")}`;
      }
      return title;
    }
    return `${prefix}. ${title}`;
  };

  const getUniqueCount = () => {
    if (!results?.context) return 0;
    const context = results.context as Record<string, unknown[]>;
    const uniqueIds = new Set();
    context.seed_articles?.forEach((item: unknown) =>
      uniqueIds.add((item as Record<string, unknown>).article_number),
    );
    context.path_context?.forEach((item: unknown) =>
      uniqueIds.add((item as Record<string, unknown>).article_number),
    );

    // Add count of community reports
    const reportCount = context.community_reports?.length || 0;
    return uniqueIds.size + reportCount;
  };

  const renderBoldText = (text: string) => {
    const boldParts = text.split(/(\*\*.*?\*\*)/g);
    return boldParts.flatMap((boldPart, i) => {
      if (boldPart.startsWith("**") && boldPart.endsWith("**")) {
        return (
          <strong key={`b-${i}`} style={{ color: "#fff", fontWeight: 800 }}>
            {boldPart.slice(2, -2)}
          </strong>
        );
      }

      const italicParts = boldPart.split(/(_.*?_|\*.*?\*)/g);
      return italicParts.map((italicPart, j) => {
        if (
          (italicPart.startsWith("_") && italicPart.endsWith("_")) ||
          (italicPart.startsWith("*") && italicPart.endsWith("*"))
        ) {
          return (
            <em
              key={`i-${i}-${j}`}
              style={{ fontStyle: "italic", opacity: 0.85 }}
            >
              {italicPart.slice(1, -1)}
            </em>
          );
        }
        return italicPart;
      });
    });
  };

  return (
    <div className="app-container">
      <div className="bg-blur"></div>
      <header>
        <div className="logo">
          <div className="logo-icon-wrapper">
            <div className="logo-glow"></div>
            <img src="/logo.png" alt="VinaLegal Logo" id="main-logo" />
          </div>
          <div className="logo-text">
            <h1>
              VinaLegal <span className="accent">Consultant</span>
            </h1>
            <p className="tagline">
              Hệ thống Tư vấn Pháp luật dựa trên GraphRAG
            </p>
          </div>
        </div>
        <div className="header-status">
          <div className="status-badge">
            <span className="dot pulse"></span>
            <span className="status-text">ConGraphDB Engine v0.1.0</span>
          </div>
        </div>
      </header>

      <main>
        <section className="hero-section">
          <div className="search-box-container">
            <div className="search-bar-inner">
              <i className="fas fa-search search-main-icon"></i>
              <input
                type="text"
                placeholder="Nhập vấn đề pháp lý bạn cần tư vấn..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <button
                className="search-action-btn"
                onClick={() => handleSearch()}
                disabled={loading || llmLoading}
              >
                {loading || llmLoading ? "Đang phân tích..." : "Tư vấn ngay"}
              </button>
            </div>

            <div className="suggestions-bar">
              <span className="suggestion-label">Gợi ý:</span>
              <div className="suggestion-list">
                {SUGGESTIONS.map((text, idx) => (
                  <span
                    key={idx}
                    className="suggestion-chip"
                    onClick={() => handleSuggestionClick(text)}
                  >
                    {text}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="dashboard-grid">
          {/* Top Section: Documentation & Graph */}
          <div className="top-section">
            {/* Panel 1: Results List */}
            <div className="results-list-panel glass-card">
              <div className="sidebar-header">
                <h2>
                  <i className="fas fa-book-open"></i> Tài liệu Pháp lý
                </h2>
                {results && (
                  <span className="source-count">
                    {getUniqueCount()} kết quả
                  </span>
                )}
              </div>

              <div className="accordion-container">
                {(results?.context as Record<string, unknown[]>)
                  ?.community_reports?.length > 0 && (
                  <div className="accordion-item">
                    <div
                      className={`accordion-header global-accent ${expandedSections.includes("global") ? "active" : ""}`}
                      onClick={() => toggleSection("global")}
                    >
                      <h3>
                        <i className="fas fa-globe-asia"></i> Global Synthesis{" "}
                        <span className="source-count small">
                          {
                            (results.context as Record<string, unknown[]>)
                              .community_reports.length
                          }{" "}
                          báo cáo
                        </span>
                      </h3>
                      <i className="fas fa-chevron-down"></i>
                    </div>
                    {expandedSections.includes("global") && (
                      <div className="accordion-content">
                        <div className="scroll-content">
                          <div className="results-grid">
                            {(
                              results.context as Record<string, unknown[]>
                            ).community_reports.map(
                              (report: unknown, idx: number) => {
                                const r = report as Record<string, unknown>;
                                return (
                                  <div
                                    key={idx}
                                    className="context-item global animate-in clickable"
                                    onClick={() => setSelectedReport(r)}
                                  >
                                    <div className="report-item-header">
                                      <h5>{r.title as string}</h5>
                                      <span className="rating-badge">
                                        <i className="fas fa-star"></i>{" "}
                                        {r.rating as number}/10
                                      </span>
                                    </div>
                                    <p className="summary-text-sm">
                                      {(r.summary as string).substring(0, 120)}
                                      ...
                                    </p>
                                  </div>
                                );
                              },
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="accordion-item">
                  <div
                    className={`accordion-header ${expandedSections.includes("semantic") ? "active" : ""}`}
                    onClick={() => toggleSection("semantic")}
                  >
                    <h3>
                      <i className="fas fa-microchip"></i> Semantic Search{" "}
                      <span className="source-count small">
                        {(results?.context as Record<string, unknown[]>)
                          ?.seed_articles.length || 0}{" "}
                        kết quả
                      </span>
                    </h3>
                    <i className="fas fa-chevron-down"></i>
                  </div>
                  {expandedSections.includes("semantic") && (
                    <div className="accordion-content">
                      <div className="scroll-content">
                        {results ? (
                          <div className="results-grid">
                            {(
                              results.context as Record<string, unknown[]>
                            ).seed_articles.map(
                              (item: unknown, idx: number) => {
                                const i = item as Record<string, unknown>;
                                return (
                                  <div
                                    key={idx}
                                    className="context-item animate-in clickable"
                                    style={{ animationDelay: `${idx * 0.1}s` }}
                                    onClick={() => setSelectedArticle(i)}
                                  >
                                    <h5>
                                      <span className="item-title">
                                        {renderTitle(i)}
                                      </span>
                                      <span className="item-head badge">
                                        <span className="relevance">
                                          {Math.round(
                                            ((i.score as number) || 1) * 100,
                                          )}
                                          % Match
                                        </span>
                                      </span>
                                    </h5>
                                  </div>
                                );
                              },
                            )}
                          </div>
                        ) : (
                          <div className="initial-state">
                            <i className="fas fa-search"></i> Nhập câu hỏi để
                            bắt đầu tìm kiếm
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="accordion-item">
                  <div
                    className={`accordion-header ${expandedSections.includes("graph") ? "active" : ""}`}
                    onClick={() => toggleSection("graph")}
                  >
                    <h3>
                      <i className="fas fa-project-diagram"></i> Graph Traversal{" "}
                      <span className="source-count small">
                        {(results?.context as Record<string, unknown[]>)
                          ?.path_context.length || 0}{" "}
                        kết quả
                      </span>
                    </h3>
                    <i className="fas fa-chevron-down"></i>
                  </div>
                  {expandedSections.includes("graph") && (
                    <div className="accordion-content">
                      <div className="scroll-content">
                        {results ? (
                          <div className="results-grid">
                            {(
                              results.context as Record<string, unknown[]>
                            ).path_context.map((item: unknown, idx: number) => {
                              const i = item as Record<string, unknown>;
                              return (
                                <div
                                  key={idx}
                                  className="context-item animate-in clickable"
                                  style={{ animationDelay: `${idx * 0.1}s` }}
                                  onClick={() => setSelectedArticle(i)}
                                >
                                  <h5>
                                    <span className="item-title">
                                      {renderTitle(i)}
                                    </span>
                                    <span className="item-head badge">
                                      <span className="depth">
                                        BẬC {i.depth as number}
                                      </span>
                                    </span>
                                  </h5>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="empty-msg">
                            Vui lòng thực hiện tìm kiếm để xem kết quả duyệt đồ
                            thị.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Panel 2: Graph View */}
            <div className="graph-main-panel glass-card">
              <div className="panel-header">
                <h3>
                  <i className="fas fa-network-wired"></i> Trực quan hóa Đồ thị
                </h3>
              </div>
              <div className="graph-content-wrapper">
                {clientGraphMode === "explorer" ? (
                  <div
                    className="visual-graph-wrapper"
                    style={{
                      height: "100%",
                      width: "100%",
                      position: "relative",
                    }}
                  >
                    {globalGraphData ? (
                      <SigmaGraphVisualization
                        data={globalGraphData}
                        visibleTypes={[
                          "Part",
                          "Chapter",
                          "Section",
                          "Subsection",
                          "Article",
                          "Clause",
                        ]}
                        visibleEdgeTypes={[
                          "HAS_PART",
                          "HAS_CHAPTER",
                          "HAS_SECTION",
                          "HAS_SUBSECTION",
                          "HAS_ARTICLE",
                          "HAS_CLAUSE",
                        ]}
                        setSelectedNode={(node) =>
                          console.log("Selected node in explorer:", node)
                        }
                      />
                    ) : (
                      <div className="empty-msg">Đang tải đồ thị...</div>
                    )}
                  </div>
                ) : results ? (
                  <div
                    className="visual-graph-wrapper"
                    style={{
                      height: "100%",
                      width: "100%",
                      position: "relative",
                    }}
                  >
                    <div
                      ref={cyContainerRef}
                      style={{ height: "100%", width: "100%" }}
                    ></div>

                    <div
                      className={`graph-sidebar-panel ${!isPanelExpanded ? "compact" : ""}`}
                    >
                      <div className="panel-section">
                        <div
                          className="compact-control-header"
                          onClick={() => setIsPanelExpanded(!isPanelExpanded)}
                        >
                          <span className="section-label">Zoom & Controls</span>
                          <i
                            className={`fas fa-chevron-${isPanelExpanded ? "down" : "up"}`}
                          ></i>
                        </div>
                        <div className="zoom-control-block">
                          <input
                            type="range"
                            min="0.1"
                            max="3"
                            step="0.01"
                            value={zoom}
                            onChange={handleZoomChange}
                            className="modern-slider"
                          />
                        </div>

                        {isPanelExpanded && (
                          <div className="expanded-controls animate-fade-quick">
                            <div className="zoom-icons">
                              <i
                                className="fas fa-search-minus"
                                onClick={() =>
                                  (
                                    cyRef.current as {
                                      zoom: (v: number) => void;
                                    }
                                  ).zoom(
                                    (
                                      cyRef.current as { zoom: () => number }
                                    ).zoom() * 0.8,
                                  )
                                }
                              ></i>
                              <span className="zoom-pct">
                                {Math.round(zoom * 100)}%
                              </span>
                              <i
                                className="fas fa-search-plus"
                                onClick={() =>
                                  (
                                    cyRef.current as {
                                      zoom: (v: number) => void;
                                    }
                                  ).zoom(
                                    (
                                      cyRef.current as { zoom: () => number }
                                    ).zoom() * 1.2,
                                  )
                                }
                              ></i>
                            </div>
                            <button
                              className="modern-action-btn"
                              onClick={() => {
                                const cy = cyRef.current as {
                                  fit: () => void;
                                  center: () => void;
                                };
                                cy.fit();
                                cy.center();
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
                ) : (
                  <div className="empty-msg large">
                    Vui lòng thực hiện tìm kiếm để xem trực quan hóa đồ thị.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Bottom Section: AI Consultation */}
          <div className="bottom-section">
            <div className="glass-card consultation-card animate-fade">
              <div className="consultation-header">
                <div className="ai-title">
                  <i className="fas fa-balance-scale"></i>
                  <h3>Tư vấn Pháp luật</h3>
                </div>
                <div className="engine-badge">
                  <span className="badge-glow"></span>
                  AI REASONING
                </div>
              </div>

              <div className="consultation-body">
                {llmLoading ? (
                  <div className="reasoning-loader">
                    <div className="pulse-loader"></div>
                    <p>
                      Đang phân tích các điều luật và xây dựng câu trả lời...
                    </p>
                    <div className="progress-bar-wrap">
                      <div className="progress-bar-fill"></div>
                    </div>
                  </div>
                ) : results ? (
                  <div className="ai-response-text">
                    <div className="markdown-container">
                      {((results.response || results.answer || "") as string)
                        .split("\n")
                        .map((line: string, i: number) => {
                          const trimmedLine = line.trim();

                          // Headers
                          if (trimmedLine.startsWith("# "))
                            return (
                              <h1 key={i}>
                                {renderBoldText(line.substring(2))}
                              </h1>
                            );
                          if (trimmedLine.startsWith("## "))
                            return (
                              <h2 key={i}>
                                {renderBoldText(line.substring(3))}
                              </h2>
                            );
                          if (trimmedLine.startsWith("### "))
                            return (
                              <h3
                                key={i}
                                style={{ color: "#a855f7", marginTop: "16px" }}
                              >
                                {renderBoldText(line.substring(4))}
                              </h3>
                            );

                          // List items (supports dashes, asterisks, or literal bullets)
                          if (
                            trimmedLine.startsWith("- ") ||
                            trimmedLine.startsWith("* ") ||
                            trimmedLine.startsWith("• ")
                          ) {
                            return (
                              <li
                                key={i}
                                style={{
                                  marginLeft: "20px",
                                  marginBottom: "8px",
                                  listStyleType: "disc",
                                }}
                              >
                                {renderBoldText(trimmedLine.substring(2))}
                              </li>
                            );
                          }

                          if (trimmedLine === "")
                            return <div key={i} style={{ height: "12px" }} />;

                          // Regular text with bold support
                          return (
                            <p key={i} style={{ marginBottom: "12px" }}>
                              {renderBoldText(line)}
                            </p>
                          );
                        })}
                    </div>
                  </div>
                ) : (
                  <div className="wait-state">
                    <div className="wait-icon">
                      <i className="fas fa-comment-dots"></i>
                    </div>
                    <p>Hệ thống đang sẵn sàng hỗ trợ bạn.</p>
                  </div>
                )}
              </div>

              <div className="consultation-footer">
                <div className="warning-banner">
                  <i className="fas fa-exclamation-triangle"></i>
                  <span>
                    Nội dung tư vấn chỉ mang tính chất tham khảo dựa trên dữ
                    liệu luật dân sự. Vui lòng tham khảo ý kiến luật sư cho các
                    trường hợp cụ thể.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="main-footer">
        <p>
          © 2026 VinaLegal Consultant. Powered by GraphRAG & PathRAG
          Technologies.
        </p>
      </footer>

      {/* Report Detail Modal */}
      {selectedReport && (
        <div className="modal-overlay" onClick={() => setSelectedReport(null)}>
          <div
            className="modal-content glass-card global-modal animate-zoom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="item-head badge global-badge">
                  <i className="fas fa-globe-asia"></i> GLOBAL REPORT
                </span>
                <h2>{selectedReport.title as string}</h2>
              </div>
              <button
                className="btn-close-lg"
                onClick={() => setSelectedReport(null)}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="modal-body scrollable-modal-body">
              <div className="report-summary-box">
                <h3>
                  <i className="fas fa-align-left"></i> Tóm tắt vĩ mô
                </h3>
                <p>{selectedReport.summary as string}</p>
              </div>

              {selectedReport.findings &&
                (selectedReport.findings as unknown[]).length > 0 && (
                  <div className="report-section">
                    <h3>
                      <i className="fas fa-search"></i> Các phát hiện chính
                    </h3>
                    <div className="findings-grid-client">
                      {(selectedReport.findings as unknown[]).map(
                        (finding: unknown, i: number) => (
                          <div key={i} className="finding-card-client">
                            <span className="finding-num">{i + 1}</span>
                            <p>
                              {typeof finding === "string"
                                ? finding
                                : (finding as { explanation: string })
                                    .explanation}
                            </p>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}

              <div className="modal-metadata-grid">
                <div className="meta-box">
                  <label>Độ tin cậy (Rating)</label>
                  <div className="meta-value highlight-gold">
                    <i className="fas fa-star"></i>{" "}
                    {selectedReport.rating as number}/10
                  </div>
                </div>
                <div className="meta-box">
                  <label>Cấp độ phân tích</label>
                  <div className="meta-value">
                    {selectedReport.level === 0
                      ? "Phần (Part Level)"
                      : "Chương (Chapter Level)"}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="modern-action-btn primary"
                onClick={() => setSelectedReport(null)}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Article Preview Modal */}
      {selectedArticle && (
        <div className="modal-overlay" onClick={() => setSelectedArticle(null)}>
          <div
            className="modal-content glass-card animate-zoom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="item-head badge">
                  <span className="depth">
                    ĐIỀU {selectedArticle.article_number as number}
                  </span>
                </span>
                <h2>{selectedArticle.title as string}</h2>
              </div>
              <button
                className="btn-close-lg"
                onClick={() => setSelectedArticle(null)}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="modal-body">
              <div className="article-full-content">
                {(selectedArticle.content as string) ||
                  "Không có nội dung cho điều luật này."}
              </div>

              {selectedArticle.clauses &&
                (selectedArticle.clauses as Record<string, unknown>[]).length >
                  0 && (
                  <div
                    className="article-clauses"
                    style={{ marginTop: "16px" }}
                  >
                    <h4 style={{ color: "#a855f7", marginBottom: "8px" }}>
                      Các Khoản:
                    </h4>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      {(
                        selectedArticle.clauses as Record<string, unknown>[]
                      ).map((clause, idx) => (
                        <div
                          key={idx}
                          className="clause-item"
                          style={{
                            padding: "8px",
                            background: "rgba(255, 255, 255, 0.05)",
                            borderRadius: "4px",
                          }}
                        >
                          <span
                            style={{ fontWeight: "bold", color: "#14b8a6" }}
                          >
                            Khoản {clause.clause_number as number}:
                          </span>{" "}
                          {clause.text as string}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              <div className="modal-metadata-grid">
                <div className="meta-box">
                  <label>Phần (Part)</label>
                  <div className="meta-value">
                    {(selectedArticle.metadata as { part?: string })?.part ||
                      (selectedArticle.part as string) ||
                      "N/A"}
                  </div>
                </div>
                <div className="meta-box">
                  <label>Chương (Chapter)</label>
                  <div className="meta-value">
                    {(selectedArticle.metadata as { chapter?: string })
                      ?.chapter ||
                      (selectedArticle.chapter as string) ||
                      "N/A"}
                  </div>
                </div>
                {selectedArticle.score !== undefined && (
                  <div className="meta-box">
                    <label>Độ tương đồng</label>
                    <div className="score-value highlight">
                      {Math.round((selectedArticle.score as number) * 100)}%
                      Match
                    </div>
                  </div>
                )}
                {selectedArticle.depth !== undefined && (
                  <div className="meta-box">
                    <label>Khoảng cách đồ thị</label>
                    <div>Bậc {selectedArticle.depth as number}</div>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="modern-action-btn primary"
                onClick={() => setSelectedArticle(null)}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
