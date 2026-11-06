// Shared types for the agent eval suite (plan r5 section 11, nodes EB1/ER1).

import type { AgentRunResponse } from "../../../src/agent/contract";

export const CASE_TYPES = [
  "seed",
  "multi_hop",
  "global",
  "explicit_article",
  "small_talk",
  "recall_basic",
  "recall_fresh",
  "recall_far",
  "followup_window",
  "isolation",
  "false_trigger",
] as const;
export type CaseType = (typeof CASE_TYPES)[number];

/** What the turn is designed to exercise; used for cost estimates and dataset checks. */
export type TurnRoute = "legal" | "recall" | "smalltalk";

export interface EvalTurn {
  /** Session label. One fresh server session is created per distinct label per case. */
  session: string;
  query: string;
  route: TurnRoute;
}

export interface GoldChapter {
  label: string; // roman numeral, "III"
  first: number; // first article_number of the chapter in the corpus
  last: number;
}

export interface EvalCase {
  id: string;
  type: CaseType;
  turns: EvalTurn[];
  /** article_number values from data/Docs/Vietnam Civil Law.json */
  gold_articles: number[];
  gold_chapter?: GoldChapter;
  expected_first_tool?: string;
  /** recall_basic: article numbers the answer must name. */
  answer_names?: number[];
  /** recall_far: index of the turn whose query must be recalled. */
  recall_target_turn?: number;
  /** isolation: distinctive strings of session A that must not appear in session B. */
  leak_markers?: string[];
  /** isolation: topic strings of session A that must not appear in session B. */
  leak_topics?: string[];
}

export interface DatasetFile {
  meta: {
    version: number;
    language: string;
    declared_total: number;
    declared_counts: Record<string, number>;
    labelling: string;
  };
  cases: EvalCase[];
}

/** A failed run. Never skipped, never re-run, never excluded from a denominator. */
export interface RunError {
  /** rate_limited | llm_unreachable | llm_auth_error | llm_error | embedding_error | network |
   *  timeout | session_create_failed | http_<status> | bad_response | model_mismatch |
   *  index_mismatch | provider_mismatch | legacy_template_fallback */
  kind: string;
  status?: number;
  detail: string;
}

export type TurnOutcome =
  | { ok: true; response: AgentRunResponse; wall_ms: number }
  | { ok: false; error: RunError; wall_ms: number };

export interface CaseRun {
  case: EvalCase;
  /** Outcomes of the turns that were attempted. Later turns of an errored case are not attempted. */
  turns: TurnOutcome[];
}

/** Legacy POST /api/consult result for one case (BL1). */
export type LegacyOutcome =
  | { ok: true; cited_articles: number[]; wall_ms: number }
  | { ok: false; error: RunError; wall_ms: number };
