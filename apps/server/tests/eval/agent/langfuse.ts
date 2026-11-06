// Optional Langfuse score push (plan section 11, decision Q19: scores yes, datasets no).
// Runs only when LANGFUSE_ENABLED=true. A failure is written into the report as
// `langfuse_push: failed (<reason>)` and never changes a KPI.

import { type CaseScore, scoredTurnIndex } from "./scorers";
import type { CaseRun } from "./types";

export interface LangfuseScore {
  traceId: string;
  name: "citation_recall" | "tool_choice_ok" | "recall_ok" | "isolation_leak";
  value: number;
  dataType: "NUMERIC" | "BOOLEAN";
  comment?: string;
  metadata?: { eval_run: string; case_id: string };
}

/** Pure: the scores to attach, plus how many cases had no trace id. */
export function buildLangfuseScores(
  runs: readonly CaseRun[],
  scores: readonly CaseScore[],
  runName = "",
): { scores: LangfuseScore[]; cases_without_trace: number } {
  const out: LangfuseScore[] = [];
  let missing = 0;
  runs.forEach((run, i) => {
    const s = scores[i];
    if (s.errored) return;
    const turn = run.turns[scoredTurnIndex(run.case)];
    const traceId = turn && turn.ok ? turn.response.trace_id : null;
    if (!traceId) {
      missing += 1;
      return;
    }
    // C2 has no tag parameter, so the run name travels in the comment and metadata.
    const tagged = {
      comment: `eval run ${runName} case ${s.case_id}`,
      metadata: { eval_run: runName, case_id: s.case_id },
    };
    const num = (name: LangfuseScore["name"], v: number | null) => {
      if (v !== null)
        out.push({ traceId, name, value: v, dataType: "NUMERIC", ...tagged });
    };
    const bool = (name: LangfuseScore["name"], v: boolean | null) => {
      if (v !== null)
        out.push({
          traceId,
          name,
          value: v ? 1 : 0,
          dataType: "BOOLEAN",
          ...tagged,
        });
    };
    num("citation_recall", s.citation_recall);
    bool("tool_choice_ok", s.tool_choice_ok);
    bool("recall_ok", s.recall_ok);
    bool("isolation_leak", s.isolation_leak);
  });
  return { scores: out, cases_without_trace: missing };
}

export function langfuseTagNote(runName: string): string {
  return `tag eval:${runName} not applied (C2 has no tag param); run name carried in score comment and metadata`;
}

/** Returns the `langfuse_push` line for the report. */
export async function pushScores(
  env: Record<string, string | undefined>,
  runs: readonly CaseRun[],
  scores: readonly CaseScore[],
  runName = "",
): Promise<string> {
  if (env.LANGFUSE_ENABLED !== "true")
    return "langfuse_push: disabled (LANGFUSE_ENABLED is not true)";
  try {
    const built = buildLangfuseScores(runs, scores, runName);
    const moduleName = "@langfuse/client";
    const mod = (await import(moduleName)) as {
      LangfuseClient: new () => {
        score: { create(s: LangfuseScore): void };
        flush(): Promise<void>;
      };
    };
    const client = new mod.LangfuseClient();
    for (const s of built.scores) client.score.create(s);
    await client.flush();
    return `langfuse_push: ok (${built.scores.length} scores, ${built.cases_without_trace} cases without trace id; ${langfuseTagNote(runName)})`;
  } catch (e) {
    const reason = (e as Error).message.replace(/\s+/g, " ").slice(0, 200);
    return `langfuse_push: failed (${reason})`;
  }
}
