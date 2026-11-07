import type { GraphData } from "../../SigmaGraphVisualization";
import type {
  ConsultPathArticle,
  ConsultSeedArticle,
} from "../../types/agent";

export type ArticleItem = ConsultSeedArticle | ConsultPathArticle;

/** Minimal surface of the Cytoscape instance used here (CDN script). */
export interface CyInstance {
  zoom(): number;
  zoom(level: number): void;
  center(): void;
  fit(): void;
  on(event: string, cb: () => void): void;
  destroy(): void;
}

export type CytoscapeFactory = (options: Record<string, unknown>) => CyInstance;

export function getCytoscape(): CytoscapeFactory | null {
  const cy = (window as unknown as { cytoscape?: unknown }).cytoscape;
  return typeof cy === "function" ? (cy as CytoscapeFactory) : null;
}

export interface ExplorerConfig {
  mode: "query" | "explorer";
  graph: GraphData | null;
}

export async function fetchJson(
  url: string,
  signal: AbortSignal,
): Promise<unknown> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

export async function loadExplorerConfig(
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

export const EXPLORER_NODE_TYPES = [
  "Part",
  "Chapter",
  "Section",
  "Subsection",
  "Article",
  "Clause",
];

export const EXPLORER_EDGE_TYPES = [
  "HAS_PART",
  "HAS_CHAPTER",
  "HAS_SECTION",
  "HAS_SUBSECTION",
  "HAS_ARTICLE",
  "HAS_CLAUSE",
];

export const NO_TITLE = "(không có tiêu đề)";
export const NO_SUMMARY = "(không có tóm tắt)";
