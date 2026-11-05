import { useRef, useEffect } from "react";
import type {
  GraphVisualizationProps,
  CytoscapeInstance,
  GraphNode,
  GraphEdge,
  CyNode,
} from "../../types/index.ts";

export function GraphVisualization({
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
