import "../setup-integration"; // Must be first import to unmock congraphdb
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GraphClient } from "../../src/graph/client";
import { createGraphBuilder } from "../../src/graph/builder";
import { parseLegalData } from "../../src/graph/parser";
import { createHybridRetrieval } from "../../src/retrieval/hybrid-congraph";
import { createLLMAdapter } from "../../src/agent/congraph-rag-llm";
import { getEmbedder } from "../../src/embeddings/embedder";
import { createStorageAdapter } from "../../src/storage-adapters/congraph-rag-adapter";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import process from "process";
import logger from "../../src/shared/logger";

import {
  VectorStore,
  createIndexingPipeline,
} from "../../src/embeddings/lancedb";
import { config } from "../../src/shared/config";

// Note: Integration tests use real congraphdb (no mocks) via workspace config

const TEST_DB_PATH = join(
  process.cwd(),
  "storage",
  `test-hybrid-${Date.now()}.cgraph`,
);
const TEST_WAL_PATH = TEST_DB_PATH.replace(".cgraph", ".wal");
const TEST_VECTOR_DB_PATH = join(
  process.cwd(),
  "storage",
  `test-hybrid-vectors-${Date.now()}.lance`,
);

function cleanupTestDb() {
  for (const p of [TEST_DB_PATH, TEST_WAL_PATH]) {
    if (existsSync(p)) {
      try {
        rmSync(p, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
  if (existsSync(TEST_VECTOR_DB_PATH)) {
    try {
      rmSync(TEST_VECTOR_DB_PATH, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

describe("Hybrid Retrieval Integration", () => {
  let client: any;
  let hybrid: any;
  let vectorStore: VectorStore;

  beforeAll(async () => {
    cleanupTestDb();

    // Override vector DB path for testing
    (config as any).vectorDbPath = TEST_VECTOR_DB_PATH;

    client = new GraphClient(TEST_DB_PATH);
    await client.initialize();

    const embedder = await getEmbedder();
    const llm = createLLMAdapter(embedder, { provider: "template" });

    vectorStore = new VectorStore();
    await vectorStore.initialize();

    const storage = createStorageAdapter(client, vectorStore);

    const parsedData = await parseLegalData();
    const builder = await createGraphBuilder(client);
    await builder.buildGraph(parsedData);

    // Populate vector store for testing (limited to 50 articles for speed)
    const pipeline = createIndexingPipeline(vectorStore, embedder);
    const subset = Array.from(parsedData.articles.values()).slice(0, 50);
    const subsetIds = subset.map((a) => a.id);
    logger.info(`Indexing articles: ${subsetIds.join(", ")}`);
    await (await pipeline).indexAll(subset);

    hybrid = createHybridRetrieval(storage, llm, embedder);
  }, 300000); // 5 minutes timeout

  afterAll(async () => {
    if (client) await client.close();
    if (vectorStore) await vectorStore.close();
    cleanupTestDb();
  });

  it.skip("should retrieve hybrid context for a Vietnamese query", async () => {
    const query = "Người chưa thành niên có được ký hợp đồng lao động không?";
    const context = await hybrid.retrieve(query, "local");

    expect(context).toBeDefined();
    expect(context.seed_articles.length).toBeGreaterThan(0);
    expect(context.community_context).toBeDefined();
  }, 60000);

  it("should stream retrieval results", async () => {
    let chunkCount = 0;
    for await (const _chunk of hybrid.retrieveStream(
      "Quyền của người chưa thành niên",
    )) {
      chunkCount++;
      if (chunkCount > 5) break;
    }
    expect(chunkCount).toBeGreaterThan(0);
  }, 60000);

  it.skip("should find seed clauses", async () => {
    const clauses = await hybrid.findSeedClauses("khoản 1", 5);
    expect(Array.isArray(clauses)).toBe(true);
    expect(clauses.length).toBeGreaterThan(0);
  }, 60000);
});
