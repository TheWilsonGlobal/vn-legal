import { useEffect, useRef, useState } from "react";
import Sigma from "sigma";
import { MultiGraph } from "graphology";

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  [key: string]: unknown;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface SigmaGraphVisualizationProps {
  data: GraphData | null;
  visibleTypes: string[];
  visibleEdgeTypes: string[];
  setSelectedNode: (node: GraphNode | null) => void;
}

export function SigmaGraphVisualization({
  data,
  visibleTypes,
  visibleEdgeTypes,
  setSelectedNode,
}: SigmaGraphVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const [isPanelExpanded, setIsPanelExpanded] = useState(false);

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
      "HAS_PART",
      "HAS_CHAPTER",
      "HAS_SECTION",
      "HAS_SUBSECTION",
      "HAS_ARTICLE",
      "HAS_CLAUSE",
      "HAS_POINT",
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

    // Render at radial positions without scrambling using forceAtlas2
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
          background: "transparent",
        }}
      />
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
          {isPanelExpanded && (
            <div className="expanded-controls animate-fade-quick">
              <div className="zoom-icons">
                <i
                  className="fas fa-search-minus"
                  onClick={handleZoomOut}
                  title="Zoom Out"
                ></i>
                <i
                  className="fas fa-search-plus"
                  onClick={handleZoomIn}
                  title="Zoom In"
                ></i>
                <i
                  className="fas fa-expand"
                  onClick={handleReset}
                  title="Reset Camera"
                ></i>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
