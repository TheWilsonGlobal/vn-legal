// Cost guard (plan section 11, A20): print the case count and the estimated tokens
// before the run and abort when the estimate exceeds EVAL_MAX_TOKENS_BUDGET.
// The estimate is an assumption (constants below), not a measurement; the report
// records the actual total_tokens summed from `done`.

import type { EvalCase, TurnOutcome } from "./types";

export const DEFAULT_TOKEN_BUDGET = 1_000_000;
/**
 * Assumed prompt + completion tokens of one LLM call, 7000. Build-up (plan 5.5 caps):
 * system prompt + 5 tool schemas ~1500; compressed history <= 1500 (HISTORY_MAX_TOKENS);
 * window <= 512 (SHORT_TERM_MAX_TOKENS); the query ~50; tool observations ~3000 on average
 * (one to two observations, each cut at MAX_OBSERVATION_TOKENS = 6000, article text
 * typically well below the cap); completion ~500. Sum 7062, rounded to 7000. It is an
 * assumption; the report records the measured total_tokens from `done`.
 */
export const TOKENS_PER_LLM_CALL = 7000;
/** Assumed tokens of one legacy /api/consult call (one LLM call over a retrieved context). */
export const TOKENS_PER_LEGACY_CALL = 2500;

export interface CostEstimate {
  cases: number;
  turns: number;
  legal_turns: number;
  recall_turns: number;
  smalltalk_turns: number;
  legacy_calls: number;
  max_steps: number;
  estimated_tokens: number;
  budget: number;
  assumptions: string;
}

export function parseBudget(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TOKEN_BUDGET;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(
      `EVAL_MAX_TOKENS_BUDGET must be a positive integer, got ${JSON.stringify(raw)}`,
    );
  return n;
}

/**
 * Worst case for legal turns: AGENT_MAX_STEPS tool rounds plus the answer turn
 * (max_steps + 1 LLM calls). Recall turns: recall_session, then the answer (2 calls).
 * Small talk: 1 call.
 */
export function estimateTokens(
  cases: readonly EvalCase[],
  maxSteps: number,
  legacyCalls: number,
  budget: number,
): CostEstimate {
  let legal = 0;
  let recall = 0;
  let small = 0;
  for (const c of cases) {
    for (const t of c.turns) {
      if (t.route === "legal") legal += 1;
      else if (t.route === "recall") recall += 1;
      else small += 1;
    }
  }
  const calls = legal * (maxSteps + 1) + recall * 2 + small * 1;
  return {
    cases: cases.length,
    turns: legal + recall + small,
    legal_turns: legal,
    recall_turns: recall,
    smalltalk_turns: small,
    legacy_calls: legacyCalls,
    max_steps: maxSteps,
    estimated_tokens:
      calls * TOKENS_PER_LLM_CALL + legacyCalls * TOKENS_PER_LEGACY_CALL,
    budget,
    assumptions: `legal turn = (max_steps+1) calls, recall turn = 2, small talk = 1, ${TOKENS_PER_LLM_CALL} tokens per call; legacy ${TOKENS_PER_LEGACY_CALL} tokens per call`,
  };
}

/** Σ done.total_tokens over every ok turn (null counts as 0; the report counts null runs). */
export function sumReportedTokens(
  runs: readonly { turns: readonly TurnOutcome[] }[],
): number {
  let t = 0;
  for (const r of runs)
    for (const o of r.turns)
      if (o.ok && o.response.total_tokens !== null)
        t += o.response.total_tokens;
  return t;
}

/** Running-sum abort: true when the measured tokens already exceed the budget. */
export function exceedsTokenBudget(used: number, budget: number): boolean {
  return used > budget;
}

export class CostGuardError extends Error {
  constructor(est: CostEstimate) {
    super(
      `cost guard: estimated ${est.estimated_tokens} tokens exceeds EVAL_MAX_TOKENS_BUDGET=${est.budget} ` +
        `(${est.cases} cases, ${est.turns} agent turns). Raise EVAL_MAX_TOKENS_BUDGET deliberately or shrink the run.`,
    );
    this.name = "CostGuardError";
  }
}

export function assertWithinBudget(est: CostEstimate): void {
  if (est.estimated_tokens > est.budget) throw new CostGuardError(est);
}

export function describeEstimate(est: CostEstimate): string {
  return (
    `cost guard: ${est.cases} cases, ${est.turns} agent turns ` +
    `(${est.legal_turns} legal, ${est.recall_turns} recall, ${est.smalltalk_turns} small talk), ` +
    `${est.legacy_calls} legacy calls, estimated ${est.estimated_tokens} tokens, ` +
    `budget ${est.budget} [${est.assumptions}]`
  );
}
