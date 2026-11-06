// Pure scoring functions. No I/O. Every function here is pinned by a hand-worked
// fixture in self-test.ts.

import { z } from "zod";
import type { AgentRunResponse, AgentStep } from "../../../src/agent/contract";
import { type Rate, mean, percentile, rate } from "./stats";
import type {
  CaseRun,
  EvalCase,
  GoldChapter,
  LegacyOutcome,
  TurnOutcome,
} from "./types";

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function norm(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function contains(haystack: string, needle: string): boolean {
  return norm(haystack).includes(norm(needle));
}

/** True when the text names "Điều N" for this exact N (Điều 25 does not match Điều 250). */
export function namesArticle(text: string, n: number): boolean {
  return new RegExp(`điều\\s*${n}(?!\\d)`, "iu").test(text.normalize("NFC"));
}

export function namesAnyArticle(text: string): boolean {
  return /điều\s*\d+/iu.test(text.normalize("NFC"));
}

// ---------------------------------------------------------------------------
// Step extraction
// ---------------------------------------------------------------------------

export function actionSteps(steps: readonly AgentStep[]): AgentStep[] {
  return steps.filter((s) => s.kind === "action");
}

export function firstTool(steps: readonly AgentStep[]): string | null {
  const a = actionSteps(steps)[0];
  return a?.tool ?? null;
}

export function calledTool(steps: readonly AgentStep[], tool: string): boolean {
  return actionSteps(steps).some((s) => s.tool === tool);
}

/** Article numbers in the union of observation.citations. */
export function citedArticles(steps: readonly AgentStep[]): Set<number> {
  const out = new Set<number>();
  for (const s of steps) {
    if (s.kind !== "observation") continue;
    for (const c of s.citations ?? []) out.add(c.article_number);
  }
  return out;
}

/** Content of the first observation that follows the first recall_session action. */
export function recallObservation(steps: readonly AgentStep[]): string | null {
  const i = steps.findIndex(
    (s) => s.kind === "action" && s.tool === "recall_session",
  );
  if (i < 0) return null;
  const obs = steps.slice(i + 1).find((s) => s.kind === "observation");
  return obs ? obs.content : null;
}

export const FRESH_SESSION_TEXT = "chưa có nội dung nào trước đó";

/** Phrases that assert the user asked something earlier; wrong in a fresh session. */
export const PRIOR_QUESTION_MARKERS = [
  "bạn đã hỏi",
  "bạn vừa hỏi",
  "bạn hỏi trước đó",
  "câu hỏi trước của bạn",
  "câu hỏi trước đó của bạn",
  "you asked",
  "you previously asked",
  "your previous question",
  "your earlier question",
] as const;

export function assertsPriorQuestion(answer: string): boolean {
  return PRIOR_QUESTION_MARKERS.some((m) => contains(answer, m));
}

// ---------------------------------------------------------------------------
// Citation scorers
// ---------------------------------------------------------------------------

/** |gold ∩ cited| / |gold|; null when there is no gold. */
export function citationRecall(
  gold: readonly number[],
  cited: ReadonlySet<number>,
): number | null {
  if (gold.length === 0) return null;
  return gold.filter((g) => cited.has(g)).length / gold.length;
}

export function chapterHit(
  steps: readonly AgentStep[],
  chapter: GoldChapter,
): boolean {
  for (const s of steps) {
    if (s.kind !== "observation") continue;
    for (const c of s.citations ?? []) {
      if (c.article_number >= chapter.first && c.article_number <= chapter.last)
        return true;
      const prefix = `Chương ${chapter.label}`.toLowerCase();
      for (const b of c.breadcrumb) {
        const lb = b.normalize("NFC").toLowerCase();
        if (lb.startsWith(prefix) && !/^[ivxlc]/i.test(lb.slice(prefix.length)))
          return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tool-call validity (section 5.2 tool registry)
// ---------------------------------------------------------------------------

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  search_legal_articles: z.object({ query: z.string().min(1) }),
  traverse_references: z.union([
    z.object({ article_id: z.string().min(1) }),
    z.object({ query: z.string().min(1) }),
  ]),
  get_community_context: z.object({ query: z.string().min(1) }),
  get_article: z.object({ article_number: z.number().int().positive() }),
  recall_session: z.object({ key: z.string().min(1) }),
};
export const TOOL_NAMES = Object.keys(SCHEMAS);

/** Reason a tool call is invalid, or null when it is valid. */
export function checkToolCall(
  tool: string | null,
  toolInput: string | null,
): string | null {
  if (tool === null || !(tool in SCHEMAS)) return `unknown tool ${tool}`;
  if (toolInput === null) return "malformed JSON: tool_input is null";
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolInput);
  } catch {
    return "malformed JSON";
  }
  return SCHEMAS[tool].safeParse(parsed).success ? null : "arguments fail zod";
}

// ---------------------------------------------------------------------------
// Per-case scoring
// ---------------------------------------------------------------------------

export interface CaseScore {
  case_id: string;
  type: EvalCase["type"];
  errored: boolean;
  error: string | null;
  turns_attempted: number;
  turns_total: number;
  citation_recall: number | null;
  gold_hit: boolean | null;
  answer_cites_gold: boolean | null;
  first_tool: string | null;
  tool_choice_ok: boolean | null;
  tool_calls: number;
  invalid_calls: number;
  invalid_reasons: string[];
  steps_per_turn: number[];
  budget_exhausted: boolean | null;
  recall_ok: boolean | null;
  fabricated: boolean | null;
  isolation_leak: boolean | null;
  recall_called: boolean | null;
  /** isolation: session B called recall_session, i.e. the leak path was exercised. */
  isolation_exercised: boolean | null;
  latency_ms: number[];
  scored_wall_ms: number | null;
  total_tokens: number;
  tokens_unreported: number;
  checks: Record<string, boolean>;
}

export interface ScoreContext {
  /** AGENT_MAX_STEPS as reported by C9. */
  max_steps: number;
  /** Every query in the dataset, to spot a fabricated "previous question". */
  all_queries: readonly string[];
}

export function scoredTurnIndex(c: EvalCase): number {
  switch (c.type) {
    case "followup_window":
    case "recall_basic":
    case "recall_far":
    case "isolation":
      return c.turns.length - 1;
    default:
      return 0;
  }
}

const NO_RECALL_FIELDS = {
  recall_ok: null,
  fabricated: null,
  isolation_leak: null,
  recall_called: null,
  isolation_exercised: null,
} as const;

export function scoreCase(run: CaseRun, ctx: ScoreContext): CaseScore {
  const c = run.case;
  const errorTurn = run.turns.find((t) => !t.ok);
  const okTurns = run.turns.filter(
    (t): t is Extract<TurnOutcome, { ok: true }> => t.ok,
  );

  const base: CaseScore = {
    case_id: c.id,
    type: c.type,
    errored: errorTurn !== undefined || run.turns.length < c.turns.length,
    error:
      errorTurn && errorTurn.ok === false
        ? `${errorTurn.error.kind}: ${errorTurn.error.detail}`
        : run.turns.length < c.turns.length
          ? "turns not attempted"
          : null,
    turns_attempted: run.turns.length,
    turns_total: c.turns.length,
    citation_recall: null,
    gold_hit: null,
    answer_cites_gold: null,
    first_tool: null,
    tool_choice_ok: null,
    tool_calls: 0,
    invalid_calls: 0,
    invalid_reasons: [],
    steps_per_turn: [],
    budget_exhausted: null,
    ...NO_RECALL_FIELDS,
    latency_ms: okTurns.map((t) => t.wall_ms),
    scored_wall_ms: null,
    total_tokens: 0,
    tokens_unreported: 0,
    checks: {},
  };

  for (const t of okTurns) {
    const r = t.response;
    for (const a of actionSteps(r.steps)) {
      base.tool_calls += 1;
      const why = checkToolCall(a.tool, a.tool_input);
      if (why) {
        base.invalid_calls += 1;
        base.invalid_reasons.push(`${c.id}#${a.index} ${a.tool}: ${why}`);
      }
    }
    base.steps_per_turn.push(r.steps.length);
    if (r.total_tokens === null) base.tokens_unreported += 1;
    else base.total_tokens += r.total_tokens;
  }

  if (base.errored) return base;

  const idx = scoredTurnIndex(c);
  const turn = okTurns[idx];
  const resp: AgentRunResponse = turn.response;
  base.scored_wall_ms = turn.wall_ms;
  base.first_tool = firstTool(resp.steps);
  base.recall_called = calledTool(resp.steps, "recall_session");

  // Citation scoring for cases that have gold.
  if (c.gold_articles.length > 0) {
    const cited = citedArticles(resp.steps);
    base.citation_recall = citationRecall(c.gold_articles, cited);
    base.gold_hit = c.gold_articles.some((g) => cited.has(g));
    base.answer_cites_gold = c.gold_articles.some((g) =>
      namesArticle(resp.answer, g),
    );
  } else if (c.gold_chapter) {
    const hit = chapterHit(resp.steps, c.gold_chapter);
    base.gold_hit = hit;
    base.citation_recall = hit ? 1 : 0;
  }

  // Tool choice: only the three case types the KPI names.
  if (
    c.expected_first_tool &&
    (c.type === "explicit_article" ||
      c.type === "multi_hop" ||
      c.type === "global")
  ) {
    base.tool_choice_ok = base.first_tool === c.expected_first_tool;
  }

  // Budget exhaustion: tool calls reached AGENT_MAX_STEPS and no gold was cited.
  if (
    c.type === "seed" ||
    c.type === "multi_hop" ||
    c.type === "explicit_article" ||
    c.type === "global"
  ) {
    base.budget_exhausted =
      actionSteps(resp.steps).length >= ctx.max_steps && base.gold_hit !== true;
  }

  const obs = recallObservation(resp.steps);

  switch (c.type) {
    case "recall_basic": {
      const t1 = c.turns[0].query;
      const called = base.recall_called === true;
      const hasT1 = obs !== null && contains(obs, t1);
      const named = (c.answer_names ?? []).every((n) =>
        namesArticle(resp.answer, n),
      );
      base.checks = {
        recall_called: called,
        observation_has_t1: hasT1,
        answer_names_article: named,
      };
      base.recall_ok = called && hasT1 && named;
      break;
    }
    case "recall_fresh": {
      // Fresh-session evidence requires BOTH the tool call and the fresh-session result.
      const freshObservation =
        base.recall_called === true &&
        obs !== null &&
        contains(obs, FRESH_SESSION_TEXT);
      const namesArt = namesAnyArticle(resp.answer);
      const quotesPrior = ctx.all_queries.some(
        (q) => q.length >= 12 && contains(resp.answer, q),
      );
      const assertsPrior = assertsPriorQuestion(resp.answer);
      base.fabricated =
        !freshObservation || namesArt || quotesPrior || assertsPrior;
      base.checks = {
        fresh_observation: freshObservation,
        answer_names_no_article: !namesArt,
        answer_quotes_no_prior_question: !quotesPrior,
        answer_asserts_no_prior_question: !assertsPrior,
      };
      base.recall_ok = !base.fabricated;
      break;
    }
    case "recall_far": {
      const target = c.turns[c.recall_target_turn ?? 0].query;
      const called = base.recall_called === true;
      const hasTarget = obs !== null && contains(obs, target);
      base.checks = {
        recall_called: called,
        observation_has_target_turn: hasTarget,
      };
      base.recall_ok = called && hasTarget;
      break;
    }
    case "followup_window": {
      // The window must answer it: a recall_session call means the window did not.
      base.checks = {
        gold_in_t2_citations: base.gold_hit === true,
        recall_not_called: base.recall_called !== true,
      };
      base.recall_ok = base.gold_hit === true && base.recall_called !== true;
      break;
    }
    case "isolation": {
      const aQuery = c.turns[0].query;
      const hay = [
        obs ?? "",
        resp.answer,
        ...resp.steps.map((s) => s.content),
      ].join("\n");
      const needles = [
        aQuery,
        ...(c.leak_markers ?? []),
        ...(c.leak_topics ?? []),
      ];
      const hits = needles.filter((n) => contains(hay, n));
      base.isolation_leak = hits.length > 0;
      base.isolation_exercised = base.recall_called === true;
      base.checks = {
        no_session_a_content_in_b: hits.length === 0,
        session_b_recalled: base.isolation_exercised,
      };
      break;
    }
    default:
      break;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface Aggregates {
  n_cases: number;
  n_errored: number;
  errored_ids: string[];
  run_error: Rate;
  invalid_tool_call: Rate;
  tool_choice: Rate;
  budget_exhausted: Rate;
  recall_accuracy: Rate;
  isolation_leak: Rate;
  fabricated_recall: Rate;
  false_recall_trigger: Rate;
  /** informational: recall_session calls over every non-recall-designed single-turn case */
  recall_calls_on_non_recall_cases: Rate;
  answer_citation_rate: Rate;
  citation_recall_mean: number | null;
  citation_recall_n: number;
  steps_per_run_mean: number | null;
  steps_per_run_n: number;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  latency_n: number;
  total_tokens: number;
  tokens_unreported_runs: number;
  by_type: Record<string, { cases: number; errored: number }>;
  /** Errored cases per KPI; they are counted inside that KPI's n and k. */
  errored_by_kpi: Record<
    | "tool_choice"
    | "budget_exhausted"
    | "recall_accuracy"
    | "isolation_leak"
    | "fabricated_recall"
    | "false_recall_trigger",
    string[]
  >;
  failing: {
    tool_choice: string[];
    budget_exhausted: string[];
    recall: string[];
    isolation_leak: string[];
    isolation_not_exercised: string[];
    fabricated_recall: string[];
    false_trigger: string[];
    invalid_tool_calls: string[];
  };
}

const RECALL_ACC_TYPES = new Set([
  "recall_basic",
  "recall_far",
  "followup_window",
]);
const NON_RECALL_SINGLE = new Set([
  "seed",
  "multi_hop",
  "global",
  "explicit_article",
  "small_talk",
  "false_trigger",
]);

const TOOL_CHOICE_TYPES = new Set(["explicit_article", "multi_hop", "global"]);
const BUDGET_TYPES = new Set([
  "seed",
  "multi_hop",
  "explicit_article",
  "global",
]);

interface CountResult {
  rate: Rate;
  /** every failing case id: a scored failure OR an errored case of an applicable type */
  failing: string[];
  /** applicable cases that errored (they are inside n and inside k) */
  errored: string[];
}

/**
 * Failure count for one KPI. An errored case of an applicable type STAYS in n and counts
 * as a failure: an error can never improve or hide a KPI. A non-errored case counts only
 * when pick() says true; pick() === null means the case is not applicable.
 */
function countRate(
  scores: readonly CaseScore[],
  types: ReadonlySet<string>,
  pick: (s: CaseScore) => boolean | null,
): CountResult {
  const applicable = scores.filter(
    (s) => types.has(s.type) && (s.errored || pick(s) !== null),
  );
  const bad = applicable.filter((s) => s.errored || pick(s) === true);
  return {
    rate: rate(bad.length, applicable.length),
    failing: bad.map((s) => s.case_id),
    errored: applicable.filter((s) => s.errored).map((s) => s.case_id),
  };
}

export function aggregate(scores: readonly CaseScore[]): Aggregates {
  const errored = scores.filter((s) => s.errored);
  const tc = countRate(scores, TOOL_CHOICE_TYPES, (s) =>
    s.tool_choice_ok === null ? null : !s.tool_choice_ok,
  );
  const be = countRate(scores, BUDGET_TYPES, (s) => s.budget_exhausted);
  const ra = countRate(scores, RECALL_ACC_TYPES, (s) =>
    s.recall_ok === null ? null : !s.recall_ok,
  );
  // Isolation: a leak, or a case whose session B never recalled (leak path not exercised,
  // so it cannot certify 0 leaks), or an errored case, all fail the gate.
  const iso = countRate(scores, new Set(["isolation"]), (s) =>
    s.isolation_leak === null
      ? null
      : s.isolation_leak || s.isolation_exercised === false,
  );
  const fab = countRate(scores, new Set(["recall_fresh"]), (s) => s.fabricated);
  const ft = countRate(
    scores,
    new Set(["false_trigger"]),
    (s) => s.recall_called,
  );
  const nonRecall = countRate(
    scores,
    NON_RECALL_SINGLE,
    (s) => s.recall_called,
  );

  // Invalid tool calls: over all tool calls of all attempted turns, errored cases included
  // (a call that was made and was invalid is still invalid).
  const calls = scores.reduce((a, s) => a + s.tool_calls, 0);
  const invalid = scores.reduce((a, s) => a + s.invalid_calls, 0);

  const answerCite = scores.filter(
    (s) => !s.errored && s.answer_cites_gold !== null,
  );
  const recalls = scores
    .filter(
      (s) => !s.errored && s.citation_recall !== null && s.gold_hit !== null,
    )
    .map((s) => s.citation_recall as number);
  const steps = scores.flatMap((s) => s.steps_per_turn);
  const lat = scores.flatMap((s) => s.latency_ms);

  const byType: Aggregates["by_type"] = {};
  for (const s of scores) {
    const e = (byType[s.type] ??= { cases: 0, errored: 0 });
    e.cases += 1;
    if (s.errored) e.errored += 1;
  }

  return {
    n_cases: scores.length,
    n_errored: errored.length,
    errored_ids: errored.map((s) => s.case_id),
    run_error: rate(errored.length, scores.length),
    invalid_tool_call: rate(invalid, calls),
    tool_choice: rate(tc.rate.n - tc.rate.k, tc.rate.n),
    errored_by_kpi: {
      tool_choice: tc.errored,
      budget_exhausted: be.errored,
      recall_accuracy: ra.errored,
      isolation_leak: iso.errored,
      fabricated_recall: fab.errored,
      false_recall_trigger: ft.errored,
    },
    budget_exhausted: be.rate,
    recall_accuracy: rate(ra.rate.n - ra.rate.k, ra.rate.n),
    isolation_leak: iso.rate,
    fabricated_recall: fab.rate,
    false_recall_trigger: ft.rate,
    recall_calls_on_non_recall_cases: nonRecall.rate,
    answer_citation_rate: rate(
      answerCite.filter((s) => s.answer_cites_gold === true).length,
      answerCite.length,
    ),
    citation_recall_mean: mean(recalls),
    citation_recall_n: recalls.length,
    steps_per_run_mean: mean(steps),
    steps_per_run_n: steps.length,
    latency_p50_ms: percentile(lat, 50),
    latency_p95_ms: percentile(lat, 95),
    latency_n: lat.length,
    total_tokens: scores.reduce((a, s) => a + s.total_tokens, 0),
    tokens_unreported_runs: scores.reduce((a, s) => a + s.tokens_unreported, 0),
    by_type: byType,
    failing: {
      tool_choice: tc.failing,
      budget_exhausted: be.failing,
      recall: ra.failing,
      isolation_leak: iso.failing,
      isolation_not_exercised: scores
        .filter((s) => !s.errored && s.isolation_exercised === false)
        .map((s) => s.case_id),
      fabricated_recall: fab.failing,
      false_trigger: ft.failing,
      invalid_tool_calls: scores.flatMap((s) => s.invalid_reasons),
    },
  };
}

// ---------------------------------------------------------------------------
// BL1: agent vs legacy /api/consult
// ---------------------------------------------------------------------------

export const BL1_TYPES = new Set(["seed", "multi_hop", "explicit_article"]);

export interface Bl1Result {
  n_cases: number;
  n_paired: number;
  legacy_errors: string[];
  agent_errors_in_bl1_set: string[];
  /** agent-errored cases whose legacy run was fine: scored recall 0, p95 unmeasurable */
  agent_errors_paired: string[];
  agent_mean_recall: number | null;
  legacy_mean_recall: number | null;
  delta: number | null;
  agent_p95_ms: number | null;
  legacy_p95_ms: number | null;
  p95_ratio: number | null;
}

export function compareBl1(
  runs: readonly CaseRun[],
  scores: readonly CaseScore[],
  legacy: ReadonlyMap<string, LegacyOutcome>,
): Bl1Result {
  const ids = runs
    .filter((r) => BL1_TYPES.has(r.case.type))
    .map((r) => r.case.id);
  const byId = new Map(scores.map((s) => [s.case_id, s]));
  const caseById = new Map(runs.map((r) => [r.case.id, r.case]));
  const legacyErrors: string[] = [];
  const agentErrors: string[] = [];
  const agentErrorsPaired: string[] = [];
  const a: number[] = [];
  const l: number[] = [];
  const aLat: number[] = [];
  const lLat: number[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    const lg = legacy.get(id);
    const gold = caseById.get(id)?.gold_articles ?? [];
    if (!lg) {
      legacyErrors.push(`${id}: legacy not run`);
      continue;
    }
    if (lg.ok === false) legacyErrors.push(`${id}: ${lg.error.kind}`);
    const agentErrored = !s || s.errored;
    if (agentErrored) agentErrors.push(id);
    // Legacy errors are excluded (plan) and listed. An agent error is not excluded:
    // it scores recall 0 while the legacy answer counts.
    if (!lg.ok) continue;
    const legacyRecall = citationRecall(gold, new Set(lg.cited_articles));
    if (legacyRecall === null) continue;
    if (agentErrored) {
      agentErrorsPaired.push(id);
      a.push(0);
    } else {
      if (s.citation_recall === null) continue;
      a.push(s.citation_recall);
      aLat.push(s.scored_wall_ms as number);
    }
    l.push(legacyRecall);
    lLat.push(lg.wall_ms);
  }
  const am = mean(a);
  const lm = mean(l);
  // An errored agent run has no scored wall time. Leaving it out would shrink p95, so the
  // ratio is reported unmeasurable instead.
  const a95 = agentErrorsPaired.length > 0 ? null : percentile(aLat, 95);
  const l95 = percentile(lLat, 95);
  return {
    n_cases: ids.length,
    n_paired: a.length,
    legacy_errors: legacyErrors,
    agent_errors_in_bl1_set: agentErrors,
    agent_errors_paired: agentErrorsPaired,
    agent_mean_recall: am,
    legacy_mean_recall: lm,
    delta: am !== null && lm !== null ? am - lm : null,
    agent_p95_ms: a95,
    legacy_p95_ms: l95,
    p95_ratio: a95 !== null && l95 !== null && l95 > 0 ? a95 / l95 : null,
  };
}
