import { readFileSync } from "node:fs";
import { buildLangfuseScores, langfuseTagNote } from "../langfuse";
import { scoreCase } from "../scorers";
import { KPI_DEFS } from "../thresholds";
import type { TurnOutcome } from "../types";
import { TestContext } from "./context";
import { T, act, createFixtureWorld, mk, obs, ok, run } from "./fixture-world";

export function runR12LangfuseAndPlanTests(ctx: TestContext) {
  const { check } = { check: ctx.check.bind(ctx) };
  const { ctx: evalCtx } = createFixtureWorld();

  // R12-10 langfuse run name
  {
    const t = ok(
      [act("get_article", '{"article_number":8}'), obs("t", [8])],
      "Điều 8",
      10,
    ) as Extract<TurnOutcome, { ok: true }>;
    t.response.trace_id = "b".repeat(32);
    const c = mk("LF", "explicit_article", [T("q")], {
      gold_articles: [8],
      expected_first_tool: "get_article",
    });
    const rr = run(c, [t]);
    const built = buildLangfuseScores([rr], [scoreCase(rr, evalCtx)], "agent-eval-X");
    check(
      "R12-10 langfuse: every score carries the run name in comment and metadata; the push line states the tag was not applied (old code: no run name)",
      built.scores.length === 2 &&
        built.scores.every(
          (x) =>
            (x.comment ?? "").includes("agent-eval-X") &&
            x.metadata?.eval_run === "agent-eval-X",
        ) &&
        langfuseTagNote("agent-eval-X").includes(
          "tag eval:agent-eval-X not applied (C2 has no tag param)",
        ),
    );
  }

  // KPI definitions vs the plan table (verbatim).
  {
    const planPath =
      process.env.EVAL_PLAN_PATH ??
      "C:/Git/.notes/JOBs/xAie/legal/vn-legal/changes-02/phase-01/plan.md";
    const lines = readFileSync(planPath, "utf8").split(/\r?\n/);
    const start = lines.findIndex((l) =>
      l.trim().startsWith("| KPI | Target | Gate |"),
    );
    const cells = lines.slice(start + 2, start + 13).map((l) =>
      l
        .trim()
        .replace(/^\|\s*/, "")
        .replace(/\s*\|$/, "")
        .split(/\s+\|\s+/)
        .map((c) => c.trim()),
    );
    const mismatches: string[] = [];
    KPI_DEFS.forEach((k, i) => {
      const c = cells[i];
      if (!c || c[0] !== k.name || c[1] !== k.target || c[2] !== k.gate)
        mismatches.push(`${k.id}: plan=${JSON.stringify(c)}`);
    });
    check(
      `thresholds: 11 KPI rows equal plan lines ${start + 3}-${start + 13} verbatim (name, target, gate)`,
      KPI_DEFS.length === 11 && cells.length === 11 && mismatches.length === 0,
      mismatches.join(" | "),
    );
  }
}
