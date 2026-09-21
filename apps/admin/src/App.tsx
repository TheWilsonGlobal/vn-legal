import { useState, useEffect, useRef, useMemo } from "react";
import Sigma from "sigma";
import { MultiGraph } from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";
import "./index.css";

declare global {
  interface Window {
    cytoscape: (options: unknown) => CytoscapeInstance;
  }
}

interface CytoscapeInstance {
  destroy: () => void;
  on: (event: string, selectorOrHandler: unknown, handler?: unknown) => void;
  zoom: (
    level?:
      | number
      | { level: number; renderedPosition: { x: number; y: number } },
  ) => number;
  width: () => number;
  height: () => number;
  fit: () => void;
  center: () => void;
  resize: () => void;
  layout: (options: unknown) => { run: () => void };
}

interface GraphNode {
  id: string;
  label: string;
  type: string;
  [key: string]: unknown;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface CyNode {
  degree: () => number;
  data: (key: string) => unknown;
}

interface GraphVisualizationProps {
  data: GraphData | null;
  layout: string;
  visibleTypes: string[];
  setSelectedNode: (node: GraphNode | null) => void;
  setZoomLevel: (level: number) => void;
  onRenderingChange: (loading: boolean) => void;
  onInit: (cy: CytoscapeInstance) => void;
}

interface AdminStats {
  graph: {
    total_nodes: number;
    total_edges: number;
    [key: string]: number;
  };
  vector: {
    total_chunks: number;
    [key: string]: number;
  };
}

interface Activity {
  id: string;
  type: string;
  message: string;
  timestamp: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details?: any;
}

interface Community {
  id: string;
  community_id: string;
  level: number;
  title: string;
  summary: string;
  findings: (string | { explanation: string; articles?: string[] })[];
  rating: number;
  parent_id?: string;
  article_count?: number;
  principles?: string;
}

interface VectorStoreStatus {
  status: string;
  count: number;
  [key: string]: unknown;
}

interface VectorResult {
  id: string;
  score: number;
  content: string;
  metadata?: Record<string, unknown>;
  _distance: number;
  article_id: string;
  type: string;
  article_title?: string;
  clause_number?: number;
  title?: string;
  article_number?: number;
  part?: string;
  chapter?: string;
  keywords?: string;
}

interface AppConfig {
  vectorStoreType: string;
  embeddingBackend: string;
  embeddingDimension: number;
  embeddingModel: string;
  llmModel: string;
  [key: string]: unknown;
}

function GraphVisualization({
  data,
  layout,
  visibleTypes,
  setSelectedNode,
  setZoomLevel,
  onRenderingChange,
  onInit,
}: GraphVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<CytoscapeInstance | null>(null);

  useEffect(() => {
    if (!containerRef.current || !data || !window.cytoscape) return;

    onRenderingChange?.(true);

    const filteredNodes = data.nodes.filter((n: GraphNode) =>
      visibleTypes.includes(n.type),
    );
    const nodeIds = new Set(filteredNodes.map((n: GraphNode) => n.id));
    const filteredEdges = data.edges.filter(
      (e: GraphEdge) => nodeIds.has(e.source) && nodeIds.has(e.target),
    );

    const elements = {
      nodes: filteredNodes.map((n: GraphNode) => ({
        data: { id: n.id, label: n.label, type: n.type },
      })),
      edges: filteredEdges.map((e: GraphEdge) => ({
        data: { id: e.id, source: e.source, target: e.target, type: e.type },
      })),
    };

    const getLayoutConfig = () => {
      switch (layout) {
        case "cose":
          return {
            name: "cose",
            animate: true,
            nodeRepulsion: 10000,
            idealEdgeLength: 100,
            gravity: 1,
          };
        case "fcose":
          return {
            name: "fcose",
            animate: true,
            nodeRepulsion: 5000,
            idealEdgeLength: 80,
            gravity: 0.25,
            quality: "proof",
          };
        case "dagre":
          return {
            name: "dagre",
            rankDir: "TB",
            nodeSep: 50,
            rankSep: 100,
            animate: true,
          };
        case "concentric":
          return {
            name: "concentric",
            concentric: (n: CyNode) => n.degree(),
            levelWidth: () => 2,
            animate: true,
          };
        default:
          return { name: "grid", animate: true };
      }
    };

    if (cyRef.current) {
      cyRef.current.destroy();
    }

    try {
      cyRef.current = window.cytoscape({
        container: containerRef.current,
        elements: elements,
        style: [
          {
            selector: "node",
            style: {
              "background-color": (n: CyNode) => {
                const t = n.data("type");
                if (t === "Part") return "#8b5cf6";
                if (t === "Chapter") return "#3b82f6";
                if (t === "Section") return "#10b981";
                if (t === "Subsection") return "#f59e0b";
                if (t === "Article") return "#ec4899";
                return "#64748b";
              },
              label: "data(label)",
              color: "#f1f5f9",
              "font-size": "10px",
              "text-valign": "center",
              "text-halign": "center",
              width: (n: CyNode) => (n.data("type") === "Part" ? 40 : 25),
              height: (n: CyNode) => (n.data("type") === "Part" ? 40 : 25),
              "text-wrap": "wrap",
              "text-max-width": "80px",
              "z-index": 10,
            },
          },
          {
            selector: "edge",
            style: {
              width: 1,
              "line-color": "rgba(255,255,255,0.1)",
              "target-arrow-shape": "triangle",
              "curve-style": "bezier",
              opacity: 0.4,
            },
          },
          {
            selector: "node:selected",
            style: {
              "border-width": "3px",
              "border-color": "#fff",
              "border-opacity": 0.5,
            },
          },
        ],
      });

      if (cyRef.current) {
        cyRef.current.on(
          "tap",
          "node",
          (evt: { target: { data: () => GraphNode } }) =>
            setSelectedNode(evt.target.data()),
        );
        cyRef.current.on("zoom", () =>
          setZoomLevel((cyRef.current as CytoscapeInstance).zoom() as number),
        );
        onInit?.(cyRef.current);
      }
    } catch (err) {
      console.error("Cytoscape init failed", err);
    } finally {
      onRenderingChange?.(false);
    }

    let layoutHasRun = false;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && cyRef.current) {
          cyRef.current.resize();
          if (!layoutHasRun) {
            const layoutInstance = cyRef.current.layout(getLayoutConfig());
            layoutInstance.run();
            layoutHasRun = true;
          } else {
            cyRef.current.fit();
          }
        }
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      if (cyRef.current) cyRef.current.destroy();
    };
  }, [
    data,
    layout,
    visibleTypes,
    onInit,
    onRenderingChange,
    setSelectedNode,
    setZoomLevel,
  ]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        background: "rgba(0,0,0,0.2)",
        position: "relative",
      }}
    />
  );
}

interface SigmaGraphVisualizationProps {
  data: GraphData | null;
  visibleTypes: string[];
  visibleEdgeTypes: string[];
  setSelectedNode: (node: GraphNode | null) => void;
}

function SigmaGraphVisualization({
  data,
  visibleTypes,
  visibleEdgeTypes,
  setSelectedNode,
}: SigmaGraphVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);

  useEffect(() => {
    if (!containerRef.current || !data) return;

    // 1. Filter nodes and edges by visibleTypes
    const filteredNodes = data.nodes.filter((n) =>
      visibleTypes.includes(n.type),
    );
    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = data.edges.filter(
      (e) =>
        nodeIds.has(e.source) &&
        nodeIds.has(e.target) &&
        visibleEdgeTypes.includes(e.type),
    );

    // 2. Build graphology MultiGraph
    const graph = new MultiGraph();

    // Degree map
    const degreeMap: Record<string, number> = {};
    filteredEdges.forEach((e) => {
      degreeMap[e.source] = (degreeMap[e.source] || 0) + 1;
      degreeMap[e.target] = (degreeMap[e.target] || 0) + 1;
    });

    // Parent to children mapping for hierarchy layout
    const parentToChildren = new Map<string, string[]>();
    const childToParent = new Map<string, string>();
    const hierarchyTypes = new Set([
      "HAS_SECTION",
      "HAS_CHAPTER",
      "HAS_SUBSECTION",
      "HAS_CLAUSE",
      "HAS_POINT",
      "HAS_PART",
    ]);

    filteredEdges.forEach((e) => {
      if (hierarchyTypes.has(e.type)) {
        if (!parentToChildren.has(e.source)) parentToChildren.set(e.source, []);
        parentToChildren.get(e.source)!.push(e.target);
        childToParent.set(e.target, e.source);
      }
    });

    const structuralLabels = new Set(["Part", "Chapter", "Section", "Book"]);
    const structuralNodes = filteredNodes.filter(
      (n) => structuralLabels.has(n.type) || !childToParent.has(n.id),
    );

    const nodePositions = new Map<string, { x: number; y: number }>();
    const structuralSpread = Math.sqrt(filteredNodes.length) * 40;
    const childJitter = Math.sqrt(filteredNodes.length) * 5;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    structuralNodes.forEach((node, idx) => {
      const angle = idx * goldenAngle;
      const radius =
        structuralSpread *
        Math.sqrt((idx + 1) / Math.max(structuralNodes.length, 1));
      nodePositions.set(node.id, {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      });
    });

    const queue = [...structuralNodes.map((n) => n.id)];
    const visited = new Set<string>(queue);
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const pos = nodePositions.get(currentId)!;
      const children = parentToChildren.get(currentId) || [];
      children.forEach((childId, i) => {
        if (!visited.has(childId)) {
          visited.add(childId);
          const childAngle = (i / children.length) * Math.PI * 2;
          nodePositions.set(childId, {
            x: pos.x + Math.cos(childAngle) * childJitter,
            y: pos.y + Math.sin(childAngle) * childJitter,
          });
          queue.push(childId);
        }
      });
    }

    // Node colors consistent with VinaLegal palette
    const typeColors: Record<string, string> = {
      Part: "#8b5cf6", // Purple
      Chapter: "#3b82f6", // Blue
      Section: "#10b981", // Green
      Subsection: "#f59e0b", // Orange
      Article: "#ec4899", // Pink
      Clause: "#06b6d4", // Cyan
      ClausePoint: "#84cc16", // Lime
    };

    filteredNodes.forEach((n) => {
      const pos = nodePositions.get(n.id) || {
        x: (Math.random() - 0.5) * 500,
        y: (Math.random() - 0.5) * 500,
      };
      graph.addNode(n.id, {
        label: n.label,
        x: pos.x,
        y: pos.y,
        size: Math.sqrt(degreeMap[n.id] || 1) * 3 + 4,
        color: typeColors[n.type] || "#64748b",
        nodeType: n.type,
      });
    });

    filteredEdges.forEach((e) => {
      graph.addEdge(e.source, e.target, {
        type: "line",
        label: e.type,
        size: 1,
        color: "rgba(255,255,255,0.1)",
      });
    });

    // Run force atlas layout synchronously for quick pre-stabilization
    if (graph.order > 0) {
      const isSmall = graph.order < 500;
      const customSettings = {
        gravity: isSmall ? 0.8 : 0.2,
        scalingRatio: isSmall ? 10 : 30,
        slowDown: 1,
        adjustSizes: true,
        edgeWeightInfluence: 1,
      };

      forceAtlas2.assign(graph, {
        iterations: 120,
        settings: { ...forceAtlas2.inferSettings(graph), ...customSettings },
      });

      noverlap.assign(graph, {
        maxIterations: 50,
        settings: {
          ratio: 1.2,
          margin: 5,
        },
      });
    }

    // 3. Initialize Sigma
    const sigma = new Sigma(graph, containerRef.current, {
      allowInvalidContainer: true,
      defaultEdgeType: "line",
      labelColor: { color: "#94a3b8" },
      labelSize: 11,
      labelFont: "Inter, sans-serif",
      hideEdgesOnMove: true,
      hideLabelsOnMove: true,
      labelDensity: 0.08,
      defaultNodeColor: "#64748b",
      defaultEdgeColor: "rgba(255, 255, 255, 0.05)",
      zIndex: true,
    });

    sigmaRef.current = sigma;

    // Attach click events
    sigma.on("clickNode", ({ node }) => {
      const n = filteredNodes.find((fn) => fn.id === node);
      if (n) setSelectedNode(n);
    });

    sigma.on("enterNode", () => {
      if (containerRef.current) containerRef.current.style.cursor = "pointer";
    });

    sigma.on("leaveNode", () => {
      if (containerRef.current) containerRef.current.style.cursor = "grab";
    });

    return () => {
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [data, visibleTypes, visibleEdgeTypes, setSelectedNode]);

  const handleZoomIn = () => {
    sigmaRef.current?.getCamera().animatedZoom({ duration: 300 });
  };

  const handleZoomOut = () => {
    sigmaRef.current?.getCamera().animatedUnzoom({ duration: 300 });
  };

  const handleReset = () => {
    sigmaRef.current?.getCamera().animatedReset({ duration: 300 });
  };

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          background: "rgba(0,0,0,0.2)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "20px",
          right: "20px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          zIndex: 10,
        }}
      >
        <button
          className="btn-primary"
          style={{
            width: "36px",
            height: "36px",
            padding: 0,
            justifyContent: "center",
          }}
          onClick={handleZoomIn}
          title="Zoom In"
        >
          <i className="fas fa-search-plus"></i>
        </button>
        <button
          className="btn-primary"
          style={{
            width: "36px",
            height: "36px",
            padding: 0,
            justifyContent: "center",
          }}
          onClick={handleZoomOut}
          title="Zoom Out"
        >
          <i className="fas fa-search-minus"></i>
        </button>
        <button
          className="btn-primary"
          style={{
            width: "36px",
            height: "36px",
            padding: 0,
            justifyContent: "center",
          }}
          onClick={handleReset}
          title="Reset Camera"
        >
          <i className="fas fa-expand"></i>
        </button>
      </div>
    </div>
  );
}

function App() {
  const [activeView, setActiveView] = useState("overview");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [graphRendering, setGraphRendering] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [graphLayout, setGraphLayout] = useState("fcose");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [visibleTypes, setVisibleTypes] = useState<string[]>([
    "Part",
    "Chapter",
    "Section",
    "Subsection",
    "Article",
    "Clause",
    "ClausePoint",
  ]);
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<string[]>([
    "HAS_CHAPTER",
    "HAS_SECTION",
    "HAS_SUBSECTION",
    "BELONGS_TO_SUBSECTION",
    "BELONGS_TO_SECTION",
    "BELONGS_TO_CHAPTER",
    "HAS_CLAUSE",
    "HAS_POINT",
  ]);

  const toggleEdgeTypeVisibility = (type: string) => {
    setVisibleEdgeTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };
  const [vectorResults, setVectorResults] = useState<VectorResult[]>([]);
  const [vectorLoading, setVectorLoading] = useState(false);
  const [vectorQuery, setVectorQuery] = useState("");
  const [previewArticle, setPreviewArticle] = useState<VectorResult | null>(
    null,
  );
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({});
  const [activities, setActivities] = useState<Activity[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [communitiesLoading, setCommunitiesLoading] = useState(false);
  const [selectedCommunity, setSelectedCommunity] = useState<Community | null>(
    null,
  );
  const [vectorStoreStatus, setVectorStoreStatus] =
    useState<VectorStoreStatus | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [showConfigSavedModal, setShowConfigSavedModal] = useState(false);
  const [tempVectorStoreType, setTempVectorStoreType] =
    useState<string>("congraph");
  const [tempClientGraphMode, setTempClientGraphMode] =
    useState<string>("query");
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [showAddCommunityModal, setShowAddCommunityModal] = useState(false);
  const [newCommunity, setNewCommunity] = useState<Community>({
    id: "",
    community_id: "",
    level: 1,
    title: "",
    summary: "",
    findings: [""],
    rating: 10,
    parent_id: "",
    article_count: 0,
    principles: "",
  });
  const cyRef = useRef<CytoscapeInstance | null>(null);

  // LLM Monitor Tab states
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [llmStatus, setLlmStatus] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [llmLog, setLlmLog] = useState<any>(null);
  const [diagPrompt, setDiagPrompt] = useState(
    "Kiểm tra kết nối LLM. Trả lời ngắn gọn: 'Kết nối OK'.",
  );
  const [diagResponse, setDiagResponse] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagDuration, setDiagDuration] = useState<number | null>(null);
  const [diagError, setDiagError] = useState<string | null>(null);

  // Endpoint editor states
  const [endpointDraft, setEndpointDraft] = useState("");
  const [endpointEditing, setEndpointEditing] = useState(false);
  const [endpointSaving, setEndpointSaving] = useState(false);
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [endpointNotice, setEndpointNotice] = useState<string | null>(null);

  const fetchLlmDetails = async () => {
    try {
      const statusRes = await fetch("/api/admin/llm/status");
      const statusData = await statusRes.json();
      setLlmStatus(statusData);

      const logRes = await fetch("/api/admin/llm/last-prompt");
      const logData = await logRes.json();
      setLlmLog(logData);
    } catch (err) {
      console.error("Failed to fetch LLM details:", err);
    }
  };

  const handleSaveEndpoint = async () => {
    setEndpointSaving(true);
    setEndpointError(null);
    setEndpointNotice(null);
    try {
      const res = await fetch("/api/admin/llm/endpoint", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiUrl: endpointDraft }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setEndpointError(data.error || "Không cập nhật được endpoint.");
        return;
      }
      setEndpointNotice(data.message);
      setEndpointEditing(false);
      await fetchLlmDetails();
    } catch (err) {
      setEndpointError((err as Error).message || String(err));
    } finally {
      setEndpointSaving(false);
    }
  };

  useEffect(() => {
    if (activeView === "llm") {
      fetchLlmDetails();
      // Pause polling while the endpoint is being edited so a refresh can't
      // clobber what is being typed.
      if (endpointEditing) return;
      const interval = setInterval(fetchLlmDetails, 5000);
      return () => clearInterval(interval);
    }
  }, [activeView, endpointEditing]);

  const handleRunDiagnostic = async () => {
    setDiagLoading(true);
    setDiagResponse(null);
    setDiagDuration(null);
    setDiagError(null);
    try {
      const res = await fetch("/api/admin/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: diagPrompt }),
      });
      const data = await res.json();
      if (data.success) {
        setDiagResponse(data.response);
        setDiagDuration(data.duration_ms);
        fetchLlmDetails(); // Refresh logs
      } else {
        setDiagError(data.error || "Lỗi không xác định");
      }
    } catch (err) {
      setDiagError((err as Error).message || String(err));
    } finally {
      setDiagLoading(false);
    }
  };

  const renderLlmMonitorView = () => {
    return (
      <div className="view-section" key="llm">
        <div className="view-header">
          <h2>Giám sát mô hình ngôn ngữ lớn (LLM Monitor)</h2>
          <button className="btn-primary" onClick={fetchLlmDetails}>
            <i className="fas fa-sync-alt"></i> Tải lại
          </button>
        </div>

        <div
          className="stats-grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "20px",
            marginTop: "20px",
          }}
        >
          <div className="stat-card animate-in">
            <div className="stat-icon purple">
              <i className="fas fa-robot"></i>
            </div>
            <div className="stat-info">
              <h3>Provider</h3>
              <div className="value" style={{ fontSize: "1.5rem" }}>
                {llmStatus?.provider?.toUpperCase() || "Tải..."}
              </div>
            </div>
          </div>
          <div
            className="stat-card animate-in"
            style={{ animationDelay: "0.1s" }}
          >
            <div className="stat-icon blue">
              <i className="fas fa-brain"></i>
            </div>
            <div className="stat-info">
              <h3>Model</h3>
              <div
                className="value"
                style={{
                  fontSize: "1.1rem",
                  textOverflow: "ellipsis",
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                }}
              >
                {llmStatus?.model || "Tải..."}
              </div>
            </div>
          </div>
          <div
            className="stat-card animate-in"
            style={{ animationDelay: "0.2s" }}
          >
            <div className="stat-icon green">
              <i
                className={`fas ${llmStatus?.status === "connected" ? "fa-circle-check" : "fa-circle-xmark"}`}
              ></i>
            </div>
            <div className="stat-info">
              <h3>Trạng thái Kết nối</h3>
              <div className="value">
                <span
                  className={`status-badge ${llmStatus?.status === "connected" ? "active" : "inactive"}`}
                  style={{ fontSize: "1.1rem", padding: "4px 12px" }}
                >
                  {llmStatus?.status === "connected"
                    ? "Sẵn sàng"
                    : "Mất kết nối"}
                </span>
              </div>
            </div>
          </div>
          <div
            className="stat-card animate-in"
            style={{ animationDelay: "0.3s" }}
          >
            <div className="stat-icon orange">
              <i className="fas fa-network-wired"></i>
            </div>
            <div className="stat-info" style={{ minWidth: 0, flex: 1 }}>
              <h3>
                Endpoint
                {llmStatus?.editableEndpoint && !endpointEditing && (
                  <button
                    onClick={() => {
                      setEndpointDraft(llmStatus?.apiUrl || "");
                      setEndpointError(null);
                      setEndpointNotice(null);
                      setEndpointEditing(true);
                    }}
                    title="Sửa endpoint"
                    style={{
                      marginLeft: "8px",
                      background: "none",
                      border: "none",
                      color: "#8b5cf6",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: "0.85rem",
                    }}
                  >
                    <i className="fas fa-pen-to-square"></i> Sửa
                  </button>
                )}
              </h3>

              {endpointEditing ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    marginTop: "4px",
                  }}
                >
                  <input
                    type="text"
                    value={endpointDraft}
                    autoFocus
                    spellCheck={false}
                    placeholder="http://localhost:5814"
                    onChange={(e) => setEndpointDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEndpoint();
                      if (e.key === "Escape") setEndpointEditing(false);
                    }}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      border: "1px solid #3f3f52",
                      background: "#16161f",
                      color: "#e5e7eb",
                      fontSize: "0.85rem",
                      fontFamily: "monospace",
                    }}
                  />
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      className="btn-primary"
                      disabled={endpointSaving}
                      onClick={handleSaveEndpoint}
                      style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                    >
                      {endpointSaving ? "Đang lưu..." : "Lưu"}
                    </button>
                    <button
                      onClick={() => {
                        setEndpointEditing(false);
                        setEndpointError(null);
                      }}
                      style={{
                        padding: "4px 10px",
                        fontSize: "0.8rem",
                        borderRadius: "6px",
                        border: "1px solid #3f3f52",
                        background: "transparent",
                        color: "#9ca3af",
                        cursor: "pointer",
                      }}
                    >
                      Hủy
                    </button>
                    {llmStatus?.defaultApiUrl &&
                      endpointDraft !== llmStatus.defaultApiUrl && (
                        <button
                          title={`Mặc định: ${llmStatus.defaultApiUrl}`}
                          onClick={() =>
                            setEndpointDraft(llmStatus.defaultApiUrl)
                          }
                          style={{
                            padding: "4px 10px",
                            fontSize: "0.8rem",
                            borderRadius: "6px",
                            border: "1px solid #3f3f52",
                            background: "transparent",
                            color: "#9ca3af",
                            cursor: "pointer",
                          }}
                        >
                          Mặc định
                        </button>
                      )}
                  </div>
                </div>
              ) : (
                <div
                  className="value"
                  style={{ fontSize: "0.9rem", wordBreak: "break-all" }}
                >
                  {llmStatus?.apiUrl || "N/A"}
                </div>
              )}

              {endpointError && (
                <div
                  style={{
                    color: "#f87171",
                    fontSize: "0.78rem",
                    marginTop: "6px",
                  }}
                >
                  {endpointError}
                </div>
              )}
              {endpointNotice && !endpointEditing && (
                <div
                  style={{
                    color:
                      llmStatus?.status === "connected" ? "#34d399" : "#fbbf24",
                    fontSize: "0.78rem",
                    marginTop: "6px",
                  }}
                >
                  {endpointNotice}
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          className="grid-2-1"
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr",
            gap: "24px",
            marginTop: "24px",
          }}
        >
          {/* Prompt Logs Panel */}
          <div className="card animate-in">
            <div className="card-header">
              <h2>Lần truy vấn LLM gần nhất</h2>
              {llmLog?.timestamp && (
                <span className="badge-dim" style={{ fontSize: "0.8rem" }}>
                  {new Date(llmLog.timestamp).toLocaleString()}
                </span>
              )}
            </div>
            <div
              className="card-body"
              style={{ display: "flex", flexDirection: "column", gap: "16px" }}
            >
              <div>
                <h4
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    color: "#8b5cf6",
                    marginBottom: "8px",
                  }}
                >
                  <i className="fas fa-terminal"></i> System Prompt (Chỉ dẫn hệ
                  thống)
                </h4>
                <div
                  style={{
                    background: "rgba(0,0,0,0.3)",
                    padding: "12px",
                    borderRadius: "6px",
                    fontSize: "0.9rem",
                    border: "1px solid rgba(255,255,255,0.05)",
                    maxHeight: "150px",
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {llmLog?.systemPrompt || "Chưa có log hệ thống."}
                </div>
              </div>

              <div>
                <h4
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    color: "#3b82f6",
                    marginBottom: "8px",
                  }}
                >
                  <i className="fas fa-user"></i> User Prompt & retrieved
                  Context (Câu hỏi & ngữ cảnh)
                </h4>
                <div
                  style={{
                    background: "rgba(0,0,0,0.3)",
                    padding: "12px",
                    borderRadius: "6px",
                    fontSize: "0.9rem",
                    border: "1px solid rgba(255,255,255,0.05)",
                    maxHeight: "250px",
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {llmLog?.userPrompt || "Chưa có log truy vấn người dùng."}
                </div>
              </div>

              <div>
                <h4
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    color: "#10b981",
                    marginBottom: "8px",
                  }}
                >
                  <i className="fas fa-comment-dots"></i> LLM Response (Kết quả
                  trả về)
                </h4>
                <div
                  style={{
                    background: "rgba(0,0,0,0.3)",
                    padding: "12px",
                    borderRadius: "6px",
                    fontSize: "0.9rem",
                    border: "1px solid rgba(255,255,255,0.05)",
                    maxHeight: "250px",
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                    color: "#f1f5f9",
                  }}
                >
                  {llmLog?.response || "Chưa có kết quả phản hồi."}
                </div>
              </div>
            </div>
          </div>

          {/* Diagnostic Console Panel */}
          <div className="card animate-in" style={{ animationDelay: "0.1s" }}>
            <div className="card-header">
              <h2>Diagnostic Console (Chẩn đoán)</h2>
            </div>
            <div
              className="card-body"
              style={{ display: "flex", flexDirection: "column", gap: "16px" }}
            >
              <div className="form-group">
                <label
                  style={{
                    display: "block",
                    marginBottom: "8px",
                    fontSize: "0.9rem",
                  }}
                >
                  Diagnostic Test Prompt
                </label>
                <textarea
                  className="modern-input"
                  style={{
                    width: "100%",
                    height: "80px",
                    padding: "10px",
                    borderRadius: "6px",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "#fff",
                    resize: "none",
                  }}
                  value={diagPrompt}
                  onChange={(e) => setDiagPrompt(e.target.value)}
                />
              </div>

              <button
                className="btn-primary"
                style={{
                  width: "100%",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: "8px",
                }}
                onClick={handleRunDiagnostic}
                disabled={diagLoading}
              >
                {diagLoading ? (
                  <>
                    <i className="fas fa-spinner fa-spin"></i> Đang chạy...
                  </>
                ) : (
                  <>
                    <i className="fas fa-vial"></i> Gửi truy vấn test
                  </>
                )}
              </button>

              <div
                className="panel-divider"
                style={{
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  margin: "8px 0",
                }}
              ></div>

              <div>
                <h4
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "0.95rem",
                    color: "#f59e0b",
                    marginBottom: "8px",
                  }}
                >
                  <i className="fas fa-vials"></i> Kết quả chẩn đoán
                </h4>
                {diagLoading && (
                  <div
                    style={{
                      color: "rgba(255,255,255,0.5)",
                      fontSize: "0.9rem",
                    }}
                  >
                    Đang chờ kết quả từ LLM...
                  </div>
                )}

                {diagResponse && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <div
                      style={{
                        background: "rgba(20,184,166,0.1)",
                        border: "1px solid rgba(20,184,166,0.3)",
                        padding: "10px",
                        borderRadius: "6px",
                        color: "#14b8a6",
                        fontSize: "0.85rem",
                      }}
                    >
                      <i className="fas fa-check-circle"></i> Kết nối thành
                      công! Thời gian xử lý: <strong>{diagDuration}ms</strong>
                    </div>
                    <div
                      style={{
                        background: "rgba(0,0,0,0.3)",
                        padding: "10px",
                        borderRadius: "6px",
                        fontSize: "0.85rem",
                        border: "1px solid rgba(255,255,255,0.05)",
                        maxHeight: "150px",
                        overflowY: "auto",
                      }}
                    >
                      {diagResponse}
                    </div>
                  </div>
                )}

                {diagError && (
                  <div
                    style={{
                      background: "rgba(239,68,68,0.1)",
                      border: "1px solid rgba(239,68,68,0.3)",
                      padding: "10px",
                      borderRadius: "6px",
                      color: "#ef4444",
                      fontSize: "0.85rem",
                    }}
                  >
                    <i className="fas fa-exclamation-circle"></i> Kết nối thất
                    bại: <br />
                    <code
                      style={{ fontSize: "0.8rem", wordBreak: "break-all" }}
                    >
                      {diagError}
                    </code>
                  </div>
                )}

                {!diagLoading && !diagResponse && !diagError && (
                  <div
                    style={{
                      color: "rgba(255,255,255,0.3)",
                      fontSize: "0.85rem",
                      textAlign: "center",
                      padding: "20px 0",
                    }}
                  >
                    Chưa chạy chẩn đoán kết nối.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const [activeTab, setActiveTab] = useState("general");
  const [knowledgeTab, setKnowledgeTab] = useState("generals");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [chunks, setChunks] = useState<any[]>([]);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [chunksPage, setChunksPage] = useState(1);
  const [chunksTotalPages, setChunksTotalPages] = useState(1);
  const [chunksTotalItems, setChunksTotalItems] = useState(0);
  const [chunksSearch, setChunksSearch] = useState("");
  const [tempChunksSearch, setTempChunksSearch] = useState("");
  const [chunksType, setChunksType] = useState("all");

  // Relations tab interfaces
  interface Relation {
    id: string;
    sourceId: string;
    sourceLabel: string;
    sourceType: string;
    targetId: string;
    targetLabel: string;
    targetType: string;
    type: string;
    context: string | null;
    reference_text: string | null;
  }

  interface RelationLeaderboardItem {
    id: string;
    title: string;
    count: number;
  }

  interface RelationsLeaderboard {
    topReferenced: RelationLeaderboardItem[];
    topReferring: RelationLeaderboardItem[];
  }

  // Relations tab states
  const [relations, setRelations] = useState<Relation[]>([]);
  const [relationsLoading, setRelationsLoading] = useState(false);
  const [relationsPage, setRelationsPage] = useState(1);
  const [relationsTotalPages, setRelationsTotalPages] = useState(1);
  const [relationsTotalItems, setRelationsTotalItems] = useState(0);
  const [relationsSearch, setRelationsSearch] = useState("");
  const [tempRelationsSearch, setTempRelationsSearch] = useState("");
  const [relationsType, setRelationsType] = useState("all");
  const [relationsLeaderboard, setRelationsLeaderboard] =
    useState<RelationsLeaderboard>({ topReferenced: [], topReferring: [] });
  const [selectedRelationNode, setSelectedRelationNode] = useState<
    string | null
  >(null);
  const [relationsModalReady, setRelationsModalReady] = useState(false);

  // Nodes tab states
  const [nodesSearch, setNodesSearch] = useState("");
  const [tempNodesSearch, setTempNodesSearch] = useState("");
  const [nodesType, setNodesType] = useState("all");
  const [nodesPage, setNodesPage] = useState(1);
  const nodesPerPage = 15;

  const processedNodes = useMemo(() => {
    if (!graphData?.nodes) return [];

    const degreeMap: Record<string, number> = {};
    if (graphData.edges) {
      graphData.edges.forEach((edge) => {
        if (edge.source) {
          degreeMap[edge.source] = (degreeMap[edge.source] || 0) + 1;
        }
        if (edge.target) {
          degreeMap[edge.target] = (degreeMap[edge.target] || 0) + 1;
        }
      });
    }

    let list = graphData.nodes.map((node) => ({
      ...node,
      degree: degreeMap[node.id] || 0,
    }));

    if (nodesSearch.trim()) {
      const searchLower = nodesSearch.toLowerCase();
      list = list.filter(
        (n) =>
          n.id.toLowerCase().includes(searchLower) ||
          (n.label && n.label.toLowerCase().includes(searchLower)),
      );
    }

    if (nodesType !== "all") {
      list = list.filter((n) => n.type === nodesType);
    }

    // Sort by degree descending, then by ID
    list.sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));

    return list;
  }, [graphData, nodesSearch, nodesType]);

  const paginatedNodes = useMemo(() => {
    const startIndex = (nodesPage - 1) * nodesPerPage;
    return processedNodes.slice(startIndex, startIndex + nodesPerPage);
  }, [processedNodes, nodesPage, nodesPerPage]);

  const nodesTotalPages = Math.ceil(processedNodes.length / nodesPerPage);

  const fetchRelations = async (
    page = 1,
    search = relationsSearch,
    type = relationsType,
  ) => {
    setRelationsLoading(true);
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: "15",
        search,
        type,
      });
      const response = await fetch(
        `/api/admin/graph/relations?${queryParams.toString()}`,
      );
      const data = await response.json();
      setRelations(data.relations || []);
      setRelationsPage(data.pagination.page);
      setRelationsTotalPages(data.pagination.pages);
      setRelationsTotalItems(data.pagination.total);
    } catch (err) {
      console.error("Error fetching relations:", err);
    } finally {
      setRelationsLoading(false);
    }
  };

  const fetchRelationsLeaderboard = async () => {
    try {
      const response = await fetch("/api/admin/graph/relations/leaderboard");
      const data = await response.json();
      setRelationsLeaderboard(data);
    } catch (err) {
      console.error("Error fetching relations leaderboard:", err);
    }
  };

  const computeEgoGraph = (nodeId: string) => {
    if (!graphData) return null;
    const targetNode = graphData.nodes.find((n) => n.id === nodeId);
    if (!targetNode) return null;
    const connectedEdges = graphData.edges.filter(
      (e) => e.source === nodeId || e.target === nodeId,
    );
    const connectedNodeIds = new Set<string>([nodeId]);
    connectedEdges.forEach((e) => {
      connectedNodeIds.add(e.source);
      connectedNodeIds.add(e.target);
    });
    const connectedNodes = graphData.nodes.filter((n) =>
      connectedNodeIds.has(n.id),
    );
    return {
      nodes: connectedNodes,
      edges: connectedEdges,
    };
  };

  const fetchChunks = async (
    page = 1,
    search = chunksSearch,
    type = chunksType,
  ) => {
    setChunksLoading(true);
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: "20",
        search,
        type,
      });
      const response = await fetch(
        `/api/admin/vector/chunks?${queryParams.toString()}`,
      );
      const data = await response.json();
      setChunks(data.chunks || []);
      setChunksPage(data.pagination.page);
      setChunksTotalPages(data.pagination.pages);
      setChunksTotalItems(data.pagination.total);
    } catch (err) {
      console.error("Error fetching chunks:", err);
    } finally {
      setChunksLoading(false);
    }
  };

  const handleVectorSearch = async () => {
    if (!vectorQuery.trim()) return;

    setVectorLoading(true);
    try {
      const response = await fetch("/api/admin/vector/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: vectorQuery, limit: 10 }),
      });
      const data = await response.json();
      setVectorResults(data.results || []);
    } catch (error) {
      console.error("Vector search failed:", error);
    } finally {
      setVectorLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch("/api/admin/stats");
      const data = await response.json();
      setStats(data);
    } catch (err) {
      console.error("Error fetching stats:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchVectorStoreStatus = async () => {
    try {
      const response = await fetch("/api/admin/vector-store/status");
      const data = await response.json();
      setVectorStoreStatus(data);
    } catch (err) {
      console.error("Error fetching vector store status:", err);
    }
  };

  const fetchConfig = async () => {
    try {
      const response = await fetch("/api/admin/config");
      const data = await response.json();
      setConfig(data);
      setTempVectorStoreType(data.vectorStoreType || "congraph");
      setTempClientGraphMode(data.clientGraphMode || "query");
    } catch (err) {
      console.error("Error fetching config:", err);
    }
  };

  const handleSaveConfig = async () => {
    try {
      await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientGraphMode: tempClientGraphMode }),
      });
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              clientGraphMode: tempClientGraphMode as "query" | "explorer",
            }
          : null,
      );
      setShowConfigSavedModal(true);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchGraphData = async () => {
    try {
      const response = await fetch("/api/admin/graph/data");
      const data = await response.json();
      setGraphData(data);
    } catch (err) {
      console.error("Error fetching graph data:", err);
    }
  };

  const fetchActivities = async () => {
    try {
      const response = await fetch("/api/admin/activity?limit=50");
      const data = await response.json();
      setActivities(data.activities || []);
    } catch (err) {
      console.error("Error fetching activities:", err);
    }
  };

  const handleDownloadActivityJSON = (activity: Activity) => {
    try {
      const json = activity.details || activity;
      const blob = new Blob([JSON.stringify(json, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pipeline-${activity.id || "consult"}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Failed to download JSON:", e);
    }
  };

  const handleOpenActivityJSON = (activity: Activity) => {
    try {
      const json = activity.details || activity;
      const blob = new Blob([JSON.stringify(json, null, 2)], {
        type: "application/json",
      });
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (e) {
      console.error("Failed to open JSON:", e);
    }
  };

  const fetchCommunities = async () => {
    setCommunitiesLoading(true);
    try {
      const response = await fetch("/api/admin/communities");
      const data = await response.json();
      setCommunities(data.communities || []);
    } catch (err) {
      console.error("Error fetching communities:", err);
    } finally {
      setCommunitiesLoading(false);
    }
  };

  const handleAddCommunity = async () => {
    if (
      !newCommunity.community_id ||
      !newCommunity.title ||
      !newCommunity.summary
    ) {
      alert(
        "Vui lòng điền đầy đủ các thông tin bắt buộc (ID, Tiêu đề, Tóm tắt)",
      );
      return;
    }

    setUploadLoading(true);
    setUploadMessage("Đang thêm cộng đồng mới...");

    try {
      const response = await fetch("/api/admin/community/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newCommunity,
          findings: newCommunity.findings.filter(
            (f: string) => f.trim() !== "",
          ),
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setShowAddCommunityModal(false);
        fetchCommunities();
        fetchActivities();
        setNewCommunity({
          id: "",
          community_id: "",
          level: 1,
          title: "",
          summary: "",
          findings: [""],
          rating: 10,
          parent_id: "",
          article_count: 0,
          principles: "",
        });
      } else {
        alert(`Lỗi: ${data.error}`);
      }
    } catch {
      console.error("Failed to add community");
      alert("Lỗi kết nối khi thêm cộng đồng");
    } finally {
      setUploadLoading(false);
      setUploadMessage("");
    }
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadLoading(true);
    setUploadMessage("Đang xử lý tệp...");

    try {
      const reader = new FileReader();
      reader.onload = async (e: ProgressEvent<FileReader>) => {
        try {
          const content = JSON.parse(e.target?.result as string);
          const response = await fetch("/api/admin/knowledge/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              content: content,
            }),
          });

          const data = await response.json();
          if (response.ok) {
            setUploadMessage(`Thành công: ${data.message}`);
            fetchStats();
            fetchActivities();
            fetchVectorStoreStatus();
          } else {
            setUploadMessage(`Lỗi: ${data.error}`);
          }
        } catch {
          setUploadMessage("Lỗi: Định dạng JSON không hợp lệ");
        } finally {
          setUploadLoading(false);
        }
      };
      reader.readAsText(file);
    } catch {
      setUploadMessage("Lỗi khi đọc tệp");
      setUploadLoading(false);
    }
  };

  const handleRebuildVector = async () => {
    if (
      !confirm(
        "Bạn có chắc chắn muốn xây dựng lại toàn bộ Vector Index? Thao tác này có thể mất vài phút.",
      )
    )
      return;

    setUploadLoading(true);
    setUploadMessage("Đang xây dựng lại Vector Index...");

    try {
      const response = await fetch("/api/admin/rebuild-vector", {
        method: "POST",
      });
      const data = await response.json();

      if (response.ok) {
        setUploadMessage(
          "Thành công: Quá trình xây dựng lại đã bắt đầu trong nền",
        );
        fetchStats();
        fetchActivities();
      } else {
        setUploadMessage(`Lỗi: ${data.error}`);
      }
    } catch {
      setUploadMessage("Lỗi kết nối khi xây dựng lại chỉ mục");
    } finally {
      setUploadLoading(false);
    }
  };

  /* Disabled per user request
  const handleCleanGraph = async () => {
    if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ dữ liệu tri thức và đồ thị? Thao tác này không thể hoàn tác.')) return;
    
    setUploadLoading(true);
    setUploadMessage('Đang xóa dữ liệu...');
    
    try {
      const response = await fetch('/api/admin/knowledge/clean', { method: 'POST' });
      const data = await response.json();
      
      if (response.ok) {
        setUploadMessage('Thành công: Đã xóa toàn bộ dữ liệu');
        fetchStats();
        fetchActivities();
      } else {
        setUploadMessage(`Lỗi: ${data.error}`);
      }
    } catch (err) {
      setUploadMessage('Lỗi kết nối khi xóa dữ liệu');
    } finally {
      setUploadLoading(false);
    }
  };
  */

  useEffect(() => {
    fetchStats();
    fetchActivities();
    fetchVectorStoreStatus();
    fetchConfig();
    const interval = setInterval(() => {
      fetchStats();
      fetchActivities();
      fetchVectorStoreStatus();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if ((activeView === "graph" || activeView === "knowledge") && !graphData) {
      fetchGraphData();
    }
    if (activeView === "community" && communities.length === 0) {
      fetchCommunities();
    }
  }, [activeView, graphData, communities]);

  useEffect(() => {
    if (activeView === "vector" && activeTab === "chunks") {
      fetchChunks(chunksPage, chunksSearch, chunksType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, activeTab, chunksPage, chunksSearch, chunksType]);

  useEffect(() => {
    if (activeView === "knowledge" && knowledgeTab === "relations") {
      fetchRelations(relationsPage, relationsSearch, relationsType);
      fetchRelationsLeaderboard();
      if (!graphData) {
        fetchGraphData();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, knowledgeTab, relationsPage, relationsSearch, relationsType]);

  useEffect(() => {
    if (selectedRelationNode) {
      const timer = setTimeout(() => {
        setRelationsModalReady(true);
      }, 350);
      return () => clearTimeout(timer);
    } else {
      setRelationsModalReady(false);
    }
  }, [selectedRelationNode]);

  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullScreen(false);
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  const toggleTypeVisibility = (type: string) => {
    setVisibleTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const renderView = () => {
    const graphTypeCounts = {
      Part: 0,
      Chapter: 0,
      Section: 0,
      Subsection: 0,
      Article: 0,
      Clause: 0,
      ClausePoint: 0,
    };
    if (graphData?.nodes) {
      graphData.nodes.forEach((n) => {
        if (n.type in graphTypeCounts) {
          graphTypeCounts[n.type as keyof typeof graphTypeCounts]++;
        }
      });
    }

    const graphEdgeCounts = {
      HAS_CHAPTER: 0,
      HAS_SECTION: 0,
      HAS_SUBSECTION: 0,
      BELONGS_TO_SUBSECTION: 0,
      BELONGS_TO_SECTION: 0,
      BELONGS_TO_CHAPTER: 0,
      HAS_CLAUSE: 0,
      HAS_POINT: 0,
    };
    if (graphData?.edges) {
      graphData.edges.forEach((e) => {
        if (e.type in graphEdgeCounts) {
          graphEdgeCounts[e.type as keyof typeof graphEdgeCounts]++;
        }
      });
    }

    const visibleNodeIds = new Set(
      graphData?.nodes
        ?.filter((n) => visibleTypes.includes(n.type))
        .map((n) => n.id) || [],
    );
    const visibleNodesCount = visibleNodeIds.size;
    const visibleEdgesCount =
      graphData?.edges?.filter(
        (e) =>
          visibleNodeIds.has(e.source) &&
          visibleNodeIds.has(e.target) &&
          visibleEdgeTypes.includes(e.type),
      ).length || 0;

    switch (activeView) {
      case "llm":
        return renderLlmMonitorView();
      case "overview":
        return (
          <div className="view-section" key="overview">
            <div className="welcome-banner">
              <h1>Chào mừng trở lại, Admin!</h1>
              <p>
                Hệ thống GraphRAG đang hoạt động ổn định với hiệu suất tối ưu.
              </p>
            </div>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon purple">
                  <i className="fas fa-file-contract"></i>
                </div>
                <div className="stat-info">
                  <h3>Tổng số Điều luật</h3>
                  <div className="value">{stats?.graph?.Article || 0}</div>
                  <div className="trend up">
                    <i className="fas fa-arrow-up"></i> 12% tháng này
                  </div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon blue">
                  <i className="fas fa-nodes-circle-nodes"></i>
                </div>
                <div className="stat-info">
                  <h3>Nút trong Đồ thị</h3>
                  <div className="value">{stats?.graph?.total_nodes || 0}</div>
                  <div className="trend up">
                    <i className="fas fa-arrow-up"></i> 8% tháng này
                  </div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon green">
                  <i className="fas fa-link"></i>
                </div>
                <div className="stat-info">
                  <h3>Quan hệ tham chiếu</h3>
                  <div className="value">{stats?.graph?.total_edges || 0}</div>
                  <div className="trend up">
                    <i className="fas fa-arrow-up"></i> 5% tháng này
                  </div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon orange">
                  <i className="fas fa-bolt"></i>
                </div>
                <div className="stat-info">
                  <h3>Thời gian phản hồi TB</h3>
                  <div className="value">1.2s</div>
                  <div className="trend down">
                    <i className="fas fa-arrow-down"></i> 3% hôm nay
                  </div>
                </div>
              </div>
            </div>

            <div className="card" style={{ marginBottom: "24px" }}>
              <div
                className={`card-header collapsible ${collapsedSections["nodes"] ? "collapsed" : ""}`}
                onClick={() => toggleSection("nodes")}
              >
                <h2>Cấu trúc Knowledge Graph</h2>
                <i className="fas fa-chevron-up toggle-icon"></i>
              </div>
              {!collapsedSections["nodes"] && (
                <div className="card-body">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Phân loại</th>
                        <th>Loại đối tượng</th>
                        <th>Số lượng</th>
                        <th>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats?.graph &&
                        Object.entries(stats.graph)
                          .filter(
                            ([k]) =>
                              !["total_nodes", "total_edges"].includes(k),
                          )
                          .map(([type, count]) => {
                            const isEdge = type.startsWith("edge:");
                            const cleanType = isEdge
                              ? type.replace("edge:", "")
                              : type;
                            return (
                              <tr key={type}>
                                <td>
                                  <span
                                    className={`type-tag ${isEdge ? "edge" : "node"}`}
                                  >
                                    {isEdge ? "Edge" : "Node"}
                                  </span>
                                </td>
                                <td style={{ fontWeight: 500 }}>{cleanType}</td>
                                <td>{String(count)}</td>
                                <td>
                                  <span className="status-badge active">
                                    Active
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        );
      case "graph":
        return (
          <div className="view-section" key="graph">
            <div className="view-header">
              <h2>Quản lý Knowledge Graph</h2>
              <button className="btn-primary" onClick={fetchGraphData}>
                <i className="fas fa-sync-alt"></i> Rebuild Graph
              </button>
            </div>

            <div
              className={`card ${isFullScreen ? "graph-fullscreen" : ""}`}
              style={{ marginTop: "20px" }}
            >
              <div className="card-header">
                <h2>Visual Graph Explorer</h2>
                <div className="header-actions">
                  <div className="zoom-control-header">
                    <i className="fas fa-search-minus"></i>
                    <input
                      type="range"
                      min="0.1"
                      max="3"
                      step="0.1"
                      value={zoomLevel}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setZoomLevel(val);
                        if (cyRef.current) {
                          cyRef.current.zoom({
                            level: val,
                            renderedPosition: {
                              x: cyRef.current.width() / 2,
                              y: cyRef.current.height() / 2,
                            },
                          });
                        }
                      }}
                    />
                    <i className="fas fa-search-plus"></i>
                    <span className="zoom-value">
                      {Math.round(zoomLevel * 100)}%
                    </span>
                  </div>

                  <button
                    className="btn-small"
                    title="Full Screen"
                    onClick={() => setIsFullScreen(!isFullScreen)}
                  >
                    <i
                      className={`fas ${isFullScreen ? "fa-compress" : "fa-expand"}`}
                    ></i>
                  </button>

                  <select
                    className="layout-select-header"
                    value={graphLayout}
                    onChange={(e) => setGraphLayout(e.target.value)}
                  >
                    <option value="fcose">Clustered (fCose)</option>
                    <option value="cose">Traditional (Cose)</option>
                    <option value="cola">Organic (Cola)</option>
                    <option value="dagre">Hierarchy (Dagre)</option>
                    <option value="concentric">Concentric (Radar)</option>
                    <option value="grid">Grid</option>
                    <option value="circle">Circle</option>
                    <option value="breadthfirst">Breadthfirst</option>
                  </select>

                  <button
                    className="btn-small"
                    title="Tải lại đồ thị"
                    onClick={fetchGraphData}
                  >
                    <i className="fas fa-sync-alt"></i>
                  </button>
                </div>
              </div>
              <div
                className="card-body"
                style={{
                  overflow: "hidden",
                  position: "relative",
                  display: "flex",
                  height: isFullScreen ? "calc(100vh - 120px)" : "600px",
                }}
              >
                <div
                  className="graph-loading-overlay"
                  style={{
                    display: graphRendering || !graphData ? "flex" : "none",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 100,
                    background: "rgba(13, 17, 23, 0.8)",
                    backdropFilter: "blur(4px)",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <div className="spinner"></div>
                  <p>
                    {!graphData
                      ? "Đang tải dữ liệu..."
                      : "Đang tính toán bố cục đồ thị..."}
                  </p>
                </div>

                <GraphVisualization
                  data={graphData}
                  layout={graphLayout}
                  visibleTypes={visibleTypes}
                  setSelectedNode={setSelectedNode}
                  setZoomLevel={setZoomLevel}
                  onRenderingChange={setGraphRendering}
                  onInit={(cy: unknown) =>
                    (cyRef.current = cy as CytoscapeInstance)
                  }
                />

                {selectedNode && (
                  <div className="graph-sidebar">
                    <div className="sidebar-header">
                      <span
                        className={`type-tag ${selectedNode.type.toLowerCase()}`}
                      >
                        {selectedNode.type}
                      </span>
                      <button
                        className="btn-close"
                        onClick={() => setSelectedNode(null)}
                      >
                        <i className="fas fa-times"></i>
                      </button>
                    </div>
                    <div className="sidebar-content">
                      <h3>{selectedNode.label}</h3>
                      <div className="meta-info">
                        <p>
                          <strong>ID:</strong> {selectedNode.id}
                        </p>
                      </div>
                      <div className="node-description">
                        <p>
                          Thông tin chi tiết về đối tượng pháp lý này sẽ được
                          hiển thị tại đây.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div
                  className="graph-legend"
                  style={{
                    position: "absolute",
                    top: "20px",
                    right: "20px",
                    background: "rgba(13, 17, 23, 0.7)",
                    backdropFilter: "blur(4px)",
                    padding: "12px",
                    borderRadius: "8px",
                    zIndex: 5,
                    border: "1px solid rgba(255,255,255,0.05)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  {[
                    "Part",
                    "Chapter",
                    "Section",
                    "Subsection",
                    "Article",
                    "Clause",
                    "ClausePoint",
                  ].map((type) => (
                    <label
                      key={type}
                      className="legend-item"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        cursor: "pointer",
                        gap: "8px",
                        fontSize: "12px",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={visibleTypes.includes(type)}
                        onChange={() => toggleTypeVisibility(type)}
                        style={{ accentColor: "var(--accent-blue)" }}
                      />
                      <span className={`color ${type.toLowerCase()}`}></span>
                      {type} (
                      {graphTypeCounts[type as keyof typeof graphTypeCounts] ||
                        0}
                      )
                    </label>
                  ))}
                  <div
                    style={{
                      marginTop: "4px",
                      paddingTop: "8px",
                      borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                      fontSize: "11px",
                      color: "#94a3b8",
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                      }}
                    >
                      <span>Visible nodes:</span>
                      <strong style={{ color: "#f8fafc" }}>
                        {visibleNodesCount}
                      </strong>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                      }}
                    >
                      <span>Visible edges:</span>
                      <strong style={{ color: "#f8fafc" }}>
                        {visibleEdgesCount}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      case "community":
        return (
          <div className="view-section" key="community">
            <div className="view-header">
              <h2>Quản lý Community Reports (Global Search)</h2>
              <div className="header-actions">
                <button className="btn-secondary" onClick={fetchCommunities}>
                  <i className="fas fa-sync-alt"></i> Tải lại
                </button>
                <button
                  className="btn-primary"
                  onClick={() => setShowAddCommunityModal(true)}
                >
                  <i className="fas fa-plus-circle"></i> Thêm mới
                </button>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon purple">
                  <i className="fas fa-users-viewfinder"></i>
                </div>
                <div className="stat-info">
                  <h3>Tổng số Community</h3>
                  <div className="value">{communities.length}</div>
                  <span>Hierarchy Level 0 & 1</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon orange">
                  <i className="fas fa-star"></i>
                </div>
                <div className="stat-info">
                  <h3>Rating trung bình</h3>
                  <div className="value">
                    {(
                      communities.reduce(
                        (acc, curr) => acc + (curr.rating || 0),
                        0,
                      ) / (communities.length || 1)
                    ).toFixed(1)}
                    /10
                  </div>
                  <span>Chất lượng tóm tắt (Thang 10)</span>
                </div>
              </div>
            </div>

            <div className="card" style={{ marginTop: "24px" }}>
              <div className="card-header">
                <h2>Danh sách báo cáo cộng đồng</h2>
              </div>
              <div className="card-body">
                {communitiesLoading ? (
                  <div className="loading-placeholder">
                    <div className="spinner"></div>
                    <p>Đang tải dữ liệu cộng đồng...</p>
                  </div>
                ) : (
                  <div className="community-grid">
                    {communities.map((comm) => (
                      <div key={comm.id} className="community-card">
                        <div className="community-card-header">
                          <span
                            className={`level-badge ${comm.level === 0 ? "part" : "chapter"}`}
                          >
                            {comm.level === 0 ? "PHẦN" : "CHƯƠNG"}
                          </span>
                          <div className="rating">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <i
                                key={i}
                                className={`fas fa-star ${i < comm.rating ? "active" : ""}`}
                              ></i>
                            ))}
                          </div>
                        </div>
                        <h3>{comm.title}</h3>
                        <p className="summary">{comm.summary}</p>
                        <div className="community-footer">
                          <span className="id-text">{comm.id}</span>
                          <button
                            className="btn-text"
                            onClick={() => setSelectedCommunity(comm)}
                          >
                            Chi tiết <i className="fas fa-arrow-right"></i>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Community Detail Modal */}
            {selectedCommunity && (
              <div
                className="modal-overlay"
                onClick={() => setSelectedCommunity(null)}
              >
                <div
                  className="modal-content admin-modal glass-card animate-zoom"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="modal-header">
                    <div className="header-title-group">
                      <span
                        className={`level-badge ${selectedCommunity.level === 0 ? "part" : "chapter"}`}
                      >
                        {selectedCommunity.level === 0 ? "PHẦN" : "CHƯƠNG"}
                      </span>
                      <h2>{selectedCommunity.title}</h2>
                    </div>
                    <button
                      className="btn-close"
                      onClick={() => setSelectedCommunity(null)}
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  </div>
                  <div className="modal-body scrollable">
                    <div className="modal-stats-row">
                      <div className="m-stat">
                        <label>Đánh giá</label>
                        <div className="v">{selectedCommunity.rating}/10</div>
                      </div>
                      <div className="m-stat">
                        <label>Số lượng Điều luật</label>
                        <div className="v">
                          {selectedCommunity.article_count} Điều
                        </div>
                      </div>
                    </div>

                    <div className="modal-section">
                      <h3>
                        <i className="fas fa-lightbulb"></i> Nguyên tắc cốt lõi
                      </h3>
                      <div className="principles-box">
                        {selectedCommunity.principles || "N/A"}
                      </div>
                    </div>

                    <div className="modal-section">
                      <h3>
                        <i className="fas fa-align-left"></i> Tóm tắt chi tiết
                      </h3>
                      <p className="full-summary">
                        {selectedCommunity.summary}
                      </p>
                    </div>

                    <div className="modal-section">
                      <h3>
                        <i className="fas fa-search"></i> Các phát hiện
                        (Findings)
                      </h3>
                      <ul className="finding-list">
                        {(selectedCommunity.findings || []).map(
                          (
                            f:
                              | string
                              | { explanation: string; articles?: string[] },
                            idx: number,
                          ) => (
                            <li key={idx} className="finding-item">
                              <strong>
                                {typeof f === "string" ? f : f.explanation}
                              </strong>
                              {typeof f !== "string" && f.articles && (
                                <p>Cơ sở: {f.articles?.join(", ")}</p>
                              )}
                            </li>
                          ),
                        )}
                      </ul>
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button
                      className="btn-secondary"
                      onClick={() => setSelectedCommunity(null)}
                    >
                      Đóng
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Add Community Modal */}
            {showAddCommunityModal && (
              <div
                className="modal-overlay"
                onClick={() => setShowAddCommunityModal(false)}
              >
                <div
                  className="modal-content admin-modal glass-card animate-zoom"
                  style={{ maxWidth: "700px" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="modal-header">
                    <h2>Thêm mới Community Report</h2>
                    <button
                      className="btn-close"
                      onClick={() => setShowAddCommunityModal(false)}
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  </div>
                  <div className="modal-body scrollable">
                    <div className="form-grid">
                      <div className="form-group">
                        <label>Community ID (VD: chapter_1)</label>
                        <input
                          type="text"
                          value={newCommunity.community_id}
                          onChange={(e) =>
                            setNewCommunity({
                              ...newCommunity,
                              community_id: e.target.value,
                            })
                          }
                          placeholder="ID này nên trùng với ID Chương nếu là Level 1"
                        />
                      </div>
                      <div className="form-group">
                        <label>Cấp độ (Level)</label>
                        <select
                          value={newCommunity.level}
                          onChange={(e) =>
                            setNewCommunity({
                              ...newCommunity,
                              level: parseInt(e.target.value),
                            })
                          }
                        >
                          <option value={0}>Level 0 (Phần)</option>
                          <option value={1}>Level 1 (Chương)</option>
                        </select>
                      </div>
                      <div className="form-group full-width">
                        <label>Tiêu đề</label>
                        <input
                          type="text"
                          value={newCommunity.title}
                          onChange={(e) =>
                            setNewCommunity({
                              ...newCommunity,
                              title: e.target.value,
                            })
                          }
                          placeholder="Tiêu đề báo cáo cộng đồng"
                        />
                      </div>
                      <div className="form-group full-width">
                        <label>Tóm tắt (Summary)</label>
                        <textarea
                          rows={4}
                          value={newCommunity.summary}
                          onChange={(e) =>
                            setNewCommunity({
                              ...newCommunity,
                              summary: e.target.value,
                            })
                          }
                          placeholder="Nội dung tóm tắt chính của cộng đồng này..."
                        />
                      </div>
                      <div className="form-group">
                        <label>Parent ID (VD: part_1)</label>
                        <input
                          type="text"
                          value={newCommunity.parent_id}
                          onChange={(e) =>
                            setNewCommunity({
                              ...newCommunity,
                              parent_id: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="form-group">
                        <label>Đánh giá (Rating 0-10)</label>
                        <input
                          type="number"
                          min="0"
                          max="10"
                          value={newCommunity.rating}
                          onChange={(e) =>
                            setNewCommunity({
                              ...newCommunity,
                              rating: parseFloat(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div className="form-group full-width">
                        <label>Nguyên tắc cốt lõi (Core Principles)</label>
                        <textarea
                          rows={2}
                          value={newCommunity.principles}
                          onChange={(e) =>
                            setNewCommunity({
                              ...newCommunity,
                              principles: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="form-group full-width">
                        <label>Các phát hiện (Findings)</label>
                        {newCommunity.findings.map(
                          (finding: string, idx: number) => (
                            <div
                              key={idx}
                              className="dynamic-input-row"
                              style={{
                                display: "flex",
                                gap: "8px",
                                marginBottom: "8px",
                              }}
                            >
                              <input
                                type="text"
                                value={finding}
                                onChange={(e) => {
                                  const newFindings = [
                                    ...newCommunity.findings,
                                  ];
                                  newFindings[idx] = e.target.value;
                                  setNewCommunity({
                                    ...newCommunity,
                                    findings: newFindings,
                                  });
                                }}
                                style={{ flex: 1 }}
                              />
                              <button
                                className="btn-icon danger"
                                onClick={() => {
                                  const newFindings =
                                    newCommunity.findings.filter(
                                      (_: unknown, i: number) => i !== idx,
                                    );
                                  setNewCommunity({
                                    ...newCommunity,
                                    findings: newFindings,
                                  });
                                }}
                              >
                                <i className="fas fa-trash"></i>
                              </button>
                            </div>
                          ),
                        )}
                        <button
                          className="btn-text"
                          onClick={() =>
                            setNewCommunity({
                              ...newCommunity,
                              findings: [...newCommunity.findings, ""],
                            })
                          }
                        >
                          <i className="fas fa-plus"></i> Thêm phát hiện
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button
                      className="btn-secondary"
                      onClick={() => setShowAddCommunityModal(false)}
                    >
                      Hủy
                    </button>
                    <button
                      className="btn-primary"
                      onClick={handleAddCommunity}
                      disabled={uploadLoading}
                    >
                      {uploadLoading ? (
                        <>
                          <div className="spinner-small"></div> Đang xử lý...
                        </>
                      ) : (
                        "Thêm cộng đồng"
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      case "vector":
        return (
          <div className="view-section" key="vector">
            <div className="view-header">
              <h2>
                Quản lý Vector Store (
                {!vectorStoreStatus
                  ? "..."
                  : vectorStoreStatus.type === "congraph"
                    ? "ConGraphDB"
                    : "LanceDB"}
                )
              </h2>
              <button className="btn-primary" onClick={handleRebuildVector}>
                <i className="fas fa-vector-square"></i> Re-index Vector
              </button>
            </div>

            <div className="tabs-navigation">
              <button
                className={`tab-btn ${activeTab === "general" ? "active" : ""}`}
                onClick={() => setActiveTab("general")}
              >
                <i className="fas fa-info-circle"></i> General Tab
              </button>
              <button
                className={`tab-btn ${activeTab === "chunks" ? "active" : ""}`}
                onClick={() => setActiveTab("chunks")}
              >
                <i className="fas fa-list"></i> View all Chunks Tab
              </button>
              <button
                className={`tab-btn ${activeTab === "search" ? "active" : ""}`}
                onClick={() => setActiveTab("search")}
              >
                <i className="fas fa-search"></i> Thử nghiệm tìm kiếm Vector Tab
              </button>
            </div>

            {activeTab === "general" && (
              <div className="animate-zoom">
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-info">
                      <h3>Loại Vector Store</h3>
                      <div className="value">
                        {!vectorStoreStatus
                          ? "Đang tải..."
                          : vectorStoreStatus.type === "congraph"
                            ? "ConGraphDB"
                            : "LanceDB"}
                      </div>
                      <span>
                        {vectorStoreStatus?.ready
                          ? "Đã kết nối"
                          : "Chưa kết nối"}
                      </span>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-info">
                      <h3>Kích thước Vector</h3>
                      <div className="value">
                        {config?.embeddingDimension || 384}
                      </div>
                      <span>
                        {config?.embeddingModel ||
                          "paraphrase-multilingual-MiniLM-L12-v2"}
                      </span>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-info">
                      <h3>Tổng số Chunks</h3>
                      <div className="value">
                        {stats?.vector?.total_chunks || "..."}
                      </div>
                      <span>Tất cả các bảng</span>
                    </div>
                  </div>
                </div>
                <div className="card" style={{ marginTop: "20px" }}>
                  <div className="card-header">
                    <h2>Thêm mới Vector Store</h2>
                  </div>
                  <div
                    className="card-body"
                    style={{
                      display: "flex",
                      gap: "24px",
                      alignItems: "center",
                    }}
                  >
                    <div
                      className="upload-container"
                      style={{ flex: 1, padding: "20px" }}
                    >
                      <div
                        className="upload-icon"
                        style={{ fontSize: "32px", marginBottom: "10px" }}
                      >
                        <i className="fas fa-file-export"></i>
                      </div>
                      <h3>Tải lên tệp tri thức mới</h3>
                      <p style={{ fontSize: "12px" }}>
                        Tự động bổ sung vào Vector Index mà không xóa dữ liệu cũ
                      </p>

                      <label
                        className="btn-primary"
                        style={{
                          cursor: "pointer",
                          display: "inline-block",
                          marginTop: "15px",
                        }}
                      >
                        <i className="fas fa-plus-circle"></i> Chọn tệp JSON
                        <input
                          type="file"
                          accept=".json"
                          onChange={handleFileUpload}
                          style={{ display: "none" }}
                        />
                      </label>

                      {uploadLoading && (
                        <div style={{ marginTop: "15px" }}>
                          <div
                            className="spinner"
                            style={{
                              margin: "0 auto 10px",
                              width: "20px",
                              height: "20px",
                            }}
                          ></div>
                          <p style={{ fontSize: "13px" }}>{uploadMessage}</p>
                        </div>
                      )}

                      {!uploadLoading && uploadMessage && (
                        <div
                          style={{
                            marginTop: "15px",
                            padding: "8px 12px",
                            borderRadius: "8px",
                            fontSize: "13px",
                            background: uploadMessage.startsWith("Thành công")
                              ? "rgba(16, 185, 129, 0.1)"
                              : "rgba(239, 68, 68, 0.1)",
                            color: uploadMessage.startsWith("Thành công")
                              ? "#10b981"
                              : "#ef4444",
                            border: `1px solid ${uploadMessage.startsWith("Thành công") ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)"}`,
                          }}
                        >
                          {uploadMessage}
                        </div>
                      )}
                    </div>

                    <div
                      className="info-box"
                      style={{ flex: 1, height: "100%", margin: 0 }}
                    >
                      <h4 style={{ fontSize: "14px", marginBottom: "10px" }}>
                        <i className="fas fa-info-circle"></i> Cập nhật bổ sung
                      </h4>
                      <ul style={{ fontSize: "13px", lineHeight: "1.6" }}>
                        <li>
                          Dữ liệu mới sẽ được Vector hóa và lưu trữ vào{" "}
                          {vectorStoreStatus?.type === "congraph"
                            ? "ConGraphDB"
                            : "LanceDB"}
                          .
                        </li>
                        <li>
                          Sử dụng model:{" "}
                          {config?.embeddingModel ||
                            "paraphrase-multilingual-MiniLM-L12-v2"}
                          .
                        </li>
                        <li>
                          Tìm kiếm ngữ nghĩa sẽ khả dụng ngay sau khi quá trình
                          tải lên hoàn tất.
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "chunks" && (
              <div className="card animate-zoom" style={{ marginTop: "20px" }}>
                <div className="card-header">
                  <h2>Tất cả Vector Chunks</h2>
                  <span className="badge-dim">Tổng số: {chunksTotalItems}</span>
                </div>
                <div className="card-body">
                  <div className="chunk-filters">
                    <div className="chunk-search">
                      <i className="fas fa-search"></i>
                      <input
                        type="text"
                        placeholder="Tìm kiếm theo tiêu đề, nội dung, ID..."
                        value={tempChunksSearch}
                        onChange={(e) => setTempChunksSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            setChunksSearch(tempChunksSearch);
                            setChunksPage(1);
                          }
                        }}
                      />
                    </div>
                    <div className="filter-group">
                      <button
                        className="btn-primary"
                        onClick={() => {
                          setChunksSearch(tempChunksSearch);
                          setChunksPage(1);
                        }}
                      >
                        Tìm kiếm
                      </button>
                      <select
                        className="filter-select"
                        value={chunksType}
                        onChange={(e) => {
                          setChunksType(e.target.value);
                          setChunksPage(1);
                        }}
                      >
                        <option value="all">Tất cả Loại</option>
                        <option value="article">Điều luật (Articles)</option>
                        <option value="clause">Khoản luật (Clauses)</option>
                      </select>
                    </div>
                  </div>

                  <div className="chunk-table-container">
                    {chunksLoading ? (
                      <div
                        style={{
                          padding: "40px",
                          textAlign: "center",
                        }}
                        className="placeholder-text"
                      >
                        <div
                          className="spinner"
                          style={{ margin: "0 auto 15px" }}
                        ></div>
                        Đang tải danh sách chunks...
                      </div>
                    ) : chunks.length > 0 ? (
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Loại</th>
                            <th>ID</th>
                            <th>Tiêu đề</th>
                            <th>Nội dung</th>
                            <th>Vị trí</th>
                            <th>Hành động</th>
                          </tr>
                        </thead>
                        <tbody>
                          {chunks.map((chunk, index) => (
                            <tr key={chunk.id || index}>
                              <td>
                                <span className={`type-tag tag-${chunk.type}`}>
                                  {chunk.type === "article" ? "Điều" : "Khoản"}
                                </span>
                              </td>
                              <td
                                style={{
                                  fontFamily: "monospace",
                                  fontSize: "12px",
                                }}
                              >
                                {chunk.id}
                              </td>
                              <td
                                style={{
                                  fontWeight: 600,
                                  color: "var(--accent-blue)",
                                }}
                              >
                                {chunk.title}
                              </td>
                              <td>
                                <div
                                  className="chunk-content-cell"
                                  title={chunk.content}
                                >
                                  {chunk.content}
                                </div>
                              </td>
                              <td
                                style={{
                                  color: "var(--text-dim)",
                                  fontSize: "12px",
                                }}
                              >
                                {chunk.metadata.part &&
                                  `${chunk.metadata.part} • `}
                                {chunk.metadata.chapter}
                              </td>
                              <td>
                                <button
                                  className="btn-small"
                                  onClick={() => {
                                    const previewObj: VectorResult = {
                                      id: chunk.id,
                                      type: chunk.type,
                                      title:
                                        chunk.type === "clause"
                                          ? chunk.metadata.article_title
                                          : chunk.title,
                                      content: chunk.content,
                                      article_id:
                                        chunk.type === "clause"
                                          ? chunk.article_id
                                          : chunk.id,
                                      clause_number:
                                        chunk.type === "clause"
                                          ? chunk.clause_number
                                          : undefined,
                                      article_title:
                                        chunk.type === "clause"
                                          ? chunk.metadata.article_title
                                          : chunk.title,
                                      _distance: 0,
                                      score: 1,
                                    };
                                    setPreviewArticle(previewObj);
                                  }}
                                >
                                  <i className="fas fa-eye"></i> Xem
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div
                        style={{ padding: "40px" }}
                        className="placeholder-text"
                      >
                        Không tìm thấy chunks nào phù hợp.
                      </div>
                    )}
                  </div>

                  {chunksTotalPages > 1 && (
                    <div className="pagination-container">
                      <div>
                        Trang {chunksPage} / {chunksTotalPages} (Hiển thị{" "}
                        {(chunksPage - 1) * 20 + 1} -{" "}
                        {Math.min(chunksPage * 20, chunksTotalItems)} trong số{" "}
                        {chunksTotalItems} chunks)
                      </div>
                      <div className="pagination-buttons">
                        <button
                          className="pagination-btn"
                          disabled={chunksPage === 1 || chunksLoading}
                          onClick={() => setChunksPage(1)}
                        >
                          Đầu
                        </button>
                        <button
                          className="pagination-btn"
                          disabled={chunksPage === 1 || chunksLoading}
                          onClick={() => setChunksPage(chunksPage - 1)}
                        >
                          Trước
                        </button>
                        <button
                          className="pagination-btn"
                          disabled={
                            chunksPage === chunksTotalPages || chunksLoading
                          }
                          onClick={() => setChunksPage(chunksPage + 1)}
                        >
                          Sau
                        </button>
                        <button
                          className="pagination-btn"
                          disabled={
                            chunksPage === chunksTotalPages || chunksLoading
                          }
                          onClick={() => setChunksPage(chunksTotalPages)}
                        >
                          Cuối
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "search" && (
              <div className="card animate-zoom" style={{ marginTop: "20px" }}>
                <div className="card-header">
                  <h2>Thử nghiệm tìm kiếm Vector</h2>
                </div>
                <div className="card-body">
                  <div className="search-box">
                    <input
                      type="text"
                      placeholder="Nhập từ khóa tìm kiếm vector..."
                      value={vectorQuery}
                      onChange={(e) => setVectorQuery(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleVectorSearch()
                      }
                    />
                    <button
                      className="btn-primary"
                      onClick={handleVectorSearch}
                      disabled={vectorLoading}
                    >
                      {vectorLoading ? (
                        <i className="fas fa-spinner fa-spin"></i>
                      ) : (
                        "Tìm kiếm"
                      )}
                    </button>
                  </div>
                  <div className="results-container" id="vector-results-panel">
                    {vectorResults.length > 0 ? (
                      <div className="vector-results-list">
                        {vectorResults.map((res, i) => {
                          const score = 1 - res._distance;
                          const scorePct = Math.round(score * 100);
                          const scoreColorClass =
                            score > 0.4
                              ? "score-high"
                              : score > 0.25
                                ? "score-mid"
                                : "score-low";
                          const scoreBgClass =
                            score > 0.4
                              ? "score-high-bg"
                              : score > 0.25
                                ? "score-mid-bg"
                                : "score-low-bg";

                          return (
                            <div
                              key={i}
                              className="vector-result-card animate-in"
                              style={{ animationDelay: `${i * 0.05}s` }}
                            >
                              <div className="result-card-header">
                                <div className="result-id-badge">
                                  {res.article_id}
                                </div>
                                <div className="result-score-container">
                                  <div
                                    className={`score-value ${scoreColorClass}`}
                                  >
                                    {scorePct}% Match
                                  </div>
                                  <div className="score-bar-container">
                                    <div
                                      className={`score-bar-fill ${scoreBgClass}`}
                                      style={{ width: `${scorePct}%` }}
                                    ></div>
                                  </div>
                                </div>
                              </div>
                              <div
                                className="result-title"
                                style={{
                                  fontSize: "14px",
                                  fontWeight: 600,
                                  color: "var(--accent-blue)",
                                  marginBottom: "8px",
                                }}
                              >
                                {res.type === "clause"
                                  ? `${res.article_title || "N/A"} - Khoản ${res.clause_number || "?"}`
                                  : res.title ||
                                    `Điều ${res.article_number || "?"}`}
                              </div>
                              <div className="result-content">
                                {res.content}
                              </div>
                              <div className="result-actions">
                                <button
                                  className="btn-ghost"
                                  onClick={() => setPreviewArticle(res)}
                                >
                                  <i className="fas fa-external-link-alt"></i>{" "}
                                  View Article
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="placeholder-text">
                        {vectorLoading
                          ? "Đang tìm kiếm..."
                          : "Kết quả sẽ hiển thị tại đây..."}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      case "settings":
        return (
          <div className="view-section" key="settings">
            <div className="view-header">
              <h2>Cấu hình hệ thống</h2>
            </div>
            <div className="card">
              <div className="card-body">
                <form
                  className="settings-form"
                  onSubmit={(e) => e.preventDefault()}
                >
                  <div className="form-group">
                    <label>Đường dẫn Database Graph</label>
                    <input type="text" value="/storage/graph.cgraph" readOnly />
                  </div>
                  <div className="form-group">
                    <label>Chế độ hiển thị đồ thị của Client</label>
                    <select
                      value={tempClientGraphMode}
                      onChange={(e) => setTempClientGraphMode(e.target.value)}
                    >
                      <option value="query">Kết quả Truy vấn (Mặc định)</option>
                      <option value="explorer">Đồ thị Tổng thể (Sigma)</option>
                    </select>
                    <small className="text-muted">
                      Thay đổi cách hiển thị đồ thị bên ứng dụng người dùng.
                    </small>
                  </div>
                  <div className="form-group">
                    <label>Loại Vector Store</label>
                    <select
                      value={tempVectorStoreType || "congraph"}
                      onChange={(e) => setTempVectorStoreType(e.target.value)}
                    >
                      <option value="congraph">ConGraphDB (Khuyên dùng)</option>
                      <option value="lancedb">LanceDB</option>
                    </select>
                    <small className="text-muted">
                      {tempVectorStoreType !== config?.vectorStoreType
                        ? "⚠️ Thay đổi này sẽ có hiệu lực sau khi khởi động lại server."
                        : "Lưu ý: Chuyển đổi loại Vector Store sẽ yêu cầu xây dựng lại chỉ mục vector."}
                    </small>
                  </div>
                  <div className="form-group">
                    <label>Model Embedding</label>
                    <input
                      type="text"
                      value={
                        config?.embeddingModel ||
                        "paraphrase-multilingual-MiniLM-L12-v2"
                      }
                      readOnly
                    />
                  </div>
                  <div className="form-group">
                    <label>Hệ thống Embedding (Backend)</label>
                    <input
                      type="text"
                      value={
                        config?.embeddingBackend === "api"
                          ? "Python API (FastAPI)"
                          : "WebAssembly (transformers.js)"
                      }
                      readOnly
                    />
                    <small className="text-muted">
                      {config?.embeddingBackend === "api"
                        ? "🚀 Đang sử dụng Python service cho hiệu suất cao."
                        : "🐢 Đang sử dụng WebAssembly chạy tại Node.js (Chậm hơn)."}
                    </small>
                  </div>
                  <div className="form-group">
                    <label>Kích thước Vector</label>
                    <input
                      type="text"
                      value={config?.embeddingDimension || 384}
                      readOnly
                    />
                  </div>
                  <div className="form-group">
                    <label>Model LLM sử dụng</label>
                    <select value={config?.llmModel || "gpt-4o"}>
                      <option value="gpt-4o">GPT-4o (Khuyên dùng)</option>
                    </select>
                  </div>
                  <div className="form-actions">
                    <button className="btn-primary" onClick={handleSaveConfig}>
                      Lưu cấu hình
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        );
      case "knowledge":
        return (
          <div className="view-section" key="knowledge">
            <div className="view-header">
              <h2>Quản lý Tri thức (Knowledge Management)</h2>
              <div className="header-actions">
                <button
                  className="btn-secondary"
                  onClick={() => {
                    fetchStats();
                    fetchGraphData();
                  }}
                >
                  <i className="fas fa-sync-alt"></i> Làm mới dữ liệu
                </button>
              </div>
            </div>

            <div className="tabs-navigation">
              <button
                className={`tab-btn ${knowledgeTab === "generals" ? "active" : ""}`}
                onClick={() => setKnowledgeTab("generals")}
              >
                <i className="fas fa-info-circle"></i> Generals tab
              </button>
              <button
                className={`tab-btn ${knowledgeTab === "graphs" ? "active" : ""}`}
                onClick={() => setKnowledgeTab("graphs")}
              >
                <i className="fas fa-project-diagram"></i> View all graphs tab
              </button>
              <button
                className={`tab-btn ${knowledgeTab === "relations" ? "active" : ""}`}
                onClick={() => setKnowledgeTab("relations")}
              >
                <i className="fas fa-link"></i> Bản đồ quan hệ (Relations)
              </button>
              <button
                className={`tab-btn ${knowledgeTab === "nodes" ? "active" : ""}`}
                onClick={() => setKnowledgeTab("nodes")}
              >
                <i className="fas fa-circle-nodes"></i> Danh sách nút (Nodes)
              </button>
            </div>

            {knowledgeTab === "generals" && (
              <div className="animate-zoom">
                <div className="card" style={{ marginBottom: "24px" }}>
                  <div className="card-header">
                    <h2>Trạng thái dữ liệu hiện tại</h2>
                  </div>
                  <div className="card-body">
                    <div
                      className="stats-grid"
                      style={{
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(200px, 1fr))",
                        gap: "16px",
                        marginBottom: 0,
                      }}
                    >
                      <div className="stat-card mini purple">
                        <div className="stat-mini-info">
                          <span className="label">Tổng số Phân</span>
                          <span className="value">
                            {stats?.graph?.Part || 0}
                          </span>
                        </div>
                        <div className="mini-icon">
                          <i className="fas fa-layer-group"></i>
                        </div>
                      </div>
                      <div className="stat-card mini blue">
                        <div className="stat-mini-info">
                          <span className="label">Chương</span>
                          <span className="value">
                            {stats?.graph?.Chapter || 0}
                          </span>
                        </div>
                        <div className="mini-icon">
                          <i className="fas fa-book"></i>
                        </div>
                      </div>
                      <div className="stat-card mini green">
                        <div className="stat-mini-info">
                          <span className="label">Điều luật</span>
                          <span className="value">
                            {stats?.graph?.Article || 0}
                          </span>
                        </div>
                        <div className="mini-icon">
                          <i className="fas fa-gavel"></i>
                        </div>
                      </div>
                      <div className="stat-card mini orange">
                        <div className="stat-mini-info">
                          <span className="label">Khoản</span>
                          <span className="value">
                            {stats?.graph?.Clause || 0}
                          </span>
                        </div>
                        <div className="mini-icon">
                          <i className="fas fa-list-ol"></i>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card" style={{ marginBottom: "24px" }}>
                  <div className="card-header">
                    <h2>Thêm mới dữ liệu pháp luật</h2>
                  </div>
                  <div
                    className="card-body"
                    style={{
                      display: "flex",
                      gap: "24px",
                      alignItems: "center",
                    }}
                  >
                    <div
                      className="upload-container"
                      style={{ flex: 1, padding: "20px" }}
                    >
                      <div
                        className="upload-icon"
                        style={{ fontSize: "32px", marginBottom: "10px" }}
                      >
                        <i className="fas fa-cloud-upload-alt"></i>
                      </div>
                      <h3>Kéo thả hoặc chọn tệp JSON</h3>
                      <p style={{ fontSize: "12px" }}>
                        Hỗ trợ tệp định dạng .json theo cấu trúc dữ liệu
                        VinaLegal
                      </p>

                      <label
                        className="btn-primary"
                        style={{
                          cursor: "pointer",
                          display: "inline-block",
                          marginTop: "15px",
                        }}
                      >
                        <i className="fas fa-file-import"></i> Chọn tệp dữ liệu
                        <input
                          type="file"
                          accept=".json"
                          onChange={handleFileUpload}
                          style={{ display: "none" }}
                        />
                      </label>

                      {uploadLoading && (
                        <div style={{ marginTop: "15px" }}>
                          <div
                            className="spinner"
                            style={{
                              margin: "0 auto 10px",
                              width: "20px",
                              height: "20px",
                            }}
                          ></div>
                          <p style={{ fontSize: "13px" }}>{uploadMessage}</p>
                        </div>
                      )}

                      {!uploadLoading && uploadMessage && (
                        <div
                          style={{
                            marginTop: "15px",
                            padding: "8px 12px",
                            borderRadius: "8px",
                            fontSize: "13px",
                            background: uploadMessage.startsWith("Thành công")
                              ? "rgba(16, 185, 129, 0.1)"
                              : "rgba(239, 68, 68, 0.1)",
                            color: uploadMessage.startsWith("Thành công")
                              ? "#10b981"
                              : "#ef4444",
                            border: `1px solid ${uploadMessage.startsWith("Thành công") ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)"}`,
                          }}
                        >
                          {uploadMessage}
                        </div>
                      )}
                    </div>

                    <div
                      className="info-box"
                      style={{ flex: 1, height: "100%", margin: 0 }}
                    >
                      <h4 style={{ fontSize: "14px", marginBottom: "10px" }}>
                        <i className="fas fa-info-circle"></i> Hướng dẫn
                      </h4>
                      <ul style={{ fontSize: "13px", lineHeight: "1.6" }}>
                        <li>
                          Dữ liệu sau khi tải lên sẽ được tự động cập nhật vào
                          Knowledge Graph và Vector Store.
                        </li>
                        <li>
                          Hệ thống sẽ thực hiện phân tích cấu trúc
                          Điều/Khoản/Điểm và các mối quan hệ tham chiếu.
                        </li>
                        <li>
                          Dữ liệu mới sẽ khả dụng cho cả tìm kiếm đồ thị và tìm
                          kiếm ngữ nghĩa ngay lập tức.
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {knowledgeTab === "graphs" && (
              <div
                className={`card ${isFullScreen ? "graph-fullscreen animate-zoom" : "animate-zoom"}`}
                style={{ marginTop: "20px" }}
              >
                <div className="card-header">
                  <h2>Visual Graph Explorer (Sigma v3)</h2>
                  <div className="header-actions">
                    <button
                      className="btn-small"
                      title="Full Screen"
                      onClick={() => setIsFullScreen(!isFullScreen)}
                    >
                      <i
                        className={`fas ${isFullScreen ? "fa-compress" : "fa-expand"}`}
                      ></i>
                    </button>
                    <button
                      className="btn-small"
                      title="Tải lại đồ thị"
                      onClick={fetchGraphData}
                    >
                      <i className="fas fa-sync-alt"></i>
                    </button>
                  </div>
                </div>
                <div
                  className="card-body"
                  style={{
                    overflow: "hidden",
                    position: "relative",
                    display: "flex",
                    height: isFullScreen ? "calc(100vh - 120px)" : "600px",
                  }}
                >
                  <div
                    className="graph-loading-overlay"
                    style={{
                      display: !graphData ? "flex" : "none",
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      zIndex: 100,
                      background: "rgba(13, 17, 23, 0.8)",
                      backdropFilter: "blur(4px)",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <div className="spinner"></div>
                    <p>Đang tải dữ liệu đồ thị...</p>
                  </div>

                  <SigmaGraphVisualization
                    data={graphData}
                    visibleTypes={visibleTypes}
                    visibleEdgeTypes={visibleEdgeTypes}
                    setSelectedNode={setSelectedNode}
                  />

                  {selectedNode && (
                    <div className="graph-sidebar">
                      <div className="sidebar-header">
                        <span
                          className={`type-tag ${selectedNode.type.toLowerCase()}`}
                        >
                          {selectedNode.type}
                        </span>
                        <button
                          className="btn-close"
                          onClick={() => setSelectedNode(null)}
                        >
                          <i className="fas fa-times"></i>
                        </button>
                      </div>
                      <div className="sidebar-content">
                        <h3>{selectedNode.label}</h3>
                        <div className="meta-info">
                          <p>
                            <strong>ID:</strong> {selectedNode.id}
                          </p>
                        </div>
                        <div className="node-description">
                          <p>
                            Thông tin chi tiết về đối tượng pháp lý này sẽ được
                            hiển thị tại đây.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div
                    className="graph-legend"
                    style={{
                      position: "absolute",
                      top: "20px",
                      left: "20px",
                      background: "rgba(13, 17, 23, 0.7)",
                      backdropFilter: "blur(4px)",
                      padding: "12px 16px",
                      borderRadius: "8px",
                      zIndex: 5,
                      border: "1px solid rgba(255,255,255,0.05)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px",
                      maxWidth: "420px",
                    }}
                  >
                    <div style={{ display: "flex", gap: "24px" }}>
                      {/* Column 1: Nodes */}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            color: "#94a3b8",
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                            marginBottom: "4px",
                          }}
                        >
                          Nodes
                        </div>
                        {[
                          "Part",
                          "Chapter",
                          "Section",
                          "Subsection",
                          "Article",
                          "Clause",
                          "ClausePoint",
                        ].map((type) => (
                          <label
                            key={type}
                            className="legend-item"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              cursor: "pointer",
                              gap: "8px",
                              fontSize: "12px",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={visibleTypes.includes(type)}
                              onChange={() => toggleTypeVisibility(type)}
                              style={{ accentColor: "var(--accent-blue)" }}
                            />
                            <span
                              className={`color ${type.toLowerCase()}`}
                            ></span>
                            {type} (
                            {graphTypeCounts[
                              type as keyof typeof graphTypeCounts
                            ] || 0}
                            )
                          </label>
                        ))}
                      </div>

                      {/* Column 2: Edges */}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            color: "#94a3b8",
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                            marginBottom: "4px",
                          }}
                        >
                          Edges
                        </div>
                        {[
                          "HAS_CHAPTER",
                          "HAS_SECTION",
                          "HAS_SUBSECTION",
                          "BELONGS_TO_SUBSECTION",
                          "BELONGS_TO_SECTION",
                          "BELONGS_TO_CHAPTER",
                          "HAS_CLAUSE",
                          "HAS_POINT",
                        ].map((type) => (
                          <label
                            key={type}
                            className="legend-item"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              cursor: "pointer",
                              gap: "8px",
                              fontSize: "12px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={visibleEdgeTypes.includes(type)}
                              onChange={() => toggleEdgeTypeVisibility(type)}
                              style={{ accentColor: "var(--accent-purple)" }}
                            />
                            <span
                              style={{
                                width: "12px",
                                height: "2px",
                                background: "rgba(255,255,255,0.4)",
                                borderRadius: "1px",
                              }}
                            ></span>
                            {type} (
                            {graphEdgeCounts[
                              type as keyof typeof graphEdgeCounts
                            ] || 0}
                            )
                          </label>
                        ))}
                      </div>
                    </div>

                    <div
                      style={{
                        marginTop: "4px",
                        paddingTop: "8px",
                        borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                        fontSize: "11px",
                        color: "#94a3b8",
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "12px",
                        }}
                      >
                        <span>Visible nodes:</span>
                        <strong style={{ color: "#f8fafc" }}>
                          {visibleNodesCount}
                        </strong>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "12px",
                        }}
                      >
                        <span>Visible edges:</span>
                        <strong style={{ color: "#f8fafc" }}>
                          {visibleEdgesCount}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {knowledgeTab === "relations" && (
              <div
                className="animate-zoom"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "24px",
                }}
              >
                {/* Top Section: Analytics & Leaderboards */}
                <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
                  <div className="card" style={{ flex: 1, minWidth: "300px" }}>
                    <div className="card-header">
                      <h2>
                        <i
                          className="fas fa-arrow-down"
                          style={{ color: "var(--accent-blue)" }}
                        ></i>{" "}
                        Top Điều luật được dẫn chiếu nhiều nhất
                      </h2>
                    </div>
                    <div className="card-body" style={{ padding: "16px 20px" }}>
                      <ul
                        style={{
                          listStyle: "none",
                          padding: 0,
                          margin: 0,
                          display: "flex",
                          flexDirection: "column",
                          gap: "12px",
                        }}
                      >
                        {relationsLeaderboard?.topReferenced?.map(
                          (item: RelationLeaderboardItem, idx: number) => (
                            <li
                              key={item.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                paddingBottom: "10px",
                                borderBottom:
                                  "1px solid rgba(255,255,255,0.05)",
                              }}
                            >
                              <span
                                onClick={() => setSelectedRelationNode(item.id)}
                                style={{
                                  color: "#3b82f6",
                                  cursor: "pointer",
                                  fontWeight: 500,
                                  fontSize: "14px",
                                }}
                                title="Click để trực quan hóa đồ thị liên kết"
                              >
                                {idx + 1}. {item.title}
                              </span>
                              <span
                                className="badge-dim"
                                style={{
                                  padding: "4px 8px",
                                  fontSize: "11px",
                                  fontWeight: "bold",
                                }}
                              >
                                {item.count} lượt
                              </span>
                            </li>
                          ),
                        )}
                      </ul>
                    </div>
                  </div>

                  <div className="card" style={{ flex: 1, minWidth: "300px" }}>
                    <div className="card-header">
                      <h2>
                        <i
                          className="fas fa-arrow-up"
                          style={{ color: "var(--accent-purple)" }}
                        ></i>{" "}
                        Top Điều luật dẫn chiếu đi nhiều nhất
                      </h2>
                    </div>
                    <div className="card-body" style={{ padding: "16px 20px" }}>
                      <ul
                        style={{
                          listStyle: "none",
                          padding: 0,
                          margin: 0,
                          display: "flex",
                          flexDirection: "column",
                          gap: "12px",
                        }}
                      >
                        {relationsLeaderboard?.topReferring?.map(
                          (item: RelationLeaderboardItem, idx: number) => (
                            <li
                              key={item.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                paddingBottom: "10px",
                                borderBottom:
                                  "1px solid rgba(255,255,255,0.05)",
                              }}
                            >
                              <span
                                onClick={() => setSelectedRelationNode(item.id)}
                                style={{
                                  color: "#a78bfa",
                                  cursor: "pointer",
                                  fontWeight: 500,
                                  fontSize: "14px",
                                }}
                                title="Click để trực quan hóa đồ thị liên kết"
                              >
                                {idx + 1}. {item.title}
                              </span>
                              <span
                                className="badge-dim"
                                style={{
                                  padding: "4px 8px",
                                  fontSize: "11px",
                                  fontWeight: "bold",
                                }}
                              >
                                {item.count} lượt
                              </span>
                            </li>
                          ),
                        )}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Bottom Section: Search/Table */}
                <div style={{ width: "100%" }}>
                  {/* Registry Table */}
                  <div className="card" style={{ width: "100%" }}>
                    <div
                      className="card-header"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "16px",
                        flexWrap: "wrap",
                      }}
                    >
                      <h2>
                        Danh sách quan hệ chi tiết ({relationsTotalItems} liên
                        kết)
                      </h2>
                      <div
                        className="header-actions"
                        style={{
                          display: "flex",
                          gap: "12px",
                          alignItems: "center",
                        }}
                      >
                        {/* Search and Filters */}
                        <div style={{ position: "relative" }}>
                          <input
                            type="text"
                            placeholder="Tìm ID, tên nút, nội dung..."
                            value={tempRelationsSearch}
                            onChange={(e) =>
                              setTempRelationsSearch(e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                setRelationsSearch(tempRelationsSearch);
                                setRelationsPage(1);
                              }
                            }}
                            style={{
                              background: "rgba(255,255,255,0.05)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              borderRadius: "6px",
                              padding: "6px 12px 6px 30px",
                              color: "#fff",
                              fontSize: "13px",
                            }}
                          />
                          <i
                            className="fas fa-search"
                            style={{
                              position: "absolute",
                              left: "10px",
                              top: "50%",
                              transform: "translateY(-50%)",
                              fontSize: "12px",
                              color: "rgba(255,255,255,0.4)",
                            }}
                          ></i>
                        </div>
                        <select
                          value={relationsType}
                          onChange={(e) => {
                            setRelationsType(e.target.value);
                            setRelationsPage(1);
                          }}
                          style={{
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(255,255,255,0.15)",
                            borderRadius: "6px",
                            padding: "6px 12px",
                            color: "#fff",
                            fontSize: "13px",
                            cursor: "pointer",
                            outline: "none",
                          }}
                        >
                          <option value="all">Tất cả liên kết</option>
                          <option value="REFERENCES">
                            REFERENCES (Tham chiếu)
                          </option>
                          <option value="NEXT_ARTICLE">
                            NEXT_ARTICLE (Tuần tự)
                          </option>
                          <option value="BELONGS_TO_CHAPTER">
                            BELONGS_TO_CHAPTER
                          </option>
                          <option value="BELONGS_TO_SECTION">
                            BELONGS_TO_SECTION
                          </option>
                          <option value="BELONGS_TO_SUBSECTION">
                            BELONGS_TO_SUBSECTION
                          </option>
                          <option value="HAS_CHAPTER">HAS_CHAPTER</option>
                          <option value="HAS_SECTION">HAS_SECTION</option>
                          <option value="HAS_SUBSECTION">HAS_SUBSECTION</option>
                          <option value="HAS_CLAUSE">HAS_CLAUSE</option>
                          <option value="HAS_POINT">HAS_POINT</option>
                        </select>
                        <button
                          className="btn-primary"
                          style={{ padding: "6px 12px" }}
                          onClick={() => {
                            setRelationsSearch(tempRelationsSearch);
                            setRelationsPage(1);
                          }}
                        >
                          Lọc
                        </button>
                      </div>
                    </div>
                    <div className="card-body">
                      {relationsLoading ? (
                        <div className="loading-placeholder">
                          <div className="spinner"></div>
                          <p>Đang tải danh sách quan hệ...</p>
                        </div>
                      ) : (
                        <>
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>Nguồn (Source)</th>
                                <th>Loại quan hệ</th>
                                <th>Đích (Target)</th>
                                <th>Chi tiết / Nội dung</th>
                                <th>Hành động</th>
                              </tr>
                            </thead>
                            <tbody>
                              {relations.length > 0 ? (
                                relations.map((rel) => (
                                  <tr
                                    key={rel.id}
                                    style={{
                                      background:
                                        selectedRelationNode === rel.sourceId ||
                                        selectedRelationNode === rel.targetId
                                          ? "rgba(59, 130, 246, 0.08)"
                                          : "transparent",
                                    }}
                                  >
                                    <td>
                                      <div
                                        style={{
                                          display: "flex",
                                          flexDirection: "column",
                                        }}
                                      >
                                        <strong style={{ fontSize: "13px" }}>
                                          {rel.sourceLabel}
                                        </strong>
                                        <span
                                          className="type-tag node"
                                          style={{
                                            fontSize: "10px",
                                            marginTop: "2px",
                                            width: "fit-content",
                                          }}
                                        >
                                          {rel.sourceType}
                                        </span>
                                      </div>
                                    </td>
                                    <td>
                                      <span
                                        className="type-tag edge"
                                        style={{
                                          fontSize: "11px",
                                          textTransform: "none",
                                        }}
                                      >
                                        {rel.type}
                                      </span>
                                    </td>
                                    <td>
                                      <div
                                        style={{
                                          display: "flex",
                                          flexDirection: "column",
                                        }}
                                      >
                                        <strong style={{ fontSize: "13px" }}>
                                          {rel.targetLabel}
                                        </strong>
                                        <span
                                          className="type-tag node"
                                          style={{
                                            fontSize: "10px",
                                            marginTop: "2px",
                                            width: "fit-content",
                                          }}
                                        >
                                          {rel.targetType}
                                        </span>
                                      </div>
                                    </td>
                                    <td
                                      style={{
                                        maxWidth: "250px",
                                        fontSize: "12px",
                                        color: "#94a3b8",
                                      }}
                                    >
                                      {rel.reference_text && (
                                        <div>
                                          <strong>Nội dung:</strong>{" "}
                                          {rel.reference_text}
                                        </div>
                                      )}
                                      {rel.context && (
                                        <div
                                          style={{
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                          }}
                                          title={rel.context}
                                        >
                                          <strong>Ngữ cảnh:</strong>{" "}
                                          {rel.context}
                                        </div>
                                      )}
                                      {!rel.reference_text &&
                                        !rel.context &&
                                        "-"}
                                    </td>
                                    <td>
                                      <div
                                        style={{ display: "flex", gap: "6px" }}
                                      >
                                        <button
                                          className="btn-small"
                                          onClick={() =>
                                            setSelectedRelationNode(
                                              rel.sourceId,
                                            )
                                          }
                                          title="Xem đồ thị cục bộ của Nguồn"
                                          style={{
                                            padding: "4px 8px",
                                            fontSize: "11px",
                                          }}
                                        >
                                          <i className="fas fa-eye"></i> Nguồn
                                        </button>
                                        <button
                                          className="btn-small"
                                          onClick={() =>
                                            setSelectedRelationNode(
                                              rel.targetId,
                                            )
                                          }
                                          title="Xem đồ thị cục bộ của Đích"
                                          style={{
                                            padding: "4px 8px",
                                            fontSize: "11px",
                                          }}
                                        >
                                          <i className="fas fa-eye"></i> Đích
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td
                                    colSpan={5}
                                    style={{
                                      textAlign: "center",
                                      color: "#64748b",
                                      padding: "30px",
                                    }}
                                  >
                                    Không tìm thấy mối quan hệ nào khớp với bộ
                                    lọc.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>

                          {/* Pagination Controls */}
                          {relationsTotalPages > 1 && (
                            <div
                              className="pagination"
                              style={{
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                gap: "12px",
                                marginTop: "20px",
                              }}
                            >
                              <button
                                className="btn-secondary"
                                disabled={relationsPage === 1}
                                onClick={() =>
                                  setRelationsPage((p) => Math.max(p - 1, 1))
                                }
                                style={{
                                  padding: "4px 10px",
                                  fontSize: "12px",
                                }}
                              >
                                <i className="fas fa-chevron-left"></i> Trước
                              </button>
                              <span
                                style={{ fontSize: "13px", color: "#94a3b8" }}
                              >
                                Trang <strong>{relationsPage}</strong> /{" "}
                                {relationsTotalPages} (Tổng{" "}
                                {relationsTotalItems})
                              </span>
                              <button
                                className="btn-secondary"
                                disabled={relationsPage === relationsTotalPages}
                                onClick={() =>
                                  setRelationsPage((p) =>
                                    Math.min(p + 1, relationsTotalPages),
                                  )
                                }
                                style={{
                                  padding: "4px 10px",
                                  fontSize: "12px",
                                }}
                              >
                                Sau <i className="fas fa-chevron-right"></i>
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {knowledgeTab === "nodes" && (
              <div
                className="animate-zoom"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "24px",
                }}
              >
                <div style={{ width: "100%" }}>
                  <div className="card" style={{ width: "100%" }}>
                    <div
                      className="card-header"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "16px",
                        flexWrap: "wrap",
                      }}
                    >
                      <h2>
                        Danh sách nút trong đồ thị ({processedNodes.length} nút)
                      </h2>
                      <div
                        className="header-actions"
                        style={{
                          display: "flex",
                          gap: "12px",
                          alignItems: "center",
                        }}
                      >
                        <div style={{ position: "relative" }}>
                          <input
                            type="text"
                            placeholder="Tìm tên nút, ID..."
                            value={tempNodesSearch}
                            onChange={(e) => setTempNodesSearch(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                setNodesSearch(tempNodesSearch);
                                setNodesPage(1);
                              }
                            }}
                            style={{
                              background: "rgba(255,255,255,0.05)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              borderRadius: "6px",
                              padding: "6px 12px 6px 30px",
                              color: "#fff",
                              fontSize: "13px",
                            }}
                          />
                          <i
                            className="fas fa-search"
                            style={{
                              position: "absolute",
                              left: "10px",
                              top: "50%",
                              transform: "translateY(-50%)",
                              fontSize: "12px",
                              color: "rgba(255,255,255,0.4)",
                            }}
                          ></i>
                        </div>
                        <select
                          value={nodesType}
                          onChange={(e) => {
                            setNodesType(e.target.value);
                            setNodesPage(1);
                          }}
                          style={{
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(255,255,255,0.15)",
                            borderRadius: "6px",
                            padding: "6px 12px",
                            color: "#fff",
                            fontSize: "13px",
                            cursor: "pointer",
                            outline: "none",
                          }}
                        >
                          <option value="all">Tất cả loại nút</option>
                          <option value="Part">Part (Phần)</option>
                          <option value="Chapter">Chapter (Chương)</option>
                          <option value="Section">Section (Mục)</option>
                          <option value="Subsection">
                            Subsection (Tiểu mục)
                          </option>
                          <option value="Article">Article (Điều)</option>
                          <option value="Clause">Clause (Khoản)</option>
                          <option value="ClausePoint">
                            ClausePoint (Điểm)
                          </option>
                        </select>
                        <button
                          className="btn-primary"
                          style={{ padding: "6px 12px" }}
                          onClick={() => {
                            setNodesSearch(tempNodesSearch);
                            setNodesPage(1);
                          }}
                        >
                          Lọc
                        </button>
                      </div>
                    </div>
                    <div className="card-body">
                      {!graphData ? (
                        <div className="loading-placeholder">
                          <div className="spinner"></div>
                          <p>Đang tải danh sách nút...</p>
                        </div>
                      ) : (
                        <>
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th style={{ width: "15%" }}>ID Nút</th>
                                <th style={{ width: "15%" }}>Loại Nút</th>
                                <th>Tên / Nhãn Nút</th>
                                <th
                                  style={{ width: "15%", textAlign: "center" }}
                                >
                                  Số liên kết (Degree)
                                </th>
                                <th style={{ width: "15%" }}>Hành động</th>
                              </tr>
                            </thead>
                            <tbody>
                              {paginatedNodes.length > 0 ? (
                                paginatedNodes.map((node) => (
                                  <tr
                                    key={node.id}
                                    style={{
                                      background:
                                        selectedRelationNode === node.id
                                          ? "rgba(59, 130, 246, 0.08)"
                                          : "transparent",
                                    }}
                                  >
                                    <td>
                                      <code
                                        style={{
                                          fontSize: "11px",
                                          color: "var(--text-dim)",
                                        }}
                                      >
                                        {node.id}
                                      </code>
                                    </td>
                                    <td>
                                      <span
                                        className={`type-tag node ${node.type.toLowerCase()}`}
                                        style={{
                                          fontSize: "10px",
                                          width: "fit-content",
                                        }}
                                      >
                                        {node.type}
                                      </span>
                                    </td>
                                    <td>
                                      <strong
                                        style={{
                                          fontSize: "13px",
                                          color: "var(--text-main)",
                                        }}
                                      >
                                        {node.label}
                                      </strong>
                                    </td>
                                    <td style={{ textAlign: "center" }}>
                                      <span
                                        className="badge-dim"
                                        style={{
                                          padding: "4px 8px",
                                          fontSize: "11px",
                                          fontWeight: "bold",
                                        }}
                                      >
                                        {node.degree} liên kết
                                      </span>
                                    </td>
                                    <td>
                                      <button
                                        className="btn-small"
                                        onClick={() =>
                                          setSelectedRelationNode(node.id)
                                        }
                                        title="Xem đồ thị cục bộ (Ego-Graph) của nút này"
                                        style={{
                                          padding: "4px 8px",
                                          fontSize: "11px",
                                        }}
                                      >
                                        <i className="fas fa-eye"></i> Xem
                                        Ego-Graph
                                      </button>
                                    </td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td
                                    colSpan={5}
                                    style={{
                                      textAlign: "center",
                                      color: "#64748b",
                                      padding: "30px",
                                    }}
                                  >
                                    Không tìm thấy nút nào khớp với bộ lọc.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>

                          {/* Pagination Controls */}
                          {nodesTotalPages > 1 && (
                            <div
                              className="pagination"
                              style={{
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                gap: "12px",
                                marginTop: "20px",
                              }}
                            >
                              <button
                                className="btn-secondary"
                                disabled={nodesPage === 1}
                                onClick={() =>
                                  setNodesPage((p) => Math.max(p - 1, 1))
                                }
                                style={{
                                  padding: "4px 10px",
                                  fontSize: "12px",
                                }}
                              >
                                <i className="fas fa-chevron-left"></i> Trước
                              </button>
                              <span
                                style={{ fontSize: "13px", color: "#94a3b8" }}
                              >
                                Trang <strong>{nodesPage}</strong> /{" "}
                                {nodesTotalPages} (Tổng {processedNodes.length})
                              </span>
                              <button
                                className="btn-secondary"
                                disabled={nodesPage === nodesTotalPages}
                                onClick={() =>
                                  setNodesPage((p) =>
                                    Math.min(p + 1, nodesTotalPages),
                                  )
                                }
                                style={{
                                  padding: "4px 10px",
                                  fontSize: "12px",
                                }}
                              >
                                Sau <i className="fas fa-chevron-right"></i>
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Ego-Graph Modal popup */}
            {selectedRelationNode && (
              <div
                className="modal-overlay"
                onClick={() => setSelectedRelationNode(null)}
              >
                <div
                  className="modal-content admin-modal glass-card animate-zoom"
                  style={{ maxWidth: "1000px", height: "80vh" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="modal-header">
                    <div className="modal-title-group">
                      <span
                        className="type-tag edge"
                        style={{
                          background: "rgba(59, 130, 246, 0.15)",
                          color: "#60a5fa",
                          border: "1px solid rgba(59, 130, 246, 0.3)",
                        }}
                      >
                        Ego-Graph
                      </span>
                      <h2>
                        Trực quan hóa cục bộ:{" "}
                        {graphData?.nodes?.find(
                          (n) => n.id === selectedRelationNode,
                        )?.label || selectedRelationNode}
                      </h2>
                    </div>
                    <button
                      className="btn-close-lg"
                      onClick={() => setSelectedRelationNode(null)}
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  </div>
                  <div
                    className="modal-body"
                    style={{
                      position: "relative",
                      padding: 0,
                      overflow: "hidden",
                      flex: 1,
                      width: "100%",
                      height: "100%",
                    }}
                  >
                    {relationsModalReady ? (
                      <GraphVisualization
                        data={computeEgoGraph(selectedRelationNode)}
                        layout="concentric"
                        visibleTypes={visibleTypes}
                        setSelectedNode={(node) => {
                          if (node) setSelectedRelationNode(node.id);
                        }}
                        setZoomLevel={setZoomLevel}
                        onRenderingChange={() => {}}
                        onInit={() => {}}
                      />
                    ) : (
                      <div
                        className="loading-placeholder"
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "100%",
                          height: "100%",
                        }}
                      >
                        <div className="spinner"></div>
                        <p
                          style={{
                            marginTop: "10px",
                            fontSize: "14px",
                            color: "var(--text-dim)",
                          }}
                        >
                          Đang tính toán sơ đồ liên kết cục bộ...
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      case "activities":
        return (
          <div className="view-section" key="activities">
            <div className="view-header">
              <h2>Nhật ký hoạt động</h2>
              <button className="btn-primary" onClick={fetchActivities}>
                <i className="fas fa-sync-alt"></i> Tải lại nhật ký
              </button>
            </div>

            <div className="card full-width" style={{ marginTop: "20px" }}>
              <div
                className="card-header"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <h2>Danh sách hoạt động gần đây</h2>
                <span className="badge-dim">{activities.length} sự kiện</span>
              </div>
              <div className="card-body">
                <ul className="activity-list">
                  {activities.length > 0 ? (
                    activities.map((activity) => (
                      <li
                        className="activity-item"
                        key={activity.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "16px 0",
                          borderBottom: "1px solid rgba(255,255,255,0.05)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            flex: 1,
                          }}
                        >
                          <div
                            className={`activity-marker ${activity.type === "query" ? "blue" : activity.type === "error" ? "red" : activity.type === "system" ? "purple" : "green"}`}
                          ></div>
                          <div
                            className="activity-details"
                            style={{ marginLeft: "12px" }}
                          >
                            <p style={{ margin: 0, fontWeight: 500 }}>
                              {activity.message}
                            </p>
                            <span
                              style={{
                                fontSize: "0.8rem",
                                color: "var(--text-dim)",
                              }}
                            >
                              {new Date(activity.timestamp).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        <div
                          className="activity-actions"
                          style={{ display: "flex", gap: "8px" }}
                        >
                          {activity.details && (
                            <>
                              <button
                                className="btn-small"
                                style={{
                                  background: "rgba(16, 185, 129, 0.15)",
                                  color: "#10b981",
                                  border: "1px solid rgba(16, 185, 129, 0.3)",
                                }}
                                title="Xem cấu trúc dữ liệu JSON pipeline trong tab mới"
                                onClick={() => handleOpenActivityJSON(activity)}
                              >
                                <i
                                  className="fas fa-external-link-alt"
                                  style={{ marginRight: "4px" }}
                                ></i>{" "}
                                Xem JSON
                              </button>
                              <button
                                className="btn-small btn-secondary"
                                title="Tải xuống tệp tin pipeline định dạng JSON"
                                onClick={() =>
                                  handleDownloadActivityJSON(activity)
                                }
                              >
                                <i
                                  className="fas fa-download"
                                  style={{ marginRight: "4px" }}
                                ></i>{" "}
                                Tải JSON
                              </button>
                            </>
                          )}
                        </div>
                      </li>
                    ))
                  ) : (
                    <li className="activity-item">
                      <div className="activity-marker gray"></div>
                      <div className="activity-details">
                        <p>Chưa có hoạt động nào được ghi nhận.</p>
                      </div>
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        );
      default:
        return <div>View {activeView} is under construction.</div>;
    }
  };

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="logo-container">
          <div className="logo-icon">
            <i className="fas fa-gavel"></i>
          </div>
          <div className="logo-text">
            <span className="logo-main">VinaLegal</span>
            <span className="logo-sub">Admin Dashboard</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          {[
            { id: "overview", icon: "fa-chart-line", label: "Tổng quan" },
            {
              id: "knowledge",
              icon: "fa-book-open",
              label: "Dữ liệu Tri thức",
            },
            {
              id: "community",
              icon: "fa-users-viewfinder",
              label: "Cộng đồng",
            },
            { id: "vector", icon: "fa-database", label: "Vector Store" },
            { id: "llm", icon: "fa-brain", label: "LLM Monitor" },
            {
              id: "activities",
              icon: "fa-history",
              label: "Nhật ký hoạt động",
            },
            { id: "settings", icon: "fa-cog", label: "Cấu hình" },
          ].map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={`nav-item ${activeView === item.id ? "active" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                setActiveView(item.id);
              }}
            >
              <i className={`fas ${item.icon}`}></i>
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="status-indicator">
            <span className="dot pulse"></span>
            <span>Hệ thống: {loading ? "Đang kiểm tra..." : "Trực tuyến"}</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-header">
          <div className="header-search">
            <i className="fas fa-search"></i>
            <input type="text" placeholder="Tìm kiếm tài liệu, điều luật..." />
          </div>
          <div className="header-actions">
            <button className="btn-icon">
              <i className="fas fa-bell"></i>
            </button>
            <div className="user-profile">
              <img
                src="https://ui-avatars.com/api/?name=Admin&background=0D8ABC&color=fff"
                alt="User"
              />
              <span>Quản trị viên</span>
            </div>
          </div>
        </header>

        <section className="dashboard-content">{renderView()}</section>
      </main>

      {/* Configuration Saved Modal */}
      {showConfigSavedModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowConfigSavedModal(false)}
        >
          <div
            className="modal-content glass-card animate-zoom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Xác nhận lưu cấu hình</h2>
              <button
                className="btn-close"
                onClick={() => setShowConfigSavedModal(false)}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="modal-body">
              {tempVectorStoreType !== config?.vectorStoreType ? (
                <>
                  <div
                    className="alert-warning"
                    style={{
                      background: "rgba(245, 158, 11, 0.1)",
                      border: "1px solid rgba(245, 158, 11, 0.3)",
                      borderRadius: "8px",
                      padding: "16px",
                      marginBottom: "16px",
                    }}
                  >
                    <i
                      className="fas fa-exclamation-triangle"
                      style={{ color: "#f59e0b", marginRight: "8px" }}
                    ></i>
                    <strong>Thay đổi được phát hiện!</strong>
                  </div>
                  <p style={{ marginBottom: "16px" }}>
                    Bạn đã thay đổi loại Vector Store từ{" "}
                    <strong>
                      {config?.vectorStoreType === "congraph"
                        ? "ConGraphDB"
                        : "LanceDB"}
                    </strong>{" "}
                    sang{" "}
                    <strong>
                      {tempVectorStoreType === "congraph"
                        ? "ConGraphDB"
                        : "LanceDB"}
                    </strong>
                    .
                  </p>
                  <p style={{ marginBottom: "16px" }}>
                    Để áp dụng thay đổi này, bạn cần:
                  </p>
                  <ol style={{ marginBottom: "16px", paddingLeft: "20px" }}>
                    <li>
                      Cập nhật biến môi nghiệp{" "}
                      <code>VECTOR_STORE_TYPE={tempVectorStoreType}</code>
                    </li>
                    <li>Khởi động lại server (npm run dev)</li>
                    <li>
                      Nếu chuyển sang ConGraphDB lần đầu: Chạy{" "}
                      <code>npm run build-index</code>
                    </li>
                  </ol>
                </>
              ) : (
                <>
                  <div
                    className="alert-success"
                    style={{
                      background: "rgba(16, 185, 129, 0.1)",
                      border: "1px solid rgba(16, 185, 129, 0.3)",
                      borderRadius: "8px",
                      padding: "16px",
                      marginBottom: "16px",
                    }}
                  >
                    <i
                      className="fas fa-check-circle"
                      style={{ color: "#10b981", marginRight: "8px" }}
                    ></i>
                    <strong>Cấu hình đã được xác nhận!</strong>
                  </div>
                  <p style={{ marginBottom: "16px" }}>
                    Cấu hình hiện tại của hệ thống đã được xác nhận. Không có
                    thay đổi nào được thực hiện.
                  </p>
                  <p style={{ marginBottom: "16px", opacity: 0.7 }}>
                    <small>
                      Lưu ý: Để thay đổi cấu hình hệ thống, vui lòng sửa file{" "}
                      <code>.env</code> hoặc biến môi trường và khởi động lại
                      server.
                    </small>
                  </p>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button
                className="btn-primary"
                onClick={() => setShowConfigSavedModal(false)}
              >
                Đã hiểu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Article Preview Modal */}
      {previewArticle && (
        <div className="modal-overlay" onClick={() => setPreviewArticle(null)}>
          <div
            className="modal-content glass-card animate-zoom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="result-id-badge">
                  {previewArticle.article_id}
                </span>
                <h2>
                  {previewArticle.title ||
                    `Điều ${previewArticle.article_number}`}
                </h2>
              </div>
              <button
                className="btn-close-lg"
                onClick={() => setPreviewArticle(null)}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="modal-body">
              <div className="article-full-content">
                {previewArticle.content}
              </div>

              <div className="modal-metadata-grid">
                <div className="meta-box">
                  <label>Phần (Part)</label>
                  <div>{previewArticle.part || "N/A"}</div>
                </div>
                <div className="meta-box">
                  <label>Chương (Chapter)</label>
                  <div>{previewArticle.chapter || "N/A"}</div>
                </div>
                <div className="meta-box">
                  <label>Từ khóa</label>
                  <div>{previewArticle.keywords || "None"}</div>
                </div>
                <div className="meta-box">
                  <label>Độ tương đồng</label>
                  <div className="score-value score-high">
                    {Math.round((1 - previewArticle._distance) * 100)}%
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn-primary"
                onClick={() => setPreviewArticle(null)}
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
