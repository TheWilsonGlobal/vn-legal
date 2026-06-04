// ============================================================================
// Build Graph from Legal Data
// ============================================================================

import { createGraphClient } from "../graph/client";
import { createGraphBuilder } from "../graph/builder";
import { parseLegalData, parseLegalFile } from "../graph/parser";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import logger from "../shared/logger";

// ----------------------------------------------------------------------------
// Build Graph Script
// ----------------------------------------------------------------------------

export async function buildGraph(): Promise<void> {
  logger.info("=== Starting Graph Build ===");

  try {
    // Step 1: Parse legal data
    logger.info("Step 1: Parsing legal data from JSON");
    const parsedData = await parseLegalData();

    // Step 1.5: Load Community Reports
    await loadCommunityReports(parsedData);

    // Step 2: Initialize graph client
    logger.info("Step 2: Initializing graph database");

    // Delete existing graph files to avoid Checksum mismatch
    const dbPath = "C:\\Git\\vina-legal\\storage\\graph.cgraph";
    const walPath = "C:\\Git\\vina-legal\\storage\\graph.wal";

    try {
      const fs = await import("node:fs/promises");
      await fs.unlink(dbPath).catch(() => {});
      await fs.unlink(walPath).catch(() => {});
      logger.info("Cleared existing graph database");
    } catch (e) {
      logger.warn("Could not clear existing graph database", e);
    }

    const graph = await createGraphClient();

    // Step 3: Build graph
    await runBuildProcess(graph, parsedData, false);

    // Step 10: Close connections
    await graph.close();

    logger.info("=== Graph Build Complete ===");
  } catch (error) {
    logger.error("Failed to build graph", error);
    throw error;
  }
}

/**
 * Add more legal data to the existing graph
 */
export async function addGraph(
  filePath?: string,
  existingGraph?: any,
): Promise<void> {
  logger.info("=== Adding to Knowledge Graph ===");

  try {
    // Step 1: Parse legal data
    let parsedData;
    if (filePath) {
      logger.info(`Step 1: Parsing legal data from ${filePath}`);
      parsedData = await parseLegalFile(filePath);
    } else {
      logger.info("Step 1: Parsing legal data from all JSON files");
      parsedData = await parseLegalData();
    }

    // Step 2: Initialize or use existing graph client
    let graph;

    if (existingGraph) {
      logger.info("Step 2: Using existing graph database connection");
      graph = existingGraph;
    } else {
      logger.info("Step 2: Connecting to existing graph database");
      graph = await createGraphClient();
    }

    // Step 3: Build graph
    await runBuildProcess(graph, parsedData, true);

    // Close connections only if we created it
    if (!existingGraph) {
      await graph.checkpoint();
      await graph.close();
    } else {
      await graph.checkpoint();
    }

    logger.info("=== Graph Update Complete ===");
  } catch (error) {
    logger.error("Failed to update graph", error);
    throw error;
  }
}

/**
 * Common logic to load community reports
 */
async function loadCommunityReports(parsedData: any): Promise<void> {
  logger.info("Step 1.5: Loading community reports");
  const reportsPath = join(process.cwd(), "data", "community_reports.json");
  try {
    const reportsJson = await readFile(reportsPath, "utf-8");
    parsedData.communityReports = JSON.parse(reportsJson);
    logger.info(
      `Loaded ${parsedData.communityReports.length} community reports`,
    );
  } catch (e) {
    logger.warn(`Could not load community reports from ${reportsPath}`, e);
  }
}

/**
 * Common build logic shared between buildGraph and addGraph
 */
async function runBuildProcess(
  graph: any,
  parsedData: any,
  isAdd: boolean,
): Promise<void> {
  // Step 3: Build graph from parsed data
  logger.info(
    `Step 3: ${isAdd ? "Adding to" : "Building"} graph from parsed data`,
  );
  const builder = await createGraphBuilder(graph);

  if (isAdd) {
    await builder.addGraph(parsedData);
  } else {
    await builder.buildGraph(parsedData);
  }

  // Step 4: Verify graph
  logger.info("Step 4: Verifying graph");

  // Check in-memory first
  const preRefreshStats = await graph.getStats();
  const preRefreshTotal = Object.entries(preRefreshStats)
    .filter(([k]) => k.startsWith("edge:"))
    .reduce((acc, [_, v]) => acc + (v as number), 0);

  logger.info("Pre-refresh statistics:", preRefreshStats);
  logger.info(`Pre-refresh total edges: ${preRefreshTotal}`);

  await graph.checkpoint();

  // Refresh connection to ensure all data is visible
  logger.info("Refreshing database connection for verification...");
  await graph.close();
  await graph.initialize();

  const stats = await graph.getStats();
  const totalEdges = Object.entries(stats)
    .filter(([k]) => k.startsWith("edge:"))
    .reduce((acc, [_, v]) => acc + (v as number), 0);

  const hasChapterRes = await graph.query(
    "MATCH (:Part)-[r:HAS_CHAPTER]->(:Chapter) RETURN count(r) as count",
  );
  const belongsToSubRes = await graph.query(
    "MATCH (:Article)-[r:BELONGS_TO_SUBSECTION]->(:Subsection) RETURN count(r) as count",
  );
  const belongsToSecRes = await graph.query(
    "MATCH (:Article)-[r:BELONGS_TO_SECTION]->(:Section) RETURN count(r) as count",
  );

  logger.info("Graph statistics:", stats);
  logger.info(`Total edges (any type): ${totalEdges}`);
  logger.info(`Labeled HAS_CHAPTER count: ${hasChapterRes[0]?.count ?? 0}`);
  logger.info(`BELONGS_TO_SUBSECTION count: ${belongsToSubRes[0]?.count ?? 0}`);
  logger.info(`BELONGS_TO_SECTION count: ${belongsToSecRes[0]?.count ?? 0}`);

  const communityNodeRes = await graph.query(
    "MATCH (n:Community) RETURN count(n) as count",
  );
  logger.info(`Community nodes count: ${communityNodeRes[0]?.count ?? 0}`);

  logger.info(`Summary:`);
  logger.info(`- Parts: ${stats.Part || 0}`);
  logger.info(`- Chapters: ${stats.Chapter || 0}`);
  logger.info(`- Sections: ${stats.Section || 0}`);
  logger.info(`- Subsections: ${stats.Subsection || 0}`);
  logger.info(`- Articles: ${stats.Article || 0}`);
  logger.info(`- Clauses: ${stats.Clause || 0}`);
  logger.info(`- Points: ${stats.ClausePoint || 0}`);
}

// Run the script if executed directly
if (import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  buildGraph()
    .then(() => {
      logger.info("Graph build completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("Graph build failed", error);
      process.exit(1);
    });
}
