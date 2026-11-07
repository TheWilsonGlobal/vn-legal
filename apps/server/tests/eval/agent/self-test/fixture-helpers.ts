import type {
  AgentRunResponse,
  AgentStep,
  Citation,
} from "../../../../src/agent/contract";
import type { CaseRun, EvalCase, TurnOutcome } from "../types";

export const cit = (
  n: number,
  crumb: string[] = ["Bộ luật Dân sự 2015", "Chương I"],
): Citation => ({
  article_id: `article_${n}`,
  article_number: n,
  breadcrumb: crumb,
  via: "vector",
});

let ix = 0;
export const act = (tool: string, input: string | null): AgentStep => ({
  index: ++ix,
  kind: "action",
  content: `Model chose ${tool}`,
  tool,
  tool_input: input,
  ok: true,
  duration_ms: 0,
});

export const obs = (content: string, cs: number[] = []): AgentStep => ({
  index: ++ix,
  kind: "observation",
  content,
  tool: null,
  tool_input: null,
  ok: true,
  duration_ms: 5,
  citations: cs.map((n) => cit(n)),
});

export const emptyContext: AgentRunResponse["context"] = {
  query: "",
  seed_articles: [],
  path_context: [],
  community_context: {
    hierarchical_context: "",
    part: undefined,
    chapter: undefined,
    section: undefined,
    subsection: undefined,
  },
  relevant_concepts: [],
  community_reports: [],
};

export function ok(
  steps: AgentStep[],
  answer: string,
  wall = 100,
  tokens: number | null = 100,
): TurnOutcome {
  ix = 0;
  return {
    ok: true,
    wall_ms: wall,
    response: {
      session_id: "s",
      run_id: "r",
      answer,
      steps,
      tool_mode: "native",
      provider: "gemini",
      model: "fixture-model",
      endpoint: "fixture",
      embedding: {
        provider: "gemini",
        model: "fixture",
        dim: 768,
        index_id: "fixture-index",
      },
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: tokens,
      context: emptyContext,
      duration_ms: wall,
      memory: {
        window_turns: 0,
        window_tokens: 0,
        summarized_turns: 0,
        recalled: 0,
      },
      trace_id: null,
      trace_url: null,
    },
  };
}

export const T = (
  query: string,
  route: "legal" | "recall" | "smalltalk" = "legal",
  session = "main",
) => ({ session, query, route });

export const mk = (
  id: string,
  type: EvalCase["type"],
  turns: EvalCase["turns"],
  extra: Partial<EvalCase> = {},
): EvalCase => ({ id, type, turns, gold_articles: [], ...extra });

export const run = (c: EvalCase, turns: TurnOutcome[]): CaseRun => ({
  case: c,
  turns,
});

export const FRESH = "chưa có nội dung nào trước đó trong phiên này.";
export const Q25 = "Quyền nhân thân theo Điều 25 là gì?";
