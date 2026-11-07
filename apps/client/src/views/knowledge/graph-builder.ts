import type { KeyboardEvent } from "react";
import type { ConsultContext } from "../../types/agent";
import { type ArticleItem, NO_SUMMARY, NO_TITLE } from "./types";

/** Stable id of an article: article_id, else id. Undefined when the server sent neither. */
export const idOf = (i: ArticleItem): string | undefined => i.article_id ?? i.id;

/** Text, or an explicit label when the field is absent. */
export function textOr(value: unknown, label: string): string {
  return typeof value === "string" && value.length > 0 ? value : label;
}

export function summaryExcerpt(summary: unknown): string {
  if (typeof summary !== "string" || summary.length === 0) return NO_SUMMARY;
  return summary.length > 120 ? `${summary.substring(0, 120)}...` : summary;
}

/** "Điều N" / "Khoản K, Điều N" built only from the fields that exist. */
export function articlePrefix(i: ArticleItem): string | null {
  const clause = i.matched_entity_id?.match(/clause_(\d+)/i);
  const article =
    i.article_number === undefined ? null : `Điều ${i.article_number}`;
  if (clause) {
    return article ? `Khoản ${clause[1]}, ${article}` : `Khoản ${clause[1]}`;
  }
  return article;
}

export function nodeLabel(i: ArticleItem): string {
  return articlePrefix(i) ?? i.title ?? NO_TITLE;
}

export function renderTitle(item: ArticleItem): string {
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
export function nodeText(x: unknown): string {
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

export function getUniqueCount(ctx: ConsultContext): number {
  // An article without any id cannot be de-duplicated: it counts as itself.
  const ids = new Set<string | ArticleItem>();
  ctx.seed_articles.forEach((i) => ids.add(idOf(i) ?? i));
  ctx.path_context.forEach((i) => ids.add(idOf(i) ?? i));
  return ids.size + ctx.community_reports.length;
}

export interface GraphBuild {
  nodes: { data: Record<string, unknown> }[];
  edges: { data: Record<string, unknown> }[];
  /** Contract violations found while building; shown to the user, never hidden. */
  problems: string[];
}

/** Build the Cytoscape elements for one retrieval context. */
export function buildElements(ctx: ConsultContext): GraphBuild {
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

export const CY_STYLE = [
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

export function onActivate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}
