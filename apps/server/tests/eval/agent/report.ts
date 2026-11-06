// Report assembly: KPI rows, JSON artifact, Markdown summary. Pure except write().

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Bl2Summary } from "./bl2-metrics";
import type { CostEstimate } from "./cost";
import { type Aggregates, type Bl1Result, type CaseScore } from "./scorers";
import { type Rate, fmtRate, zeroFailureUpperBound } from "./stats";
import { KPI_DEFS, type KpiDef, type KpiId, meetsTarget } from "./thresholds";
import type { CaseRun, TurnOutcome } from "./types";

export type KpiStatus = "PASS" | "FAIL" | "NOT MEASURED";

export interface KpiRow {
  id: KpiId;
  metric: string;
  formula: string;
  target: string;
  gate: string;
  baseline: string;
  observed: number | null;
  observed_text: string;
  n: number;
  mode: string;
  status: KpiStatus;
  note: string;
}

export interface ReportMeta {
  mode: "live" | "mock";
  /** Free text; the self-test sets it to say the numbers are fixtures. */
  label: string;
  run_name: string;
  provider: string;
  chat_model: string | null;
  embedding_index_id: string | null;
  server_url: string | null;
  dataset_sha256: string;
  commit: string | null;
  started_at: string;
  finished_at: string;
  max_steps: number | null;
  bl1_precondition: string | null;
}

export interface ReportInput {
  meta: ReportMeta;
  runs: readonly CaseRun[];
  scores: readonly CaseScore[];
  agg: Aggregates;
  bl1: Bl1Result | null;
  bl2: Bl2Summary | null;
  bl2_source: string | null;
  cost: CostEstimate;
  rate_limited_count: number;
  langfuse_push: string;
  /** set when the run ended early (token budget): remaining cases were not attempted */
  abort_reason?: string | null;
  /** set when a BL2 report was given but refused (index or dataset mismatch) */
  bl2_refused?: string | null;
}

const FORMULAS: Record<KpiId, string> = {
  bl1_citation_recall_delta:
    "mean over paired seed/multi_hop/explicit cases of |gold ∩ cited| / |gold| (agent: union of observation.citations; legacy: seed+path articles) — agent minus legacy; legacy errors excluded and listed, an agent-errored case scores recall 0 and stays in the mean",
  bl2_recall5_delta:
    "mean over gold cases of |gold ∩ top5| / |gold| with Gemini 768-d minus the same with the old 384-d index (retrieval only)",
  invalid_tool_call_rate:
    "action steps whose tool is unknown, whose tool_input is not JSON, or whose JSON fails the section 5.2 schema / all action steps",
  tool_choice_accuracy:
    "first action tool == expected tool, over explicit_article, multi_hop and global cases (an errored case counts as a miss and stays in n)",
  budget_exhausted_rate:
    "cases (seed, multi_hop, explicit_article, global) with action steps >= AGENT_MAX_STEPS and no gold citation, or that errored / those cases",
  run_error_rate:
    "cases with any errored turn / all cases (errors are never excluded)",
  p95_latency_ratio:
    "agent p95 wall ms / legacy p95 wall ms over the BL1-paired cases (nearest-rank)",
  recall_accuracy:
    "recall_ok over recall_basic, recall_far and followup_window cases (an errored case counts as a miss and stays in n)",
  isolation_leak:
    "isolation cases whose session B output contains session A content, or whose session B never called recall_session, or that errored / isolation cases (an errored case is a failure)",
  fabricated_recall:
    "recall_fresh cases without a recall_session call showing the fresh-session result, or whose answer names an article, quotes a dataset question or asserts a prior question, or that errored / recall_fresh cases",
  false_recall_trigger_rate:
    "false_trigger cases where recall_session was called / false_trigger cases",
};

function rateRow(
  def: KpiDef,
  r: Rate,
  mode: string,
  note: string,
  baseline = "none (first measurement)",
): KpiRow {
  const measured = r.value !== null;
  const observed = measured ? (r.value as number) : null;
  const ok = measured && meetsTarget(def.op, observed as number, def.value);
  let extra = note;
  if (measured && def.op === "==" && r.k === 0) {
    const ub = zeroFailureUpperBound(r.n);
    extra += ` Zero failures in n=${r.n}: true failure rate < ${((ub as number) * 100).toFixed(1)}% at 95% confidence (3/n).`;
  }
  return {
    id: def.id,
    metric: def.name,
    formula: FORMULAS[def.id],
    target: def.target,
    gate: def.gate,
    baseline,
    observed,
    observed_text: fmtRate(r),
    n: r.n,
    mode,
    status: !measured ? "NOT MEASURED" : ok ? "PASS" : "FAIL",
    note: extra.trim(),
  };
}

function valueRow(
  def: KpiDef,
  observed: number | null,
  n: number,
  text: string,
  mode: string,
  note: string,
): KpiRow {
  return {
    id: def.id,
    metric: def.name,
    formula: FORMULAS[def.id],
    target: def.target,
    gate: def.gate,
    baseline: "none (first measurement)",
    observed,
    observed_text: observed === null ? "not measured" : text,
    n,
    mode,
    status:
      observed === null
        ? "NOT MEASURED"
        : meetsTarget(def.op, observed, def.value)
          ? "PASS"
          : "FAIL",
    note,
  };
}

const def = (id: KpiId): KpiDef => KPI_DEFS.find((k) => k.id === id) as KpiDef;

/** KPI rows computed from the inputs, whatever the mode. buildReport decides what may be claimed. */
export function computeKpiRows(i: ReportInput): KpiRow[] {
  const mode = i.meta.mode;
  const a = i.agg;
  const b1 = i.bl1;
  const rows: KpiRow[] = [];

  rows.push(
    valueRow(
      def("bl1_citation_recall_delta"),
      b1?.delta ?? null,
      b1?.n_paired ?? 0,
      b1 && b1.delta !== null
        ? `${b1.delta.toFixed(3)} (agent ${b1.agent_mean_recall?.toFixed(3)} vs legacy ${b1.legacy_mean_recall?.toFixed(3)}, n=${b1.n_paired} paired of ${b1.n_cases}; legacy errors ${b1.legacy_errors.length})`
        : "",
      `${mode} (live agent + live legacy, same server)`,
      b1
        ? `legacy errors (excluded, listed): ${b1.legacy_errors.join("; ") || "none"}. Agent errors (kept, recall 0): ${b1.agent_errors_in_bl1_set.join(", ") || "none"}${b1.agent_errors_paired.length > 0 ? `; of those ${b1.agent_errors_paired.join(", ")} paired with a working legacy run` : ""}`
        : "BL1 not run (--no-bl1)",
    ),
  );
  rows.push(
    valueRow(
      def("bl2_recall5_delta"),
      i.bl2?.delta_recall5 ?? null,
      i.bl2?.n ?? 0,
      i.bl2
        ? `${i.bl2.delta_recall5.toFixed(3)} (new ${i.bl2.new.recall5.toFixed(3)} vs old ${i.bl2.old.recall5.toFixed(3)}, n=${i.bl2.n})`
        : "",
      "live embeddings, retrieval only, no LLM",
      i.bl2
        ? `source ${i.bl2_source}`
        : (i.bl2_refused ??
            "old-index-compare.ts has not produced a report for this run"),
    ),
  );
  rows.push(
    rateRow(
      def("invalid_tool_call_rate"),
      a.invalid_tool_call,
      mode,
      `invalid calls listed in the artifact (${a.failing.invalid_tool_calls.length}). LOWER BOUND: the client sees only the recorded steps; tool calls the server rejects before recording are invisible, so the true rate is at least this.`,
    ),
  );
  rows.push(
    rateRow(
      def("tool_choice_accuracy"),
      a.tool_choice,
      mode,
      `wrong first tool: ${a.failing.tool_choice.join(", ") || "none"}`,
    ),
  );
  rows.push(
    rateRow(
      def("budget_exhausted_rate"),
      a.budget_exhausted,
      mode,
      `exhausted: ${a.failing.budget_exhausted.join(", ") || "none"}`,
    ),
  );
  rows.push(
    rateRow(
      def("run_error_rate"),
      a.run_error,
      mode,
      `errored: ${a.errored_ids.join(", ") || "none"}; 429 beyond retry budget: ${i.rate_limited_count}`,
    ),
  );

  rows.push(
    valueRow(
      def("p95_latency_ratio"),
      b1?.p95_ratio ?? null,
      b1?.n_paired ?? 0,
      b1 && b1.p95_ratio !== null
        ? `${b1.p95_ratio.toFixed(2)} (agent p95 ${b1.agent_p95_ms?.toFixed(0)} ms, legacy p95 ${b1.legacy_p95_ms?.toFixed(0)} ms, n=${b1.n_paired}; p95 over so few samples is the maximum or near it)`
        : "",
      mode,
      b1 && b1.agent_errors_paired.length > 0
        ? `UNMEASURABLE: agent errors in the paired set (${b1.agent_errors_paired.join(", ")}) have no scored wall time; dropping them would shrink p95`
        : b1
          ? "wall-clock at the client; 429 waits included"
          : "BL1 not run (--no-bl1): p95 ratio needs the legacy arm",
    ),
  );
  rows.push(
    rateRow(
      def("recall_accuracy"),
      a.recall_accuracy,
      mode,
      `failing: ${a.failing.recall.join(", ") || "none"}`,
    ),
  );

  const iso = a.isolation_leak;
  const isoErr = a.errored_by_kpi.isolation_leak;
  rows.push(
    valueRow(
      def("isolation_leak"),
      iso.n > 0 ? iso.k : null,
      iso.n,
      `${iso.k} failing in ${iso.n} cases (${isoErr.length} errored)`,
      mode,
      [
        a.failing.isolation_leak.join(", ") || "no failing case",
        isoErr.length > 0
          ? `GATE CANNOT PASS: ${isoErr.length} errored (${isoErr.join(", ")}); an errored case certifies nothing.`
          : "",
        a.failing.isolation_not_exercised.length > 0
          ? `Not exercised (session B never called recall_session, counted as failing): ${a.failing.isolation_not_exercised.join(", ")}.`
          : "",
        iso.k === 0 && iso.n > 0
          ? `Zero failures in n=${iso.n}: true leak rate < ${((zeroFailureUpperBound(iso.n) as number) * 100).toFixed(0)}% at 95% confidence (3/n).`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );
  const fab = a.fabricated_recall;
  const fabErr = a.errored_by_kpi.fabricated_recall;
  rows.push(
    valueRow(
      def("fabricated_recall"),
      fab.n > 0 ? fab.k : null,
      fab.n,
      `${fab.k} fabricated or unverified in ${fab.n} cases (${fabErr.length} errored)`,
      mode,
      [
        a.failing.fabricated_recall.join(", ") || "none fabricated",
        fabErr.length > 0
          ? `GATE CANNOT PASS: ${fabErr.length} errored (${fabErr.join(", ")}); an errored case certifies nothing.`
          : "",
        fab.k === 0 && fab.n > 0
          ? `Zero failures in n=${fab.n}: true rate < ${((zeroFailureUpperBound(fab.n) as number) * 100).toFixed(0)}% at 95% confidence (3/n).`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );
  rows.push(
    rateRow(
      def("false_recall_trigger_rate"),
      a.false_recall_trigger,
      mode,
      `scope: the false_trigger cases (n=${a.false_recall_trigger.n}). Informational wider rate over all non-recall single-turn cases: ${fmtRate(a.recall_calls_on_non_recall_cases)}. Fired: ${a.failing.false_trigger.join(", ") || "none"}`,
    ),
  );
  // Every case errored and no tool call was recorded: the rate has no denominator, but
  // that is a failed run, not an unmeasured KPI.
  if (a.n_cases > 0 && a.n_errored === a.n_cases) {
    for (const r of rows)
      if (r.id === "invalid_tool_call_rate" && r.status === "NOT MEASURED") {
        r.status = "FAIL";
        r.note += " All cases errored: FAIL, not NOT MEASURED.";
      }
  }
  return rows;
}

export interface GateOptions {
  /** the run was made with --no-bl1 */
  noBl1: boolean;
}

/**
 * Reasons --fail-on-kpi must fail. FAIL always; NOT MEASURED too for every sign-off or
 * hard KPI, except BL2 (not a phase-01 gate) and, with --no-bl1, BL1 delta and p95.
 */
export function kpiGateFailures(
  kpis: readonly KpiRow[],
  opts: GateOptions,
): string[] {
  const out: string[] = [];
  for (const k of kpis) {
    if (k.status === "FAIL") out.push(`${k.id}: FAIL (${k.observed_text})`);
    else if (k.status === "NOT MEASURED") {
      if (k.id === "bl2_recall5_delta") continue;
      if (
        opts.noBl1 &&
        (k.id === "bl1_citation_recall_delta" || k.id === "p95_latency_ratio")
      )
        continue;
      out.push(`${k.id}: NOT MEASURED (${k.note})`);
    }
  }
  return out;
}

/**
 * What the report may claim. Mock mode never claims a KPI: every row is NOT MEASURED,
 * whatever the fixtures produced.
 */
export function buildKpiRows(i: ReportInput): KpiRow[] {
  const rows = computeKpiRows(i);
  if (i.meta.mode === "live") return rows;
  return rows.map((r) => ({
    ...r,
    observed: null,
    observed_text: "not measured (mock fixtures, no live run)",
    mode: "mock",
    status: "NOT MEASURED" as const,
    note: "mock fixtures prove the scorers and report assembly only",
  }));
}

function compactTurn(t: TurnOutcome, query: string, session: string) {
  if (t.ok === false)
    return {
      session,
      query,
      status: "error",
      error: t.error,
      wall_ms: Math.round(t.wall_ms),
    };
  const r = t.response;
  return {
    session,
    query,
    status: "ok",
    wall_ms: Math.round(t.wall_ms),
    run_id: r.run_id,
    session_id: r.session_id,
    model: r.model,
    index_id: r.embedding?.index_id,
    answer: r.answer,
    total_tokens: r.total_tokens,
    trace_id: r.trace_id,
    memory: r.memory,
    steps: r.steps.map((s) => ({
      index: s.index,
      kind: s.kind,
      tool: s.tool,
      tool_input: s.tool_input,
      ok: s.ok,
      duration_ms: s.duration_ms,
      citations: (s.citations ?? []).map((c) => ({
        article_number: c.article_number,
        via: c.via,
      })),
    })),
  };
}

export function buildReport(i: ReportInput) {
  const kpis = buildKpiRows(i);
  const cases = i.runs.map((run, idx) => ({
    ...i.scores[idx],
    gold_articles: run.case.gold_articles,
    turns: run.turns.map((t, ti) =>
      compactTurn(t, run.case.turns[ti].query, run.case.turns[ti].session),
    ),
  }));
  const claimed = kpis.filter((k) => k.status !== "NOT MEASURED").length;
  return {
    header: {
      MODE: i.meta.mode,
      label: i.meta.label,
      provider: i.meta.provider,
      chat_model: i.meta.chat_model,
      embedding_index_id: i.meta.embedding_index_id,
      run_name: i.meta.run_name,
      server_url: i.meta.server_url,
      dataset_sha256: i.meta.dataset_sha256,
      commit: i.meta.commit,
      started_at: i.meta.started_at,
      finished_at: i.meta.finished_at,
      max_steps: i.meta.max_steps,
      bl1_precondition: i.meta.bl1_precondition,
      kpis_claimed: claimed,
      abort_reason: i.abort_reason ?? null,
      invalid_tool_call_rate_note:
        "lower bound: server-side rejections are invisible to the client",
    },
    kpis,
    steps_per_run: {
      mean: i.agg.steps_per_run_mean,
      n: i.agg.steps_per_run_n,
      target: "none",
    },
    latency: {
      p50_ms: i.agg.latency_p50_ms,
      p95_ms: i.agg.latency_p95_ms,
      n: i.agg.latency_n,
      target: "none (p50); p95 is the ratio KPI above",
    },
    tokens: {
      estimated: i.cost.estimated_tokens,
      budget: i.cost.budget,
      actual_total_tokens: i.agg.total_tokens,
      runs_with_unreported_tokens: i.agg.tokens_unreported_runs,
    },
    rate_limited_429_count: i.rate_limited_count,
    langfuse_push: i.langfuse_push,
    by_type: i.agg.by_type,
    answer_citation_rate: i.agg.answer_citation_rate,
    bl1: i.bl1,
    bl2: i.bl2,
    aggregates: i.agg,
    cases,
  };
}

export type Report = ReturnType<typeof buildReport>;

export function toMarkdown(r: Report): string {
  const h = r.header;
  const lines: string[] = [];
  lines.push(`# Agent eval summary (${h.run_name})`);
  lines.push("");
  lines.push(`MODE: ${h.MODE}`);
  if (h.label) lines.push(`LABEL: ${h.label}`);
  lines.push(`provider: ${h.provider}`);
  lines.push(`chat model (done.model): ${h.chat_model ?? "n/a"}`);
  lines.push(`embedding index_id (C9): ${h.embedding_index_id ?? "n/a"}`);
  lines.push(`dataset sha256: ${h.dataset_sha256}`);
  lines.push(`commit: ${h.commit ?? "unavailable"}`);
  lines.push(`langfuse: ${r.langfuse_push}`);
  if (h.abort_reason) lines.push(`RUN ABORTED: ${h.abort_reason}`);
  lines.push(`invalid tool-call rate: ${h.invalid_tool_call_rate_note}`);
  lines.push(`429 beyond retry budget: ${r.rate_limited_429_count}`);
  lines.push("");
  lines.push("| KPI | Target | Observed | n | Mode | Status |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const k of r.kpis)
    lines.push(
      `| ${k.metric.replace(/\|/g, "\\|")} | ${k.target} | ${k.observed_text.replace(/\|/g, "\\|")} | ${k.n} | ${k.mode} | ${k.status} |`,
    );
  lines.push("");
  lines.push(
    `Steps per run (no target): ${r.steps_per_run.mean?.toFixed(2) ?? "n/a"} (n=${r.steps_per_run.n}). ` +
      `Latency p50 (no target): ${r.latency.p50_ms?.toFixed(0) ?? "n/a"} ms, p95 ${r.latency.p95_ms?.toFixed(0) ?? "n/a"} ms (n=${r.latency.n}).`,
  );
  lines.push(
    `Tokens: estimated ${r.tokens.estimated}, budget ${r.tokens.budget}, actual ${r.tokens.actual_total_tokens} (${r.tokens.runs_with_unreported_tokens} runs reported null).`,
  );
  return lines.join("\n") + "\n";
}

export function writeReport(
  report: Report,
  dir: string,
  stamp: string,
  prefix: string,
): { json: string; md: string } {
  mkdirSync(dir, { recursive: true });
  const json = join(dir, `${prefix}_${stamp}.json`);
  const md = join(dir, `${prefix}_summary.md`);
  mkdirSync(dirname(json), { recursive: true });
  writeFileSync(json, JSON.stringify(report, null, 2));
  writeFileSync(md, toMarkdown(report));
  return { json, md };
}
