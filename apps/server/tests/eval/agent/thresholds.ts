// KPI targets: the single source for the runner, the report and the self-test.
// Copied verbatim from plan r5 section 11 (lines 902-918; decisions Q9 and Q24).
// Do not change a target here without changing the plan and recording why.

export type Op = ">=" | "<=" | "==";

export type KpiId =
  | "bl1_citation_recall_delta"
  | "bl2_recall5_delta"
  | "invalid_tool_call_rate"
  | "tool_choice_accuracy"
  | "budget_exhausted_rate"
  | "run_error_rate"
  | "p95_latency_ratio"
  | "recall_accuracy"
  | "isolation_leak"
  | "fabricated_recall"
  | "false_recall_trigger_rate";

export interface KpiDef {
  id: KpiId;
  /** KPI column of the plan table, verbatim. */
  name: string;
  /** Target column of the plan table, verbatim. */
  target: string;
  /** Gate column of the plan table, verbatim. */
  gate: string;
  /** Machine form of the target. */
  op: Op;
  value: number;
  /** What the observed number is. */
  unit: "delta" | "rate" | "ratio" | "count";
}

export const KPI_DEFS: readonly KpiDef[] = [
  {
    id: "bl1_citation_recall_delta",
    name: "Citation recall (agent) vs legacy `/api/consult`, same dataset, same model, same index (BL1)",
    target: "Δ ≥ −0.02 (non-inferiority)",
    gate: "blocks phase-02 removal of the legacy pipeline (Q6)",
    op: ">=",
    value: -0.02,
    unit: "delta",
  },
  {
    id: "bl2_recall5_delta",
    name: "(r4) Retrieval recall@5, Gemini 768-d index vs old 384-d index (BL2)",
    target: "Δ ≥ −0.02 (non-inferiority, Q24)",
    gate: "blocks phase-02 deletion of the old store; not a phase-01 sign-off gate",
    op: ">=",
    value: -0.02,
    unit: "delta",
  },
  {
    id: "invalid_tool_call_rate",
    name: "Invalid tool-call rate (native, Gemini): unknown tool, arguments that fail zod, or malformed JSON, over all tool calls",
    target: "≤ 5%",
    gate: "sign-off",
    op: "<=",
    value: 0.05,
    unit: "rate",
  },
  {
    id: "tool_choice_accuracy",
    name: '(r4) Tool-choice accuracy (native): the first tool matches the case type (`get_article` for an explicit "Điều N", `traverse_references` for multi-hop, `get_community_context` for global)',
    target: "≥ 0.85 (Q24)",
    gate: "sign-off",
    op: ">=",
    value: 0.85,
    unit: "rate",
  },
  {
    id: "budget_exhausted_rate",
    name: "(r4) Budget-exhausted runs (native): `AGENT_MAX_STEPS` reached with no gold citation",
    target: "≤ 10% (Q24)",
    gate: "sign-off",
    op: "<=",
    value: 0.1,
    unit: "rate",
  },
  {
    id: "run_error_rate",
    name: "Run error rate with the LLM reachable (r4: 429s that outlast the retry budget count as errors)",
    target: "0",
    gate: "sign-off",
    op: "==",
    value: 0,
    unit: "rate",
  },
  {
    id: "p95_latency_ratio",
    name: "p95 latency",
    target: "≤ 1.5 × legacy p95",
    gate: "sign-off",
    op: "<=",
    value: 1.5,
    unit: "ratio",
  },
  {
    id: "recall_accuracy",
    name: "Recall accuracy (`recall_basic`, `recall_far`, `followup_window`)",
    target: "≥ 0.9",
    gate: "sign-off",
    op: ">=",
    value: 0.9,
    unit: "rate",
  },
  {
    id: "isolation_leak",
    name: "Isolation leak (`isolation`)",
    target: "= 0",
    gate: "**hard**",
    op: "==",
    value: 0,
    unit: "count",
  },
  {
    id: "fabricated_recall",
    name: "Fabricated recall (`recall_fresh`)",
    target: "= 0",
    gate: "**hard**",
    op: "==",
    value: 0,
    unit: "count",
  },
  {
    id: "false_recall_trigger_rate",
    name: "False recall triggers (`false_trigger` and similar)",
    target: "≤ 5%",
    gate: "sign-off",
    op: "<=",
    value: 0.05,
    unit: "rate",
  },
];

/** Reported without a target. */
export const UNTARGETED = ["steps_per_run", "p50_latency_ms"] as const;

const EPS = 1e-9;

export function meetsTarget(op: Op, observed: number, value: number): boolean {
  switch (op) {
    case ">=":
      return observed >= value - EPS;
    case "<=":
      return observed <= value + EPS;
    case "==":
      return Math.abs(observed - value) <= EPS;
  }
}

export function kpiDef(id: KpiId): KpiDef {
  const def = KPI_DEFS.find((k) => k.id === id);
  if (!def) throw new Error(`unknown KPI id ${id}`);
  return def;
}
