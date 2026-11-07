// ============================================================================
// RB1: non-destructive rebuild of the Gemini 768-d congraph index
// (plan §5.9: steps 1, 1a, 2-7)
// ============================================================================

import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  config,
  configIssues,
} from "../shared/config";
import { getEmbedder, type IEmbedder } from "../embeddings/embedder-factory";
import {
  type IndexManifest,
  assertIndexManifest,
  assertServerEmbeddingConfig,
  describeEmbedder,
  manifestPathFor,
  writeManifestAtomic,
} from "../embeddings/index-manifest";
import {
  GEMINI_DOC_PREFIX,
  GEMINI_QUERY_PREFIX,
} from "../embeddings/index-manifest";
import {
  EXPECTED_DIM,
  type FileRecord,
  INDEX_ID,
  MAX_LIVE_CONCURRENCY,
  type Mode,
  OLD_STORE,
  REPO_ROOT,
  SCRIPT_NAME,
  StepError,
  UsageError,
} from "./rebuild-index/constants-types";
import {
  protectOldStore,
  recordOldStore,
  verifyOldStore,
  writeLegacyManifest,
} from "./rebuild-index/fingerprint-old-store";
import {
  buildDocs,
  loadInputs,
  loadReports,
} from "./rebuild-index/document-builder";
import { dryRun } from "./rebuild-index/token-cost-meter";
import { buildGuard } from "./rebuild-index/progress-guard";
import {
  buildIndex,
  smokeTest,
  verifyTargetDims,
} from "./rebuild-index/index-builder";
import { errorMessage, log, setLogFile, step } from "./rebuild-index/logger";

function parseArgs(argv: string[]): { mode: Mode; runDir: string | undefined } {
  const modes: Mode[] = [];
  let runDir: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--smoke") modes.push("smoke");
    else if (arg === "--offline") modes.push("offline");
    else if (arg === "--dry-run") modes.push("dry-run");
    else if (arg === "--build") modes.push("build");
    else if (arg === "--run-dir") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new UsageError("--run-dir needs a path");
      }
      runDir = value;
      i += 1;
    } else {
      throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  if (modes.length !== 1) {
    throw new UsageError(
      "choose exactly one mode: --smoke | --offline | --dry-run | --build",
    );
  }
  return { mode: modes[0], runDir };
}

function checkConfig(): void {
  if (process.cwd() !== REPO_ROOT) {
    throw new UsageError(`run from the repo root: ${REPO_ROOT}`);
  }
  if (configIssues.length > 0) {
    throw new UsageError(configIssues.join("; "));
  }
  if (config.embedding.provider !== "gemini") {
    throw new UsageError(
      `EMBEDDING_PROVIDER must be "gemini" for this script (got ${config.embedding.provider ?? "unset"})`,
    );
  }
  assertServerEmbeddingConfig(config);
  if (config.embedding.dim !== EXPECTED_DIM) {
    throw new UsageError(`EMBEDDING_DIM must be ${EXPECTED_DIM}`);
  }
  const concurrency = config.embedding.maxConcurrency;
  if (!(concurrency >= 1 && concurrency <= MAX_LIVE_CONCURRENCY)) {
    throw new UsageError(
      `EMBED_MAX_CONCURRENCY must be 1 or ${MAX_LIVE_CONCURRENCY} for live Gemini runs`,
    );
  }
  if (!(config.embedding.batchSize >= 1)) {
    throw new UsageError("EMBED_BATCH_SIZE must be a positive integer");
  }
  if (!(config.embedding.maxTokensBudget >= 1)) {
    throw new UsageError("EMBED_MAX_TOKENS_BUDGET must be a positive integer");
  }
}

async function main(): Promise<number> {
  let mode: Mode;
  let runDir: string;
  try {
    const parsed = parseArgs(process.argv.slice(2));
    mode = parsed.mode;
    runDir = resolve(
      parsed.runDir ??
        join(
          tmpdir(),
          `${SCRIPT_NAME}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
        ),
    );
    const rel = relative(REPO_ROOT, runDir);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
      throw new UsageError("--run-dir must be outside the repo");
    }
    checkConfig();
  } catch (error) {
    console.error(`[${SCRIPT_NAME}] ${errorMessage(error)}`);
    return 2;
  }

  mkdirSync(runDir, { recursive: true });
  setLogFile(join(runDir, "run.log"));
  const copyDir = join(runDir, "old-store-copy");
  const copyStore = join(copyDir, basename(OLD_STORE));
  const target = config.conGraphVectorDbPath;
  log(`mode=${mode} repo=${REPO_ROOT} run_dir=${runDir}`);
  log(`old store=${OLD_STORE} target=${target}`);
  log(
    `model=${config.embedding.model} dim=${config.embedding.dim} batch=${config.embedding.batchSize} concurrency=${config.embedding.maxConcurrency} budget=${config.embedding.maxTokensBudget}`,
  );

  let code = 0;
  let embedder: IEmbedder | undefined;
  let pre: FileRecord[] = [];
  try {
    pre = await step("0 hash old store (pre-run list)", () =>
      recordOldStore("PRE-RUN"),
    );
    if (mode === "build") {
      await step("0b build guard", () => buildGuard(target));
    }
    if (mode !== "offline") {
      embedder = await step("1 smoke: one document embedding", async () => {
        const e = await getEmbedder();
        await smokeTest(e);
        return e;
      });
    }
    if (mode === "smoke") {
      log("SMOKE ONLY: steps 1a-7 not run");
    } else {
      const counts = await step(
        "1a protect old store (copy, legacy manifest)",
        async () => {
          const c = await protectOldStore(pre, copyDir);
          await writeLegacyManifest(c);
          return c;
        },
      );
      const inputs = await step("2 inputs", () => loadInputs());
      const reports = await step("3 community reports export", () =>
        loadReports(copyStore),
      );
      const docs = buildDocs(inputs.articles, reports);
      if (mode === "offline") {
        await step("4 dry run (offline estimate)", () => dryRun(docs, true));
        log(
          "PARTIAL: offline steps only. Live smoke, live token count and build were not run.",
        );
        code = 3;
      } else {
        await step("4 dry run (exact count)", () => dryRun(docs, false));
        if (mode === "build") {
          if (!embedder) {
            throw new StepError("5 build", "embedder not initialised");
          }
          const built = await step("5 build", () =>
            buildIndex(
              target,
              docs,
              inputs.clauseCount,
              reports.length,
              embedder,
            ),
          );
          await step("6 verify", async () => {
            await verifyTargetDims(target);
            log(`verify: counts ${JSON.stringify(built)}`);
            log("recall@5 not computed (informational; ER1 gates)");
          });
          await step("7 manifest (written last)", async () => {
            const manifest: IndexManifest = {
              index_id: INDEX_ID,
              provider: "gemini",
              model: config.embedding.model,
              dim: EXPECTED_DIM,
              doc_prefix: GEMINI_DOC_PREFIX,
              query_prefix: GEMINI_QUERY_PREFIX,
              corpus_sha256: inputs.corpusSha256,
              counts: { ...built },
              created_at: new Date().toISOString(),
            };
            await writeManifestAtomic(target, manifest);
            await assertIndexManifest(target, describeEmbedder(config));
            log(`manifest written and read back: ${manifestPathFor(target)}`);
          });
        } else {
          log("DRY RUN complete. Nothing written to the target store.");
        }
      }
      log(`old store copy counts recorded: ${JSON.stringify(counts)}`);
    }
    if (code === 0) log(`RESULT: ${mode} succeeded`);
  } catch (error) {
    if (error instanceof StepError) {
      log(`FAILED at step "${error.step}": ${error.message}`);
    } else {
      log(`FAILED: ${errorMessage(error)}`);
    }
    code = 1;
  } finally {
    if (embedder) await embedder.dispose();
    await rm(copyDir, { recursive: true, force: true });
  }

  try {
    if (pre.length > 0) await verifyOldStore(pre);
    else throw new Error("no pre-run list was recorded");
  } catch (error) {
    log(
      `FAILED at step "8 end-of-run old store hash check": ${errorMessage(error)}`,
    );
    code = 1;
  }
  log(`exit=${code}`);
  return code;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`[${SCRIPT_NAME}] unexpected: ${errorMessage(error)}`);
    process.exit(1);
  },
);
