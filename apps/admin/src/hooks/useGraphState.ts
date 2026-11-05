import { useState, useEffect, useRef } from "react";
import type {
  GraphData,
  GraphNode,
  CytoscapeInstance,
} from "../types/index.ts";
import {
  DEFAULT_VISIBLE_TYPES,
  DEFAULT_VISIBLE_EDGE_TYPES,
} from "../components/graph/graphConstants.ts";

export function useGraphState() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [graphRendering, setGraphRendering] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [graphLayout, setGraphLayout] = useState("fcose");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [visibleTypes, setVisibleTypes] = useState<string[]>(
    DEFAULT_VISIBLE_TYPES,
  );
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<string[]>(
    DEFAULT_VISIBLE_EDGE_TYPES,
  );
  const cyRef = useRef<CytoscapeInstance | null>(null);

  const toggleTypeVisibility = (type: string) => {
    setVisibleTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };

  const toggleEdgeTypeVisibility = (type: string) => {
    setVisibleEdgeTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
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

  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullScreen(false);
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

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
      .filter((n) => visibleTypes.includes(n.type))
      .map((n) => n.id) || [],
  );
  const visibleNodesCount = visibleNodeIds.size;
  const visibleEdgesCount =
    graphData?.edges.filter(
      (e) =>
        visibleNodeIds.has(e.source) &&
        visibleNodeIds.has(e.target) &&
        visibleEdgeTypes.includes(e.type),
    ).length || 0;

  return {
    graphData,
    setGraphData,
    graphRendering,
    setGraphRendering,
    isFullScreen,
    setIsFullScreen,
    zoomLevel,
    setZoomLevel,
    graphLayout,
    setGraphLayout,
    selectedNode,
    setSelectedNode,
    visibleTypes,
    visibleEdgeTypes,
    toggleTypeVisibility,
    toggleEdgeTypeVisibility,
    cyRef,
    fetchGraphData,
    graphTypeCounts,
    graphEdgeCounts,
    visibleNodesCount,
    visibleEdgesCount,
  };
}
