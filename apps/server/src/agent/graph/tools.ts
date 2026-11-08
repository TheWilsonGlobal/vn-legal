// ============================================================================
// Agent tools (plan r5 §5.2, subset). Each tool returns text the model sees
// (capped to MAX_OBSERVATION_TOKENS), a one-line summary for the UI, and citations.
// Implemented here: search_legal_articles, get_article, get_community_context,
// recall_session. traverse_references is deferred (see updated-04.md).
// ============================================================================

import { z } from "zod";
import logger from "../../shared/logger";
import type {
  Citation,
  ObservationGraph,
  ObservationReport,
  SessionMemory,
} from "../contract";
import { capObservation, MAX_OBSERVATION_TOKENS } from "../memory/observation";

export interface ToolResult {
  ok: boolean;
  summary: string; // short line for the observation step
  content: string; // full text for the model, capped below
  citations: Citation[];
  seeds: any[]; // raw seed articles, mapped to ConsultContext by the runner
  reports: any[]; // raw community reports
  recalled: number;
  graph?: ObservationGraph; // shown in the step's graph tab
  shown_reports?: ObservationReport[]; // shown in the step's synthesis tab
}

export interface AgentToolSpec {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  run(args: any): Promise<ToolResult>;
}

export interface ToolRetrieval {
  retrieve(query: string, mode: "local" | "global"): Promise<any>;
}

export interface ToolDeps {
  retrieval: ToolRetrieval;
  memory: Pick<SessionMemory, "recall">;
  sessionId: string;
  runId: string;
}

const NO_RESULT_TEXT = "Không tìm thấy nội dung phù hợp.";

function breadcrumb(article: any): string[] {
  const a = article?.article ?? {};
  return [a?.metadata?.part, a?.metadata?.chapter, a?.title].filter(
    Boolean,
  ) as string[];
}

function citationFor(seed: any, via: Citation["via"]): Citation {
  return {
    article_id: seed.article_id,
    article_number: seed.article?.article_number ?? 0,
    breadcrumb: breadcrumb(seed),
    via,
    score: seed.score,
  };
}

function formatSeeds(seeds: any[]): string {
  return seeds
    .map((s) => {
      const a = s.article ?? {};
      const head = `Điều ${a.article_number ?? "?"}: ${a.title ?? ""}`;
      const crumbs = breadcrumb(s).join(" > ");
      return [crumbs, head, a.content ?? ""]
        .filter((x) => x && String(x).length)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

/** Cap on articles reached only through reference links (graph side). */
const MAX_LINKED = 8;

/**
 * Graph side of local retrieval: articles reached over REFERENCES edges from
 * the seeds. Drops seeds and duplicates so each article appears once.
 */
function dedupeLinked(paths: any[], seedIds: Set<string>): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const p of paths) {
    const id = p?.article?.id;
    if (!id || seedIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(p);
    if (out.length >= MAX_LINKED) break;
  }
  return out;
}

function formatLinked(paths: any[]): string {
  return paths
    .map((p) => {
      const a = p.article ?? {};
      const head = `Điều ${a.article_number ?? "?"}: ${a.title ?? ""}`;
      const crumbs = breadcrumb({ article: a }).join(" > ");
      return [crumbs, head, `Liên kết: ${p.relationship ?? "tham chiếu"}`, a.content ?? ""]
        .filter((x) => x && String(x).length)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

/**
 * Nodes and edges for the graph tab. Edges follow each linked article's path
 * (seed → … → article). Only edges between nodes that are shown are kept.
 */
function buildGraph(seeds: any[], linked: any[]): ObservationGraph {
  const nodes = new Map<string, ObservationGraph["nodes"][number]>();
  const add = (article: any, kind: "vector" | "path", depth: number) => {
    if (!article?.id || nodes.has(article.id)) return;
    nodes.set(article.id, {
      id: article.id,
      number: article.article_number ?? 0,
      title: article.title ?? "",
      kind,
      depth,
    });
  };
  for (const s of seeds) add(s.article, "vector", 0);
  for (const p of linked) add(p.article, "path", Math.max(0, p.depth ?? 1));

  const edges: ObservationGraph["edges"] = [];
  const seen = new Set<string>();
  for (const p of linked) {
    const chain: string[] = Array.isArray(p.path) ? p.path : [];
    for (let i = 0; i + 1 < chain.length; i++) {
      const from = chain[i];
      const to = chain[i + 1];
      const key = `${from}>${to}`;
      if (seen.has(key) || !nodes.has(from) || !nodes.has(to)) continue;
      seen.add(key);
      edges.push({ from, to });
    }
  }
  return { nodes: [...nodes.values()], edges };
}

/** The fields the synthesis tab needs. Summaries are capped to keep steps small. */
function toObservationReport(r: any): ObservationReport {
  return {
    title: String(r.title ?? ""),
    summary: String(r.summary ?? "").slice(0, 600),
    ...(typeof r.rating === "number" ? { rating: r.rating } : {}),
  };
}

/** Cap on community reports added to one search. */
const MAX_REPORTS = 3;

function formatReports(reports: any[]): string {
  return reports
    .map(
      (r) => `${r.title}\n${r.summary}\n${(r.findings ?? []).join("\n")}`,
    )
    .join("\n\n---\n\n");
}

/**
 * Global side of a search: community reports for the same query. A failure
 * here is logged and skipped, so the local results still reach the model.
 */
async function communityReportsFor(
  deps: ToolDeps,
  query: string,
): Promise<any[]> {
  try {
    const ctx = await deps.retrieval.retrieve(query, "global");
    return ((ctx?.community_reports ?? []) as any[]).slice(0, MAX_REPORTS);
  } catch (err) {
    logger.warn(`search_legal_articles: community reports skipped: ${String(err)}`);
    return [];
  }
}

function finish(
  spec: Omit<ToolResult, "content"> & { content: string },
): ToolResult {
  return {
    ...spec,
    content: capObservation(spec.content, MAX_OBSERVATION_TOKENS),
  };
}

export function createAgentTools(deps: ToolDeps): AgentToolSpec[] {
  const searchTool: AgentToolSpec = {
    name: "search_legal_articles",
    description:
      "Tìm các điều Bộ luật Dân sự 2015 liên quan đến câu hỏi theo ngữ nghĩa (semantic), đồng thời mở rộng theo đồ thị tham chiếu giữa các điều và kèm báo cáo tổng quan cộng đồng về chủ đề. Trả về nội dung điều luật, báo cáo và trích dẫn.",
    schema: z.object({ query: z.string().min(1).max(500) }),
    async run({ query }: { query: string }) {
      const ctx = await deps.retrieval.retrieve(query, "local");
      const seeds: any[] = ctx?.seed_articles ?? [];
      const reports = await communityReportsFor(deps, query);
      if (seeds.length === 0 && reports.length === 0) {
        return finish({
          ok: true,
          summary: "Không có điều luật liên quan.",
          content: NO_RESULT_TEXT,
          citations: [],
          seeds: [],
          reports: [],
          recalled: 0,
        });
      }
      const seedIds = new Set<string>(seeds.map((s) => s.article_id));
      const linked = dedupeLinked(ctx?.path_context ?? [], seedIds);
      const parts: string[] = [];
      if (seeds.length > 0) parts.push(formatSeeds(seeds));
      if (linked.length > 0) {
        parts.push(
          "Điều liên quan qua tham chiếu (đồ thị):\n\n" + formatLinked(linked),
        );
      }
      if (reports.length > 0) {
        parts.push(
          "Báo cáo tổng quan cộng đồng:\n\n" + formatReports(reports),
        );
      }
      const found = [
        seeds.length > 0 ? `${seeds.length} điều luật (ngữ nghĩa)` : "",
        linked.length > 0 ? `${linked.length} điều qua đồ thị` : "",
        reports.length > 0 ? `${reports.length} báo cáo tổng quan` : "",
      ].filter(Boolean);
      return finish({
        ok: true,
        summary: `Tìm thấy ${found.join(", ")}.`,
        content: parts.join("\n\n====\n\n"),
        citations: [
          ...seeds.map((s) => citationFor(s, "vector")),
          ...linked.map((p) =>
            citationFor({ article_id: p.article.id, article: p.article }, "path"),
          ),
        ],
        seeds,
        reports,
        recalled: 0,
        graph: buildGraph(seeds, linked),
        shown_reports: reports.map(toObservationReport),
      });
    },
  };

  const articleTool: AgentToolSpec = {
    name: "get_article",
    description: "Lấy nội dung đúng một điều luật theo số điều (ví dụ 25).",
    schema: z.object({
      // .min(1), not .positive(): zod emits exclusiveMinimum, which Gemini's function
      // schema rejects with HTTP 400 (found by the live integration run).
      article_number: z.number().int().min(1).max(100000),
    }),
    async run({ article_number }: { article_number: number }) {
      const ctx = await deps.retrieval.retrieve(
        `Điều ${article_number}`,
        "local",
      );
      const hit = ((ctx?.seed_articles ?? []) as any[]).filter(
        (s) => s.article?.article_number === article_number,
      );
      if (hit.length === 0) {
        return finish({
          ok: true,
          summary: `Không tìm thấy Điều ${article_number}.`,
          content: `Không tìm thấy Điều ${article_number} trong cơ sở dữ liệu.`,
          citations: [],
          seeds: [],
          reports: [],
          recalled: 0,
        });
      }
      return finish({
        ok: true,
        summary: `Đã lấy Điều ${article_number}.`,
        content: formatSeeds(hit.slice(0, 1)),
        citations: hit.slice(0, 1).map((s) => citationFor(s, "lookup")),
        seeds: hit.slice(0, 1),
        reports: [],
        recalled: 0,
      });
    },
  };

  const communityTool: AgentToolSpec = {
    name: "get_community_context",
    description:
      "Lấy các báo cáo tổng quan (community reports) về một chủ đề pháp luật.",
    schema: z.object({ query: z.string().min(1).max(500) }),
    async run({ query }: { query: string }) {
      const ctx = await deps.retrieval.retrieve(query, "global");
      const reports: any[] = ctx?.community_reports ?? [];
      if (reports.length === 0) {
        return finish({
          ok: true,
          summary: "Không có báo cáo tổng quan.",
          content: NO_RESULT_TEXT,
          citations: [],
          seeds: [],
          reports: [],
          recalled: 0,
        });
      }
      const text = reports
        .map(
          (r) => `${r.title}\n${r.summary}\n${(r.findings ?? []).join("\n")}`,
        )
        .join("\n\n---\n\n");
      return finish({
        ok: true,
        summary: `Có ${reports.length} báo cáo tổng quan.`,
        content: text,
        citations: [],
        seeds: [],
        reports,
        recalled: 0,
      });
    },
  };

  const recallTool: AgentToolSpec = {
    name: "recall_session",
    description:
      "Tìm câu hỏi hoặc câu trả lời trước đó trong chính phiên này. Không đọc phiên khác.",
    schema: z.object({ key: z.string().min(1).max(200) }),
    async run({ key }: { key: string }) {
      const r = await deps.memory.recall(deps.sessionId, key, {
        excludeRunId: deps.runId,
      });
      if (r.fresh_session || r.items.length === 0) {
        return finish({
          ok: true,
          summary: "Không có nội dung trước đó.",
          content: "chưa có nội dung nào trước đó trong phiên này",
          citations: [],
          seeds: [],
          reports: [],
          recalled: 0,
        });
      }
      const text = r.items.map((i) => `[${i.kind}] ${i.content}`).join("\n");
      return finish({
        ok: true,
        summary: `Nhớ lại ${r.items.length} mục.`,
        content: text,
        citations: [],
        seeds: [],
        reports: [],
        recalled: r.items.length,
      });
    },
  };

  return [searchTool, articleTool, communityTool, recallTool];
}
