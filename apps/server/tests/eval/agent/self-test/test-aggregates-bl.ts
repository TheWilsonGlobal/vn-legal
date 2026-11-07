import {
  rankedArticles,
  recallAtK,
  reciprocalRank,
  scoreBl2Case,
  summarizeBl2,
} from "../bl2-metrics";
import {
  TOKENS_PER_LEGACY_CALL,
  TOKENS_PER_LLM_CALL,
  CostGuardError,
  assertWithinBudget,
  estimateTokens,
  parseBudget,
} from "../cost";
import { aggregate, compareBl1 } from "../scorers";
import { meetsTarget } from "../thresholds";
import type { LegacyOutcome } from "../types";
import { TestContext, approx, same } from "./context";
import { T, createFixtureWorld, mk } from "./fixture-world";

export function runAggregatesAndBlTests(ctx: TestContext) {
  const { check } = { check: ctx.check.bind(ctx) };
  const { runs, scores } = createFixtureWorld();

  const agg = aggregate(scores);
  check(
    "aggregate: 14 cases, 1 errored (F11)",
    agg.n_cases === 14 && agg.n_errored === 1 && same(agg.errored_ids, ["F11"]),
  );
  check(
    "aggregate: run error rate 1/14",
    agg.run_error.k === 1 && agg.run_error.n === 14,
  );
  check(
    "aggregate: invalid tool-call rate 1/21 (21 calls, errored cases included)",
    agg.invalid_tool_call.k === 1 && agg.invalid_tool_call.n === 21,
    `${agg.invalid_tool_call.k}/${agg.invalid_tool_call.n}`,
  );
  check(
    "aggregate: tool-choice accuracy 2/3",
    agg.tool_choice.k === 2 && agg.tool_choice.n === 3,
  );
  check(
    "aggregate: budget-exhausted 2/4 (F3 exhausted; errored seed F11 stays in n and counts as a failure)",
    agg.budget_exhausted.k === 2 &&
      agg.budget_exhausted.n === 4 &&
      same(agg.failing.budget_exhausted, ["F3", "F11"]) &&
      same(agg.errored_by_kpi.budget_exhausted, ["F11"]),
    `${agg.budget_exhausted.k}/${agg.budget_exhausted.n}`,
  );
  check(
    "aggregate: recall accuracy 3/4 (F4, F12, F13 pass; F14 fails)",
    agg.recall_accuracy.k === 3 &&
      agg.recall_accuracy.n === 4 &&
      same(agg.failing.recall, ["F14"]),
  );
  check(
    "aggregate: isolation leak 1/2, fabricated 1/2",
    agg.isolation_leak.k === 1 &&
      agg.isolation_leak.n === 2 &&
      agg.fabricated_recall.k === 1 &&
      agg.fabricated_recall.n === 2,
  );
  check(
    "aggregate: false recall triggers 1/2 on false_trigger; 2/6 on all non-recall single-turn cases (F9 fired, errored F11 counted)",
    agg.false_recall_trigger.k === 1 &&
      agg.false_recall_trigger.n === 2 &&
      agg.recall_calls_on_non_recall_cases.k === 2 &&
      agg.recall_calls_on_non_recall_cases.n === 6,
    `${agg.recall_calls_on_non_recall_cases.k}/${agg.recall_calls_on_non_recall_cases.n}`,
  );
  check(
    "aggregate: answer-citation rate 2/3",
    agg.answer_citation_rate.k === 2 && agg.answer_citation_rate.n === 3,
  );
  check(
    "aggregate: mean citation recall (1, 0.5, 0, 1/3) = 0.458333, n=4",
    approx(agg.citation_recall_mean, 0.458333, 1e-5) &&
      agg.citation_recall_n === 4,
  );
  check(
    "aggregate: steps per run 42/20 = 2.1; latency n=20; tokens 2000 with 1 unreported",
    approx(agg.steps_per_run_mean, 2.1) &&
      agg.steps_per_run_n === 20 &&
      agg.latency_n === 20 &&
      agg.total_tokens === 2000 &&
      agg.tokens_unreported_runs === 1,
    JSON.stringify([
      agg.steps_per_run_mean,
      agg.steps_per_run_n,
      agg.latency_n,
      agg.total_tokens,
      agg.tokens_unreported_runs,
    ]),
  );

  // --- BL1 -------------------------------------------------------------------------------------
  const legacyOk = (cited: number[], wall: number): LegacyOutcome => ({
    ok: true,
    cited_articles: cited,
    wall_ms: wall,
  });
  const legacy1 = new Map<string, LegacyOutcome>([
    ["F1", legacyOk([8, 9], 2000)],
    ["F2", legacyOk([623], 6000)],
    [
      "F11",
      {
        ok: false,
        wall_ms: 1,
        error: { kind: "legacy_template_fallback", detail: "x" },
      },
    ],
  ]);
  const bl1 = compareBl1(runs, scores, legacy1);
  check(
    "BL1: 2 paired cases, legacy template fallback listed as an error and excluded",
    bl1.n_cases === 3 &&
      bl1.n_paired === 2 &&
      bl1.legacy_errors.length === 1 &&
      same(bl1.agent_errors_in_bl1_set, ["F11"]),
  );
  check(
    "BL1: agent 0.75 vs legacy 0.75, delta 0",
    approx(bl1.agent_mean_recall, 0.75) &&
      approx(bl1.legacy_mean_recall, 0.75) &&
      approx(bl1.delta, 0),
  );
  check(
    "BL1: p95 ratio = 3000 / 6000 = 0.5",
    bl1.agent_p95_ms === 3000 &&
      bl1.legacy_p95_ms === 6000 &&
      approx(bl1.p95_ratio, 0.5),
  );
  const legacy2 = new Map(legacy1);
  legacy2.set("F2", legacyOk([623, 236], 6000));
  const bl1b = compareBl1(runs, scores, legacy2);
  check(
    "BL1: legacy recall 1.0 on F2 gives delta -0.25",
    approx(bl1b.delta, -0.25),
  );
  check(
    "target comparison: -0.02 passes the >= -0.02 target, -0.0201 fails",
    meetsTarget(">=", -0.02, -0.02) && !meetsTarget(">=", -0.0201, -0.02),
  );
  check(
    "target comparison: == 0 and <= 0.05 boundaries",
    meetsTarget("==", 0, 0) &&
      !meetsTarget("==", 1, 0) &&
      meetsTarget("<=", 0.05, 0.05) &&
      !meetsTarget("<=", 0.0501, 0.05),
  );

  // --- BL2 metrics -----------------------------------------------------------------------------
  check(
    "BL2 reciprocalRank: first relevant at rank 2 gives 0.5 even when a later hit exists",
    reciprocalRank([10, 20], [5, 10, 20, 7]) === 0.5,
  );
  check(
    "BL2 recallAtK: gold [10,20] ranked [5,10,20,7] has 0.5 at k=2 and 1 at k=3",
    recallAtK([10, 20], [5, 10, 20, 7], 2) === 0.5 &&
      recallAtK([10, 20], [5, 10, 20, 7], 3) === 1,
  );
  check(
    "BL2 rankedArticles: seeds first, path after, de-duplicated",
    same(
      rankedArticles({
        seed_articles: [
          { article: { article_number: 117 } },
          { article: { article_number: 119 } },
        ],
        path_context: [
          { article: { article_number: 119 } },
          { article: { article_number: 120 } },
        ],
      }),
      [117, 119, 120],
    ),
  );
  {
    const a = scoreBl2Case("a", [10, 20], [5, 10, 20], [10, 20, 5]);
    const b = scoreBl2Case("b", [1], [2, 3], [1]);
    const s = summarizeBl2([a, b]);
    check(
      "BL2 summary: recall@5 old 0.5, new 1.0, delta 0.5; MRR old 0.25, new 1.0",
      s.old.recall5 === 0.5 &&
        s.new.recall5 === 1 &&
        s.delta_recall5 === 0.5 &&
        s.old.mrr === 0.25 &&
        s.new.mrr === 1,
    );
  }

  // --- cost guard ------------------------------------------------------------------------------
  {
    const cs = [
      mk("c1", "seed", [T("a"), T("b")]),
      mk("c2", "recall_basic", [T("c", "recall"), T("d", "smalltalk")]),
    ];
    const est = estimateTokens(cs, 4, 2, 96_000);
    check(
      "cost: 13 calls x 7000 + 2 x 2500 = 96000 tokens",
      TOKENS_PER_LLM_CALL === 7000 &&
        est.estimated_tokens ===
          13 * TOKENS_PER_LLM_CALL + 2 * TOKENS_PER_LEGACY_CALL &&
        est.estimated_tokens === 96_000 &&
        est.cases === 2 &&
        est.turns === 4,
    );
    let blocked = false;
    try {
      assertWithinBudget({ ...est, budget: 95_999 });
    } catch (e) {
      blocked = e instanceof CostGuardError;
    }
    let allowed = true;
    try {
      assertWithinBudget(est);
    } catch {
      allowed = false;
    }
    check(
      "cost: aborts above the budget, passes at the budget",
      blocked && allowed,
    );
    let bad = false;
    try {
      parseBudget("abc");
    } catch {
      bad = true;
    }
    check(
      "cost: default budget 1,000,000; a non-integer budget throws",
      parseBudget(undefined) === 1_000_000 &&
        parseBudget("250000") === 250000 &&
        bad,
    );
  }
}
