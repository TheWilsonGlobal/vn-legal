// Live agent eval runner (ER1). MODE: live only. There is no mock, replay or local-model mode.
//
// pnpm exec tsx apps/server/tests/eval/agent/runner.ts [--base-url URL] [--no-bl1]
//     [--bl2-report PATH] [--out DIR] [--dry-run] [--fail-on-kpi]
//
// Exit codes: 0 run finished and report written; 1 unexpected failure (or a failing KPI
// with --fail-on-kpi); 2 precondition failed (server unreachable, C9 llm_status
// disconnected, BL1 precondition); 3 cost guard (estimate over budget, or the running sum of
// done.total_tokens passed the budget mid-run: run FAILED, remaining cases not attempted);
// 4 invalid dataset. --fail-on-kpi also fails on NOT MEASURED sign-off/hard KPIs (not BL2;
// not BL1/p95 with --no-bl1).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectRecallIntent } from "../../../src/agent/memory/intent";
import {
  CookieJar,
  type Header,
  Http,
  PreconditionError,
  createSession,
  preflight,
  runLegacy,
  runTurn,
} from "./client";
import {
  CostGuardError,
  assertWithinBudget,
  describeEstimate,
  estimateTokens,
  exceedsTokenBudget,
  parseBudget,
  sumReportedTokens,
} from "./cost";
import {
  DATASET_PATH,
  loadCorpus,
  loadDataset,
  validateDataset,
} from "./dataset";
import { pushScores } from "./langfuse";
import { assertLegacyPrecondition } from "./legacy";
import {
  buildReport,
  kpiGateFailures,
  toMarkdown,
  writeReport,
} from "./report";
import { BL1_TYPES, aggregate, compareBl1, scoreCase } from "./scorers";
import { loadBl2 } from "./bl2-load";
import type { CaseRun, LegacyOutcome, TurnOutcome } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = resolve(here, "reports");
const ENV_FILE = resolve(here, "../../../../../.env");

interface Args {
  baseUrl: string;
  bl1: boolean;
  bl2Report: string | null;
  out: string;
  dryRun: boolean;
  failOnKpi: boolean;
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): Args {
  const a: Args = {
    baseUrl: env.EVAL_SERVER_URL ?? "http://127.0.0.1:3000",
    bl1: true,
    bl2Report: null,
    out: REPORT_DIR,
    dryRun: false,
    failOnKpi: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${x} needs a value`);
      return v;
    };
    if (x === "--base-url") a.baseUrl = next();
    else if (x === "--no-bl1") a.bl1 = false;
    else if (x === "--bl2-report") a.bl2Report = resolve(next());
    else if (x === "--out") a.out = resolve(next());
    else if (x === "--dry-run") a.dryRun = true;
    else if (x === "--fail-on-kpi") a.failOnKpi = true;
    else throw new Error(`unknown argument ${x}`);
  }
  a.baseUrl = a.baseUrl.replace(/\/+$/, "");
  return a;
}

function gitCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: here,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  const env = process.env;
  const args = parseArgs(process.argv.slice(2), env);

  // Dataset must be valid before anything is spent.
  const { file, sha256 } = loadDataset();
  const problems = validateDataset(file, loadCorpus(), detectRecallIntent);
  if (problems.length > 0) {
    console.error(`DATASET INVALID (${DATASET_PATH}):`);
    for (const p of problems) console.error(`  - ${p}`);
    return 4;
  }
  const cases = file.cases;
  const legacyCases = args.bl1
    ? cases.filter((c) => BL1_TYPES.has(c.type))
    : [];
  const budget = parseBudget(env.EVAL_MAX_TOKENS_BUDGET);

  if (args.dryRun) {
    const assumed = Number(env.AGENT_MAX_STEPS ?? 4);
    const est = estimateTokens(cases, assumed, legacyCases.length, budget);
    console.log(
      `DRY RUN (no server contact; max_steps ${assumed} is an assumption, the live run reads C9)`,
    );
    console.log(describeEstimate(est));
    return est.estimated_tokens > est.budget ? 3 : 0;
  }

  // 1. Preconditions: server reachable, LLM connected, Gemini + native + RB1 index.
  let info;
  try {
    info = await preflight(args.baseUrl);
  } catch (e) {
    if (e instanceof PreconditionError) {
      console.error(`PRECONDITION FAILED: ${e.message}`);
      return 2;
    }
    throw e;
  }
  let bl1Pre: string | null = null;
  if (args.bl1) {
    try {
      const pre = assertLegacyPrecondition(
        env,
        existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : null,
      );
      bl1Pre = `LLM_PROVIDER=${pre.llm_provider}; LLM_API_URL ${pre.llm_api_url_host ?? "unset"} (checked in the runner env and repo .env, not read back from the server process)`;
    } catch (e) {
      console.error(`PRECONDITION FAILED: ${(e as Error).message}`);
      return 2;
    }
  }

  // 2. Cost guard.
  const est = estimateTokens(cases, info.max_steps, legacyCases.length, budget);
  console.log(describeEstimate(est));
  try {
    assertWithinBudget(est);
  } catch (e) {
    if (e instanceof CostGuardError) {
      console.error(e.message);
      return 3;
    }
    throw e;
  }

  // 3. Run. Concurrency 1; no retry, no skip, no exclusion.
  const timeout = Number(env.EVAL_REQUEST_TIMEOUT_MS ?? 180_000);
  const startedAt = new Date();
  const header: Header = {
    provider: "gemini",
    model: null,
    index_id: info.embedding.index_id,
  };
  console.log(
    `MODE: live  provider: gemini  index_id: ${header.index_id}  max_steps: ${info.max_steps}  C9 model: ${info.model}`,
  );
  const runs: CaseRun[] = [];
  const legacy = new Map<string, LegacyOutcome>();
  let rateLimited = 0;

  let abortReason: string | null = null;
  for (const c of cases) {
    const used = sumReportedTokens(runs);
    if (exceedsTokenBudget(used, budget)) {
      // Not attempted: recorded as a case with no turns, which scores as errored.
      abortReason ??= `token budget exceeded: sum of done.total_tokens ${used} > EVAL_MAX_TOKENS_BUDGET ${budget} before ${c.id}; this and the remaining cases were not attempted`;
      runs.push({ case: c, turns: [] });
      console.log(`SKIP  ${c.id} not attempted (token budget exceeded)`);
      continue;
    }
    const http = new Http(args.baseUrl, new CookieJar(), timeout);
    const sessions = new Map<string, string>();
    const turns: TurnOutcome[] = [];
    for (const t of c.turns) {
      let sid = sessions.get(t.session);
      if (!sid) {
        const made = await createSession(http); // C3
        if (typeof made !== "string") {
          turns.push({ ok: false, error: made, wall_ms: 0 });
          break;
        }
        sid = made;
        sessions.set(t.session, sid);
      }
      const out = await runTurn(http, sid, t.query, header); // C2
      turns.push(out);
      if (out.ok === false) {
        if (out.error.kind === "rate_limited") rateLimited += 1;
        break;
      }
    }
    runs.push({ case: c, turns });
    const bad = turns.find((t) => t.ok === false);
    console.log(
      `${bad && bad.ok === false ? "ERROR" : "ok   "} ${c.id} (${turns.length}/${c.turns.length} turns)${bad && bad.ok === false ? ` ${bad.error.kind}: ${bad.error.detail}` : ""}`,
    );
    if (args.bl1 && BL1_TYPES.has(c.type)) {
      const lg = await runLegacy(
        new Http(args.baseUrl, new CookieJar(), timeout),
        c.turns[0].query,
      );
      legacy.set(c.id, lg);
      if (lg.ok === false)
        console.log(`  legacy ERROR ${lg.error.kind}: ${lg.error.detail}`);
    }
  }

  // 4. Score and report.
  const ctx = {
    max_steps: info.max_steps,
    all_queries: cases.flatMap((c) => c.turns.map((t) => t.query)),
  };
  const scores = runs.map((r) => scoreCase(r, ctx));
  const agg = aggregate(scores);
  const bl1 = args.bl1 ? compareBl1(runs, scores, legacy) : null;
  const bl2Loaded = args.bl2Report
    ? loadBl2(args.bl2Report, {
        index_id: header.index_id,
        dataset_sha256: sha256,
      })
    : null;
  if (bl2Loaded?.refused) console.error(bl2Loaded.refused);
  const bl2 = bl2Loaded?.summary ?? null;
  const finished = new Date();
  const stamp = finished.toISOString().replace(/[:.]/g, "-");
  const runName = `agent-eval-${stamp}`;
  const langfusePush = await pushScores(env, runs, scores, runName);
  const report = buildReport({
    meta: {
      mode: "live",
      label: "",
      run_name: runName,
      provider: "gemini",
      chat_model: header.model,
      embedding_index_id: header.index_id,
      server_url: args.baseUrl,
      dataset_sha256: sha256,
      commit: gitCommit(),
      started_at: startedAt.toISOString(),
      finished_at: finished.toISOString(),
      max_steps: info.max_steps,
      bl1_precondition: bl1Pre,
    },
    runs,
    scores,
    agg,
    bl1,
    bl2,
    bl2_source: args.bl2Report,
    bl2_refused: bl2Loaded?.refused ?? null,
    cost: est,
    rate_limited_count: rateLimited,
    langfuse_push: langfusePush,
    abort_reason: abortReason,
  });
  const paths = writeReport(report, args.out, stamp, "agent_eval");
  console.log(toMarkdown(report));
  console.log(`report: ${paths.json}\nsummary: ${paths.md}`);
  if (abortReason) {
    console.error(`RUN FAILED: ${abortReason}`);
    return 3;
  }
  if (args.failOnKpi) {
    const gaps = kpiGateFailures(report.kpis, { noBl1: !args.bl1 });
    if (gaps.length > 0) {
      console.error(`--fail-on-kpi: ${gaps.length} KPI(s) not passing`);
      for (const g of gaps) console.error(`  - ${g}`);
      return 1;
    }
  }
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error(`RUNNER FAILED: ${(e as Error).stack ?? e}`);
    process.exitCode = 1;
  },
);
