import {
  type ReportInput,
  computeKpiRows,
  kpiGateFailures,
} from "../report";
import { aggregate, compareBl1, scoreCase } from "../scorers";
import type { EvalCase, TurnOutcome } from "../types";
import { TestContext } from "./context";
import {
  FRESH,
  Q25,
  T,
  act,
  createFixtureWorld,
  mk,
  obs,
  ok,
  run,
} from "./fixture-world";

export function runReviewR12GatesTests(ctx: TestContext) {
  const { check } = { check: ctx.check.bind(ctx) };
  const { runs, scores, ctx: evalCtx } = createFixtureWorld();

  const reportInput = (mode: "mock" | "live"): ReportInput => ({
    meta: {
      mode,
      label: "SELF-TEST FIXTURES",
      run_name: "selftest",
      provider: "gemini",
      chat_model: "fixture-model",
      embedding_index_id: "fixture-index",
      server_url: null,
      dataset_sha256: "0".repeat(64),
      commit: null,
      started_at: "t0",
      finished_at: "t1",
      max_steps: 4,
      bl1_precondition: null,
    },
    runs,
    scores,
    agg: aggregate(scores),
    bl1: null,
    bl2: null,
    bl2_source: null,
    cost: {
      cases: 0,
      turns: 0,
      legal_turns: 0,
      recall_turns: 0,
      smalltalk_turns: 0,
      legacy_calls: 0,
      max_steps: 0,
      estimated_tokens: 0,
      budget: 1000000,
      assumptions: "",
    },
    rate_limited_count: 0,
    langfuse_push: "",
  });

  const errTurn = (kind = "rate_limited"): TurnOutcome => ({
    ok: false,
    wall_ms: 9000,
    error: { kind, status: 502, detail: "x" },
  });
  const liveRows = (
    sc: ReturnType<typeof scoreCase>[],
    b1: ReturnType<typeof compareBl1> | null = null,
  ) =>
    Object.fromEntries(
      computeKpiRows({
        ...reportInput("live"),
        agg: aggregate(sc),
        scores: sc,
        bl1: b1,
      }).map((r) => [r.id, r]),
    );
  const sc1 = (c: EvalCase, turns: TurnOutcome[]) =>
    scoreCase(run(c, turns), evalCtx);
  const isoCase = (id: string) =>
    mk(
      id,
      "isolation",
      [
        T("Công ty Hải Âu Xanh giao sai?", "legal", "A"),
        T("Tôi đã hỏi gì?", "recall", "B"),
      ],
      { leak_markers: ["Hải Âu Xanh"], leak_topics: ["giao sai"] },
    );
  const isoCleanTurns = (): TurnOutcome[] => [
    ok([act("search_legal_articles", '{"query":"a"}'), obs("t")], "a"),
    ok([act("recall_session", '{"key":"đã hỏi"}'), obs(FRESH)], "Chưa có."),
  ];

  // R12-01 (old code: errored cases were dropped from every denominator below)
  const clean = isoCase("ISO-OK");
  const bad = isoCase("ISO-ERR");
  const sOk = sc1(clean, isoCleanTurns());
  const rowsOnlyOk = liveRows([sOk]);
  const sErr = sc1(bad, [isoCleanTurns()[0], errTurn()]);
  const rowsE = liveRows([sOk, sErr]);
  check(
    "R12-01 isolation: a clean case alone is PASS (0/1) ...",
    rowsOnlyOk.isolation_leak.status === "PASS" &&
      rowsOnlyOk.isolation_leak.n === 1,
  );
  check(
    "R12-01 isolation: ... adding an errored case turns it into FAIL, n=2, reason 'errored' (old code: PASS 0/1)",
    rowsE.isolation_leak.status === "FAIL" &&
      rowsE.isolation_leak.n === 2 &&
      rowsE.isolation_leak.note.includes("1 errored") &&
      rowsE.isolation_leak.note.includes("ISO-ERR"),
    JSON.stringify(rowsE.isolation_leak),
  );
  const fc = mk("FR-OK", "recall_fresh", [T("Tôi đã hỏi gì?", "recall")]);
  const fe = mk("FR-ERR", "recall_fresh", [T("Lúc nãy hỏi gì?", "recall")]);
  const freshOk = ok(
    [act("recall_session", '{"key":"k"}'), obs(FRESH)],
    "Chưa có câu hỏi nào.",
  );
  const rowsF = liveRows([sc1(fc, [freshOk]), sc1(fe, [errTurn()])]);
  check(
    "R12-01 fabricated: an errored recall_fresh case cannot PASS the hard gate (old code: PASS 0/1)",
    rowsF.fabricated_recall.status === "FAIL" &&
      rowsF.fabricated_recall.n === 2 &&
      rowsF.fabricated_recall.note.includes("errored"),
  );
  const e1 = mk("EX-ERR", "explicit_article", [T("Điều 8?")], {
    gold_articles: [8],
    expected_first_tool: "get_article",
  });
  const e0 = mk("EX-OK", "explicit_article", [T("Điều 9?")], {
    gold_articles: [9],
    expected_first_tool: "get_article",
  });
  const exOk = ok(
    [act("get_article", '{"article_number":9}'), obs("t", [9])],
    "Điều 9",
  );
  const rowsT = liveRows([sc1(e0, [exOk]), sc1(e1, [errTurn()])]);
  check(
    "R12-01 tool choice: 1 ok + 1 errored = 1/2 FAIL, not 1/1 (old code: PASS 100%)",
    rowsT.tool_choice_accuracy.status === "FAIL" &&
      rowsT.tool_choice_accuracy.n === 2 &&
      rowsT.tool_choice_accuracy.observed === 0.5,
  );
  check(
    "R12-01 budget: 1 ok + 1 errored = 1/2 FAIL (old code: 0/1 PASS)",
    rowsT.budget_exhausted_rate.status === "FAIL" &&
      rowsT.budget_exhausted_rate.n === 2,
  );
  const rbTurns = [T(Q25), T("Tôi vừa hỏi về điều nào?", "recall")];
  const rb = mk("RB-OK", "recall_basic", rbTurns, { answer_names: [25] });
  const rbE = mk("RB-ERR", "recall_basic", rbTurns, { answer_names: [25] });
  const rbOk = [
    ok(
      [act("get_article", '{"article_number":25}'), obs("t", [25])],
      "Điều 25",
    ),
    ok(
      [act("recall_session", '{"key":"k"}'), obs(`[query] ${Q25}`)],
      "Bạn hỏi về Điều 25",
    ),
  ];
  const rowsR = liveRows([sc1(rb, rbOk), sc1(rbE, [rbOk[0], errTurn()])]);
  check(
    "R12-01 recall accuracy: 1 ok + 1 errored = 0.5 FAIL (old code: 1/1 PASS)",
    rowsR.recall_accuracy.status === "FAIL" && rowsR.recall_accuracy.n === 2,
  );
  const ftOk = mk("FT-OK", "false_trigger", [
    T("Câu đầu tiên của khoản 2 Điều 5?"),
  ]);
  const ftE = mk("FT-ERR", "false_trigger", [T("Phải báo trước bao lâu?")]);
  const rowsX = liveRows([
    sc1(ftOk, [
      ok([act("search_legal_articles", '{"query":"q"}'), obs("x", [5])], "x"),
    ]),
    sc1(ftE, [errTurn()]),
  ]);
  check(
    "R12-01 false trigger: 1 ok + 1 errored = 1/2 FAIL (old code: 0/1 PASS)",
    rowsX.false_recall_trigger_rate.status === "FAIL" &&
      rowsX.false_recall_trigger_rate.n === 2,
  );
  const allErr = [
    sc1(e1, [errTurn()]),
    sc1(bad, [errTurn()]),
    sc1(fe, [errTurn()]),
    sc1(rbE, [errTurn()]),
    sc1(ftE, [errTurn()]),
  ];
  const rowsA = liveRows(allErr);
  const notFail = Object.values(rowsA)
    .filter(
      (r) =>
        r.id !== "bl1_citation_recall_delta" &&
        r.id !== "bl2_recall5_delta" &&
        r.id !== "p95_latency_ratio",
    )
    .filter((r) => r.status !== "FAIL")
    .map((r) => `${r.id}=${r.status}`);
  check(
    "R12-01 all cases errored: every non-BL KPI is FAIL (invalid tool-call rate with no calls included)",
    notFail.length === 0,
    notFail.join(", "),
  );
  const emptyRows = Object.values(liveRows([]));
  const gEmpty = kpiGateFailures(emptyRows, { noBl1: true }).map(
    (x) => x.split(":")[0],
  );
  check(
    "R12-01 --fail-on-kpi: NOT MEASURED sign-off/hard KPIs fail the gate; BL2 and (with --no-bl1) BL1/p95 do not",
    gEmpty.includes("isolation_leak") &&
      gEmpty.includes("fabricated_recall") &&
      gEmpty.includes("tool_choice_accuracy") &&
      !gEmpty.includes("bl2_recall5_delta") &&
      !gEmpty.includes("bl1_citation_recall_delta") &&
      !gEmpty.includes("p95_latency_ratio"),
    gEmpty.join(","),
  );
  const gWith = kpiGateFailures(emptyRows, { noBl1: false }).map(
    (x) => x.split(":")[0],
  );
  check(
    "R12-01 --fail-on-kpi: without --no-bl1 a NOT MEASURED BL1 delta and p95 fail the gate, BL2 still does not",
    gWith.includes("bl1_citation_recall_delta") &&
      gWith.includes("p95_latency_ratio") &&
      !gWith.includes("bl2_recall5_delta"),
  );
}
