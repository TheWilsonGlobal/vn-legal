import { useRef, useEffect } from "react";
import Sigma from "sigma";
import { MultiGraph } from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";
import type { SigmaGraphVisualizationProps } from "../../types/index.ts";
import {
  TYPE_COLORS,
  HIERARCHY_TYPES,
  STRUCTURAL_LABELS,
} from "./graphConstants.ts";

export function SigmaGraphVisualization({
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

    filteredEdges.forEach((e) => {
      if (HIERARCHY_TYPES.has(e.type)) {
        if (!parentToChildren.has(e.source)) parentToChildren.set(e.source, []);
        parentToChildren.get(e.source)!.push(e.target);
        childToParent.set(e.target, e.source);
      }
    });

    const structuralNodes = filteredNodes.filter(
      (n) => STRUCTURAL_LABELS.has(n.type) || !childToParent.has(n.id),
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
        color: TYPE_COLORS[n.type] || "#64748b",
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
