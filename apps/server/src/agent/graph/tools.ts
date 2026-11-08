// ============================================================================
// Agent tools (plan r5 §5.2, subset). Each tool returns text the model sees
// (capped to MAX_OBSERVATION_TOKENS), a one-line summary for the UI, and citations.
// Implemented here: search_legal_articles, get_article, get_community_context,
// recall_session. traverse_references is deferred (see updated-04.md).
// ============================================================================

import { z } from "zod";
import type { Citation, SessionMemory } from "../contract";
import { capObservation, MAX_OBSERVATION_TOKENS } from "../memory/observation";

export interface ToolResult {
  ok: boolean;
  summary: string; // short line for the observation step
  content: string; // full text for the model, capped below
  citations: Citation[];
  seeds: any[]; // raw seed articles, mapped to ConsultContext by the runner
  reports: any[]; // raw community reports
  recalled: number;
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
      "Tìm các điều Bộ luật Dân sự 2015 liên quan đến câu hỏi. Trả về nội dung điều luật và trích dẫn.",
    schema: z.object({ query: z.string().min(1).max(500) }),
    async run({ query }: { query: string }) {
      const ctx = await deps.retrieval.retrieve(query, "local");
      const seeds: any[] = ctx?.seed_articles ?? [];
      if (seeds.length === 0) {
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
      return finish({
        ok: true,
        summary: `Tìm thấy ${seeds.length} điều luật liên quan.`,
        content: formatSeeds(seeds),
        citations: seeds.map((s) => citationFor(s, "vector")),
        seeds,
        reports: [],
        recalled: 0,
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
