import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GraphClient } from "../../src/graph/client";
import { createGraphBuilder } from "../../src/graph/builder";
import { parseLegalData } from "../../src/graph/parser";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import process from "process";

// Note: Integration tests use real congraphdb (no mocks) via workspace config

const TEST_DB_PATH = join(
  process.cwd(),
  "storage",
  "test-graph-build-integration.cgraph",
);
const TEST_WAL_PATH = TEST_DB_PATH.replace(".cgraph", ".wal");

function cleanupTestDb() {
  for (const p of [TEST_DB_PATH, TEST_WAL_PATH]) {
    if (existsSync(p)) {
      try {
        rmSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}

describe("Graph Build Integration", () => {
  let client: GraphClient;

  beforeAll(async () => {
    cleanupTestDb();
    client = new GraphClient(TEST_DB_PATH);
    await client.initialize();
  });

  afterAll(async () => {
    await client.close();
    cleanupTestDb();
  });

  it.skip("should build a complete graph from legal data", async () => {
    const parsedData = await parseLegalData();
    const builder = await createGraphBuilder(client);

    const startTime = Date.now();
    await builder.buildGraph(parsedData);
    const duration = (Date.now() - startTime) / 1000;

    // Check performance target (sub-120-second for acceptable build time)
    expect(duration).toBeLessThan(120);
    expect(parsedData.articles.size).toBeGreaterThan(600);
  }, 180000);
});
