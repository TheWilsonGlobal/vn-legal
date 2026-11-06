// BL2: retrieval-only comparison of the Gemini 768-d RB1 index against the old
// 384-d transformers index (plan section 11, decision Q24). No LLM is involved.
//
//   pnpm exec tsx apps/server/tests/eval/agent/old-index-compare.ts [--out DIR]
//
// Environment: EMBEDDING_PROVIDER=gemini, EMBEDDING_MODEL, EMBEDDING_DIM,
// GEMINI_EMBEDDING_API_KEY (read from .env by shared/config), EMBEDDING_BACKEND unset or
// "transformers". EVAL_BL2_NEW_STORE (default storage/congraph_vectors_gemini-embedding-2_768.cgraph)
// and EVAL_BL2_OLD_STORE (default storage/congraph_vectors.cgraph) name the stores.
//
// PRECONDITION: the application server must be stopped (the RB1 store and graph files are copied while open elsewhere otherwise).
// Both stores are opened as COPIES in a temp directory. The originals are only read
// (copied and hashed) and their SHA-256 is compared before and after.
//
// Exit codes: 0 done; 1 failure; 2 precondition (missing manifest, wrong env) — it never skips.

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  type Bl2CaseResult,
  rankedArticles,
  scoreBl2Case,
  summarizeBl2,
} from "./bl2-metrics";
import { loadDataset } from "./dataset";
import { KPI_DEFS, meetsTarget } from "./thresholds";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../../../../..");

class PreconditionFailed extends Error {}

function manifestPath(store: string): string {
  return `${store}.manifest.json`;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Files that belong to a store: <stem>.* next to the .cgraph file. */
function storeFiles(store: string): string[] {
  const dir = dirname(store);
  const stem = basename(store).replace(/\.cgraph$/, "");
  return readdirSync(dir)
    .filter((f) => f.startsWith(`${stem}.`))
    .map((f) => join(dir, f));
}

function hashAll(files: readonly string[]): Record<string, string> {
  return Object.fromEntries(files.map((f) => [basename(f), sha256File(f)]));
}

function copyInto(files: readonly string[], dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const f of files) copyFileSync(f, join(dir, basename(f)));
}

function parseOut(argv: string[]): string {
  const i = argv.indexOf("--out");
  return i >= 0 && argv[i + 1]
    ? resolve(argv[i + 1])
    : resolve(here, "reports");
}

async function main(): Promise<number> {
  console.log(
    "PRECONDITION: the application server must be stopped (it may write the RB1 store and the graph while they are copied; the run hashes both before and after and fails on a difference).",
  );
  const out = parseOut(process.argv.slice(2));
  const newStore = resolve(
    REPO_ROOT,
    process.env.EVAL_BL2_NEW_STORE ??
      join("storage", "congraph_vectors_gemini-embedding-2_768.cgraph"),
  );
  const oldStore = resolve(
    REPO_ROOT,
    process.env.EVAL_BL2_OLD_STORE ??
      join("storage", "congraph_vectors.cgraph"),
  );

  // 1. Manifests first. Fail loudly, naming the file. This is a precondition, never a skip.
  if (!existsSync(manifestPath(newStore)))
    throw new PreconditionFailed(
      `RB1 manifest missing: ${manifestPath(newStore)}. BL2 needs the Gemini 768-d index built by the RB1 rebuild; it does not skip and does not compare against nothing.`,
    );
  if (!existsSync(manifestPath(oldStore)))
    throw new PreconditionFailed(
      `legacy manifest missing: ${manifestPath(oldStore)}. The old store must carry its legacy-transformers-384 manifest.`,
    );
  const graphSrc = resolve(REPO_ROOT, "storage", "graph.cgraph");
  if (!existsSync(graphSrc))
    throw new PreconditionFailed(`graph store missing: ${graphSrc}`);

  // 2. Only now load the application config (this reads .env).
  const { config } = await import("../../../src/shared/config");
  const { describeEmbedder, assertIndexManifest } =
    await import("../../../src/embeddings/index-manifest");
  if (config.embedding.provider !== "gemini")
    throw new PreconditionFailed(
      `EMBEDDING_PROVIDER must be "gemini" for the new-index arm, got ${JSON.stringify(config.embedding.provider)}`,
    );
  if (config.embeddingBackend !== "transformers")
    throw new PreconditionFailed(
      `EMBEDDING_BACKEND must be "transformers" (or unset) for the old-index arm, got ${config.embeddingBackend}`,
    );

  // 3. Hash the originals, copy to a temp dir, hash again at the end.
  const oldFiles = storeFiles(oldStore);
  const newFiles = storeFiles(newStore);
  const graphFiles = ["graph.cgraph", "graph.wal"]
    .map((f) => join(REPO_ROOT, "storage", f))
    .filter((f) => existsSync(f));
  // The originals are only read, but the RB1 store and the graph files are read live too:
  // hash them before copying and after, so a server writing during the copy is caught.
  const before = hashAll(oldFiles);
  const beforeNew = hashAll(newFiles);
  const beforeGraph = hashAll(graphFiles);
  const tmp = mkdtempSync(join(tmpdir(), "bl2-"));
  const results: Bl2CaseResult[] = [];
  let closers: (() => Promise<void>)[] = [];
  try {
    copyInto(oldFiles, join(tmp, "old"));
    copyInto(newFiles, join(tmp, "new"));
    copyInto(graphFiles, join(tmp, "graph"));
    const oldCopy = join(tmp, "old", basename(oldStore));
    const newCopy = join(tmp, "new", basename(newStore));
    const graphCopy = join(tmp, "graph", "graph.cgraph");

    // 4. Manifests must match the embedder each arm uses.
    const legacyDescribed = describeEmbedder({
      embedding: { provider: "transformers" },
      vectorStoreType: "congraph",
    } as never);
    await assertIndexManifest(oldCopy, legacyDescribed);
    const newManifest = await assertIndexManifest(
      newCopy,
      describeEmbedder(config),
    );
    const oldManifest = JSON.parse(
      readFileSync(manifestPath(oldCopy), "utf8"),
    ) as {
      index_id: string;
    };

    // 5. Build two HybridRetrieval instances in one process.
    const { GraphClient } = await import("../../../src/graph/client");
    const { createVectorStore } =
      await import("../../../src/embeddings/vector-store-factory");
    const { createStorageAdapter } =
      await import("../../../src/storage-adapters/congraph-rag-adapter");
    const { createHybridRetrieval } =
      await import("../../../src/retrieval/hybrid-congraph");
    const { createLLMAdapter } =
      await import("../../../src/agent/congraph-rag-llm");
    const { Embedder } = await import("../../../src/embeddings/embedder");
    const { GeminiEmbedder } =
      await import("../../../src/embeddings/embedder-gemini");

    const graph = new GraphClient(graphCopy);
    await graph.initialize();
    closers.push(() => graph.close());

    // ConGraphVectorStore reads config.conGraphVectorDbPath when it initialises.
    const mutableConfig = config as { conGraphVectorDbPath: string };
    mutableConfig.conGraphVectorDbPath = oldCopy;
    const oldVectors = await createVectorStore("congraph");
    mutableConfig.conGraphVectorDbPath = newCopy;
    const newVectors = await createVectorStore("congraph");
    closers.push(
      () => oldVectors.close(),
      () => newVectors.close(),
    );

    const oldEmbedder = new Embedder();
    await oldEmbedder.initialize();
    const newEmbedder = new GeminiEmbedder({
      apiKey: config.embedding.apiKey,
      model: config.embedding.model as string,
      dim: config.embedding.dim,
      batchSize: config.embedding.batchSize,
      maxConcurrency: config.embedding.maxConcurrency,
    });
    await newEmbedder.initialize();
    if ((await oldEmbedder.getDimension()) !== legacyDescribed.dim)
      throw new Error(
        "old embedder dimension differs from the legacy manifest",
      );
    if ((await newEmbedder.getDimension()) !== newManifest.dim)
      throw new Error(
        "Gemini embedder dimension differs from the RB1 manifest",
      );

    const templateOld = createLLMAdapter(oldEmbedder as never, {
      provider: "template",
    });
    const templateNew = createLLMAdapter(newEmbedder, { provider: "template" });
    const oldRetrieval = createHybridRetrieval(
      createStorageAdapter(graph, oldVectors),
      templateOld,
      oldEmbedder as never,
    );
    const newRetrieval = createHybridRetrieval(
      createStorageAdapter(graph, newVectors),
      templateNew,
      newEmbedder,
    );

    // 6. Score every single-turn case that has gold ids.
    const { file, sha256 } = loadDataset();
    const gold = file.cases.filter(
      (c) => c.turns.length === 1 && c.gold_articles.length > 0,
    );
    for (const c of gold) {
      const q = c.turns[0].query;
      const o = rankedArticles(await oldRetrieval.retrieve(q, "local"));
      const n = rankedArticles(await newRetrieval.retrieve(q, "local"));
      // retrieve() swallows its own errors and returns an empty bundle; a real query never does.
      if (o.length === 0 || n.length === 0)
        throw new Error(
          `${c.id}: retrieval returned no articles (old ${o.length}, new ${n.length}); refusing to score an empty result`,
        );
      results.push(scoreBl2Case(c.id, c.gold_articles, o, n));
      console.log(
        `${c.id.padEnd(34)} old@5 ${results.at(-1)?.old_recall5.toFixed(2)}  new@5 ${results.at(-1)?.new_recall5.toFixed(2)}`,
      );
    }
    const summary = summarizeBl2(results);

    // 7. The originals must be byte-identical.
    const after = hashAll(oldFiles);
    const unchanged = JSON.stringify(before) === JSON.stringify(after);
    if (!unchanged)
      throw new Error(
        "old store files changed during BL2 (this must never happen)",
      );
    if (JSON.stringify(beforeNew) !== JSON.stringify(hashAll(newFiles)))
      throw new Error(
        "RB1 store files changed while BL2 copied them (is the server running?); the copy may be torn",
      );
    if (JSON.stringify(beforeGraph) !== JSON.stringify(hashAll(graphFiles)))
      throw new Error(
        "graph files changed while BL2 copied them (is the server running?); the copy may be torn",
      );

    const def = KPI_DEFS.find(
      (k) => k.id === "bl2_recall5_delta",
    ) as (typeof KPI_DEFS)[number];
    const status = meetsTarget(def.op, summary.delta_recall5, def.value)
      ? "PASS"
      : "FAIL";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const report = {
      header: {
        MODE: "live (retrieval only: live Gemini query embeddings + old transformers embeddings, no LLM)",
        suite: "BL2 old-index-compare",
        new_index_id: newManifest.index_id,
        old_index_id: oldManifest.index_id,
        embedding_backend_old_arm: config.embeddingBackend,
        topKSeedArticles: config.retrieval.topKSeedArticles,
        ranked_list:
          "seed articles in retrieval order, then path-context articles, de-duplicated",
        dataset_sha256: sha256,
        commit: gitCommit(),
        finished_at: new Date().toISOString(),
        old_store_files_sha256_before_equals_after: unchanged,
        old_store_files_sha256: after,
        new_store_files_sha256_before_equals_after: true,
        graph_files_sha256_before_equals_after: true,
        server_must_be_stopped: true,
        stores_opened_as_copies: true,
        gate: def.gate,
      },
      kpi: {
        metric: def.name,
        target: def.target,
        observed: summary.delta_recall5,
        n: summary.n,
        status,
      },
      summary,
      per_case: results,
    };
    mkdirSync(out, { recursive: true });
    const path = join(out, `bl2_${stamp}.json`);
    writeFileSync(path, JSON.stringify(report, null, 2));
    console.log(
      `BL2 recall@5 old ${summary.old.recall5.toFixed(3)} new ${summary.new.recall5.toFixed(3)} delta ${summary.delta_recall5.toFixed(3)} (n=${summary.n}) -> ${status}\nreport: ${path}`,
    );
    return 0;
  } finally {
    for (const close of closers.reverse()) {
      try {
        await close();
      } catch {
        /* closing a copy; the temp dir is removed next */
      }
    }
    closers = [];
    rmSync(tmp, { recursive: true, force: true });
  }
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

main().then(
  (code) => process.exit(code),
  (e) => {
    if (e instanceof PreconditionFailed) {
      console.error(`PRECONDITION FAILED: ${e.message}`);
      process.exit(2);
    }
    console.error(`BL2 FAILED: ${(e as Error).stack ?? e}`);
    process.exit(1);
  },
);
