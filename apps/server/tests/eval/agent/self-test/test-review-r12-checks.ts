import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBl2 } from "../bl2-load";
import { scoreBl2Case, summarizeBl2 } from "../bl2-metrics";
import { exceedsTokenBudget, sumReportedTokens } from "../cost";
import { type ReportInput, computeKpiRows } from "../report";
import {
  aggregate,
  assertsPriorQuestion,
  compareBl1,
  scoreCase,
} from "../scorers";
import type { EvalCase, LegacyOutcome, TurnOutcome } from "../types";
import { TestContext, approx, same } from "./context";
import {
  FRESH,
  T,
  act,
  createFixtureWorld,
  mk,
  obs,
  ok,
  run,
} from "./fixture-world";

export function runReviewR12ChecksTests(ctx: TestContext) {
  const { check } = { check: ctx.check.bind(ctx) };
  const { runs, scores, ctx: evalCtx } = createFixtureWorld();

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

  // R12-02 BL1
  {
    const legacy3 = new Map(legacy1);
    legacy3.set("F11", legacyOk([117], 1000));
    const b3 = compareBl1(runs, scores, legacy3);
    check(
      "R12-02 BL1: errored agent case F11 + working legacy is paired with recall 0 (agent 0.5 vs legacy 0.6667, delta -0.1667); old code dropped it (delta 0, n=2)",
      b3.n_paired === 3 &&
        approx(b3.agent_mean_recall, 0.5) &&
        approx(b3.legacy_mean_recall, 2 / 3) &&
        approx(b3.delta, -1 / 6) &&
        same(b3.agent_errors_paired, ["F11"]),
      JSON.stringify(b3),
    );
    check(
      "R12-02 BL1: p95 ratio is unmeasurable when an agent error is paired (old code: 0.5)",
      b3.p95_ratio === null && b3.agent_p95_ms === null,
    );
    const r3 = liveRows(scores, b3);
    check(
      "R12-02 BL1: the row note lists the agent errors; the p95 row says UNMEASURABLE and is NOT MEASURED",
      r3.bl1_citation_recall_delta.note.includes(
        "Agent errors (kept, recall 0): F11",
      ) &&
        r3.bl1_citation_recall_delta.status === "FAIL" &&
        r3.p95_latency_ratio.status === "NOT MEASURED" &&
        r3.p95_latency_ratio.note.includes("UNMEASURABLE"),
    );
  }

  // R12-03 fabricated recall
  {
    const q = [T("Tôi đã hỏi gì trước đó?", "recall")];
    const fr = (id: string) => mk(id, "recall_fresh", q);
    const noCall = sc1(fr("FR1"), [ok([], "Chưa có câu hỏi nào trước đó.")]);
    check(
      "R12-03 recall_fresh: no recall_session call = fabricated even with a clean answer (old code: not fabricated)",
      noCall.fabricated === true,
    );
    const badObs = sc1(fr("FR2"), [
      ok(
        [act("recall_session", '{"key":"k"}'), obs("[query] một câu hỏi nào đó")],
        "Chưa có câu hỏi nào.",
      ),
    ]);
    check(
      "R12-03 recall_fresh: recall_session called but the observation does not show the fresh-session result = fabricated (old code: not fabricated)",
      badObs.fabricated === true,
    );
    const asserts = sc1(fr("FR3"), [
      ok(
        [act("recall_session", '{"key":"k"}'), obs(FRESH)],
        "Bạn đã hỏi một câu về hợp đồng.",
      ),
    ]);
    const english = sc1(fr("FR4"), [
      ok(
        [act("recall_session", '{"key":"k"}'), obs(FRESH)],
        "As you asked earlier, contracts need consent.",
      ),
    ]);
    check(
      "R12-03 recall_fresh: an answer asserting a prior question ('bạn đã hỏi', 'you asked') is fabricated (old code: not fabricated)",
      asserts.fabricated === true && english.fabricated === true,
    );
    const good = sc1(fr("FR5"), [
      ok(
        [act("recall_session", '{"key":"k"}'), obs(FRESH)],
        "Bạn chưa hỏi câu nào trong phiên này.",
      ),
    ]);
    check(
      "R12-03 recall_fresh: tool called + fresh observation + clean answer is not fabricated; marker helper",
      good.fabricated === false &&
        good.recall_ok === true &&
        assertsPriorQuestion("Câu hỏi trước của bạn là gì") &&
        !assertsPriorQuestion("Bạn chưa hỏi gì"),
    );
  }

  // R12-04 the BL2 report must belong to this run
  {
    const tmp = mkdtempSync(join(tmpdir(), "agent-eval-bl2-"));
    const path = join(tmp, "bl2.json");
    const summary = summarizeBl2([scoreBl2Case("a", [10], [5], [10])]);
    writeFileSync(
      path,
      JSON.stringify({
        header: { new_index_id: "idx-A", dataset_sha256: "sha-A" },
        summary,
      }),
    );
    const okLoad = loadBl2(path, { index_id: "idx-A", dataset_sha256: "sha-A" });
    const badIdx = loadBl2(path, { index_id: "idx-B", dataset_sha256: "sha-A" });
    const badSha = loadBl2(path, { index_id: "idx-A", dataset_sha256: "sha-B" });
    check(
      "R12-04 BL2: matching index_id and dataset sha load; another index or dataset is refused with the reason (old code: loaded both)",
      okLoad.summary !== null &&
        badIdx.summary === null &&
        (badIdx.refused ?? "").includes(
          "new_index_id idx-A != C9 index_id idx-B",
        ) &&
        badSha.summary === null &&
        (badSha.refused ?? "").includes("dataset_sha256"),
    );
    const refusedRow = computeKpiRows({
      ...reportInput("live"),
      bl2: badIdx.summary,
      bl2_source: path,
      bl2_refused: badIdx.refused,
    }).find((k) => k.id === "bl2_recall5_delta");
    check(
      "R12-04 BL2: a refused report leaves the KPI NOT MEASURED and the row says why",
      refusedRow?.status === "NOT MEASURED" &&
        (refusedRow?.note ?? "").includes("refused"),
    );
    rmSync(tmp, { recursive: true, force: true });
  }

  // R12-05 isolation not exercised, R12-06 followup must not recall
  {
    const c = isoCase("ISO-NOREC");
    const s = sc1(c, [
      ok([act("search_legal_articles", '{"query":"a"}'), obs("t")], "a"),
      ok([act("search_legal_articles", '{"query":"b"}'), obs("t")], "Chưa có."),
    ]);
    const a2 = aggregate([s]);
    check(
      "R12-05 isolation: session B never called recall_session = not exercised = 1/1 failing, no leak found (old code: 0 leaks, PASS)",
      s.isolation_leak === false &&
        s.isolation_exercised === false &&
        a2.isolation_leak.k === 1 &&
        same(a2.failing.isolation_not_exercised, ["ISO-NOREC"]),
    );
    const f = mk(
      "FW-REC",
      "followup_window",
      [T("Giám hộ?"), T("Người đó có nghĩa vụ gì?")],
      { gold_articles: [55] },
    );
    const viaRecall = sc1(f, [
      ok([], "t1"),
      ok(
        [act("recall_session", '{"key":"k"}'), obs("t", [55])],
        "Họ phải chăm sóc",
      ),
    ]);
    check(
      "R12-06 followup_window: gold cited but recall_session was called = recall_ok false (old code: true)",
      viaRecall.gold_hit === true && viaRecall.recall_ok === false,
    );
  }

  // R12-07 running token sum
  {
    const cs = mk("TK", "seed", [T("q")]);
    const r1 = run(cs, [ok([], "a", 10, 600)]);
    const r2 = run(cs, [ok([], "a", 10, 500), ok([], "b", 10, null)]);
    const used = sumReportedTokens([r1, r2]);
    check(
      "R12-07 token meter: sums done.total_tokens (null as 0) and aborts only above the budget",
      used === 1100 &&
        exceedsTokenBudget(used, 1000) &&
        !exceedsTokenBudget(1000, 1000),
    );
    const notAttempted = sc1(
      mk("NA", "isolation", [T("a", "legal", "A"), T("b", "recall", "B")]),
      [],
    );
    check(
      "R12-07 a case not attempted after the abort scores as errored ('turns not attempted'), never as a pass",
      notAttempted.errored === true &&
        notAttempted.error === "turns not attempted",
    );
  }
}
