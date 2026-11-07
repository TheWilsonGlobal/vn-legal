// Self-test of the agent eval suite. MODE: mock. Scorers, report assembly and the
// dataset validator are exercised on hand-written fixtures and on the corpus.
// NO KPI IS CLAIMED FROM THIS RUN: the fixtures are invented, not model output.
//
//   pnpm exec tsx apps/server/tests/eval/agent/self-test.ts      (exit 0 = all checks pass)

import { TestContext } from "./self-test/context";
import { runDatasetAndLeakageTests } from "./self-test/test-dataset-leakage";
import { runStatsAndScorersTests } from "./self-test/test-stats-scorers";
import { runCaseScoringTests } from "./self-test/test-case-scoring";
import { runAggregatesAndBlTests } from "./self-test/test-aggregates-bl";
import { runLegacyClientLangfuseTests } from "./self-test/test-legacy-client-langfuse";
import { runReportAssemblyTests } from "./self-test/test-report-assembly";
import { runReviewR12GatesTests } from "./self-test/test-review-r12-gates";
import { runReviewR12ChecksTests } from "./self-test/test-review-r12-checks";
import { runR12LangfuseAndPlanTests } from "./self-test/test-r12-langfuse-plan";

console.log(
  "MODE: mock (self-test on hand-written fixtures; no KPI is claimed)\n",
);

const ctx = new TestContext();

async function main() {
  runDatasetAndLeakageTests(ctx);
  runStatsAndScorersTests(ctx);
  runCaseScoringTests(ctx);
  runAggregatesAndBlTests(ctx);
  await runLegacyClientLangfuseTests(ctx);
  runReportAssemblyTests(ctx);
  runReviewR12GatesTests(ctx);
  runReviewR12ChecksTests(ctx);
  runR12LangfuseAndPlanTests(ctx);

  console.log(`\n${ctx.total - ctx.failures}/${ctx.total} checks passed`);
  process.exit(ctx.failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unhandled error in self-test:", err);
  process.exit(1);
});
