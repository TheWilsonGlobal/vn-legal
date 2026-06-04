// ============================================================================
// Shared Graph Fixture for Integration Tests
// ============================================================================
//
// This fixture provides a pre-built graph that can be shared across multiple
// test files to avoid the expensive rebuild operation (100+ seconds).
//
// Usage:
//   1. Run tests with --standalone flag first to build the fixture
//   2. Subsequent runs will use the cached fixture
// ============================================================================

import { GraphClient } from "../../../src/graph/client";
import { createGraphBuilder } from "../../../src/graph/builder";
import { parseLegalData } from "../../../src/graph/parser";
import { join } from "node:path";
import { existsSync, rmSync, renameSync } from "node:fs";
import process from "process";

const FIXTURE_DB_PATH = join(
  process.cwd(),
  "storage",
  "test-graph-fixture.cgraph",
);
const FIXTURE_WAL_PATH = FIXTURE_DB_PATH.replace(".cgraph", ".wal");
const TEMP_DB_PATH = join(
  process.cwd(),
  "storage",
  "test-graph-fixture-temp.cgraph",
);

export class GraphFixture {
  private static instance: { client: GraphClient; isOwner: boolean } | null =
    null;

  /**
   * Get or create the shared graph fixture.
   * The first caller becomes the "owner" responsible for building/cleanup.
   */
  static async get(): Promise<GraphClient> {
    if (this.instance) {
      return this.instance.client;
    }

    const fixtureExists = existsSync(FIXTURE_DB_PATH);

    if (!fixtureExists) {
      // Build new fixture
      console.log("\n🔨 Building shared graph fixture (this takes ~100s)...");
      const client = new GraphClient(TEMP_DB_PATH);
      await client.initialize(); // initialize() is async but internally calls sync db.init()

      const parsedData = await parseLegalData();
      const builder = await createGraphBuilder(client);
      await builder.buildGraph(parsedData);

      await client.close();

      // Rename to fixture path
      if (existsSync(FIXTURE_DB_PATH)) rmSync(FIXTURE_DB_PATH);
      if (existsSync(FIXTURE_WAL_PATH)) rmSync(FIXTURE_WAL_PATH);
      renameSync(TEMP_DB_PATH, FIXTURE_DB_PATH);
      const tempWal = TEMP_DB_PATH.replace(".cgraph", ".wal");
      if (existsSync(tempWal)) {
        renameSync(tempWal, FIXTURE_WAL_PATH);
      }

      console.log("✓ Graph fixture built and cached\n");
    } else {
      console.log("✓ Using cached graph fixture");
    }

    // Open the fixture for use
    const client = new GraphClient(FIXTURE_DB_PATH);
    await client.initialize();

    this.instance = { client, isOwner: true };
    return client;
  }

  /**
   * Close and cleanup the fixture (only the owner should cleanup)
   */
  static async cleanup(): Promise<void> {
    if (this.instance?.isOwner) {
      await this.instance.client.close();
      this.instance = null;
    }
  }

  /**
   * Force rebuild the fixture (useful when data structure changes)
   */
  static async rebuild(): Promise<void> {
    if (existsSync(FIXTURE_DB_PATH)) rmSync(FIXTURE_DB_PATH);
    if (existsSync(FIXTURE_WAL_PATH)) rmSync(FIXTURE_WAL_PATH);
    await this.get();
  }
}
