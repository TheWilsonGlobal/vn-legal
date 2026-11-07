import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDataset } from "../dataset";
import { estimateTokens } from "../cost";
import {
  type ReportInput,
  buildReport,
  computeKpiRows,
  toMarkdown,
  writeReport,
} from "../report";
import { aggregate, compareBl1 } from "../scorers";
import type { LegacyOutcome } from "../types";
import { TestContext, same } from "./context";
import { createFixtureWorld } from "./fixture-world";

export function runReportAssemblyTests(ctx: TestContext) {
  const { check } = { check: ctx.check.bind(ctx) };
  const { file: dataset, sha256 } = loadDataset();
  const { runs, scores } = createFixtureWorld();
  const agg = aggregate(scores);

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

  // ---------------------------------------------------------------------------
  // 4. Report assembly (MODE: mock) and the plan KPI table
  // ---------------------------------------------------------------------------
  const reportInput = (mode: "mock" | "live"): ReportInput => ({
    meta: {
      mode,
      label:
        "SELF-TEST FIXTURES: hand-written AgentRunResponse objects, not model output",
      run_name: "selftest",
      provider: "gemini",
      chat_model: "fixture-model",
      embedding_index_id: "fixture-index",
      server_url: null,
      dataset_sha256: sha256,
      commit: null,
      started_at: "t0",
      finished_at: "t1",
      max_steps: 4,
      bl1_precondition: null,
    },
    runs,
    scores,
    agg,
    bl1,
    bl2: null,
    bl2_source: null,
    cost: estimateTokens(dataset.cases, 4, 27, 1_000_000),
    rate_limited_count: 1,
    langfuse_push: "langfuse_push: disabled (LANGFUSE_ENABLED is not true)",
  });

  const mockReport = buildReport(reportInput("mock"));
  check(
    "report (mock): header says MODE mock with the fixture label and claims 0 KPIs",
    mockReport.header.MODE === "mock" &&
      mockReport.header.kpis_claimed === 0 &&
      mockReport.header.label.startsWith("SELF-TEST FIXTURES"),
  );
  check(
    "report (mock): all 11 KPI rows are NOT MEASURED, none observed",
    mockReport.kpis.length === 11 &&
      mockReport.kpis.every(
        (k) =>
          k.status === "NOT MEASURED" && k.observed === null && k.mode === "mock",
      ),
  );
  const md = toMarkdown(mockReport);
  check(
    "report (mock): markdown carries MODE: mock and no PASS/FAIL cell",
    md.includes("MODE: mock") && !/\| (PASS|FAIL) \|/.test(md),
  );
  check(
    "report: 429 count and langfuse_push line are separate fields",
    mockReport.rate_limited_429_count === 1 &&
      mockReport.langfuse_push.startsWith("langfuse_push: disabled"),
  );
  {
    const tmp = mkdtempSync(join(tmpdir(), "agent-eval-selftest-"));
    const paths = writeReport(mockReport, tmp, "stamp", "selftest");
    const onDisk = JSON.parse(readFileSync(paths.json, "utf8"));
    check(
      "report: the JSON artifact equals the in-memory report that the console prints",
      same(onDisk, JSON.parse(JSON.stringify(mockReport))) &&
        readFileSync(paths.md, "utf8") === md,
    );
    rmSync(tmp, { recursive: true, force: true });
  }

  // Verdicts must follow the numbers (computed rows, not claimed).
  const rows = Object.fromEntries(
    computeKpiRows(reportInput("live")).map((r) => [r.id, r]),
  );
  check(
    "verdict: invalid tool-call rate 1/21 = 4.76% <= 5% is PASS",
    rows.invalid_tool_call_rate.status === "PASS",
  );
  check(
    "verdict: tool choice 2/3 < 0.85, budget 2/4 > 10%, run error 1/14 > 0, recall accuracy 3/4 < 0.9 are FAIL",
    [
      "tool_choice_accuracy",
      "budget_exhausted_rate",
      "run_error_rate",
      "recall_accuracy",
    ].every((k) => rows[k].status === "FAIL"),
  );
  check(
    "verdict: isolation 1, fabricated 1, false trigger 1/2 are FAIL",
    ["isolation_leak", "fabricated_recall", "false_recall_trigger_rate"].every(
      (k) => rows[k].status === "FAIL",
    ),
  );
  check(
    "verdict: BL1 delta 0 and p95 ratio 0.5 are PASS; BL2 without a report is NOT MEASURED",
    rows.bl1_citation_recall_delta.status === "PASS" &&
      rows.p95_latency_ratio.status === "PASS" &&
      rows.bl2_recall5_delta.status === "NOT MEASURED",
  );
  check(
    "verdict: zero-failure hard KPI note carries the 3/n bound",
    (() => {
      const z = aggregate(scores.filter((s) => s.case_id !== "F7"));
      const r = computeKpiRows({ ...reportInput("live"), agg: z }).find(
        (k) => k.id === "isolation_leak",
      );
      return r?.status === "PASS" && (r?.note ?? "").includes("3/n");
    })(),
  );
}
