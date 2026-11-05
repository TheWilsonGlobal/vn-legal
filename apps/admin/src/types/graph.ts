declare global {
  interface Window {
    cytoscape: (options: unknown) => CytoscapeInstance;
  }
}

export interface CytoscapeInstance {
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

export interface CyNode {
  degree: () => number;
  data: (key: string) => unknown;
}

export interface GraphVisualizationProps {
  data: GraphData | null;
  layout: string;
  visibleTypes: string[];
  setSelectedNode: (node: GraphNode | null) => void;
  setZoomLevel: (level: number) => void;
  onRenderingChange: (loading: boolean) => void;
  onInit: (cy: CytoscapeInstance) => void;
}

export interface SigmaGraphVisualizationProps {
  data: GraphData | null;
  visibleTypes: string[];
  visibleEdgeTypes: string[];
  setSelectedNode: (node: GraphNode | null) => void;
}
