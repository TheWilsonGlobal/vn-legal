// ============================================================================
// Build Graph from Legal Data (Lite Version - Limited Vector Indexing)
// ============================================================================

import { createGraphClient } from "../graph/client";
import { createGraphBuilder } from "../graph/builder";
import { parseLegalData } from "../graph/parser";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import logger from "../shared/logger";
import { getEmbedder } from "../embeddings/embedder-factory";
import {
  createConGraphVectorStore,
  createConGraphIndexingPipeline,
} from "../embeddings/congraph";
import type { ArticleNode } from "../shared/types";
import { config } from "../shared/config";

// ----------------------------------------------------------------------------
// Build Graph Script (Lite - Limited Vector Indexing for Performance Testing)
// ----------------------------------------------------------------------------

const LITE_MODE_CONFIG = {
  maxArticles: 200, // Only index first 200 articles
  maxClauses: 200, // Only index first 200 clauses
  indexAllReports: true, // Index all 14 community reports
};

export async function buildGraphLite(): Promise<void> {
  logger.info("=== Starting Graph Build (Lite - Limited Vector Indexing) ===");

  // Check embedding backend
  const embeddingBackend = config.embeddingBackend;
  if (embeddingBackend === "api") {
    const apiUrl = config.embeddingApiUrl;
    logger.info(`Embedding backend: api (${apiUrl})`);
    logger.info(
      "Ensure the model-hub embedding server is running before proceeding.",
    );
  } else if (embeddingBackend === "llamacpp") {
    const apiUrl = config.embeddingApiUrl;
    logger.info(`Embedding backend: llamacpp (${apiUrl})`);
    logger.info("Ensure the llama-server is running before proceeding.");
  } else if (embeddingBackend === "transformers") {
    logger.info(
      "Embedding backend: transformers (WebAssembly - slower, no server required)",
    );
  } else {
    throw new Error(
      `Unknown EMBEDDING_BACKEND value: "${embeddingBackend}". Must be "transformers", "api", or "llamacpp".`,
    );
  }

  const embedder = await getEmbedder();

  try {
    // Step 1: Parse legal data
    logger.info("Step 1: Parsing legal data from JSON");
    const parsedData = await parseLegalData();

    // Step 1.5: Load Community Reports
    logger.info("Step 1.5: Loading community reports");
    const reportsPath = join(process.cwd(), "data", "community_reports.json");
    try {
      const reportsJson = await readFile(reportsPath, "utf-8");
      (parsedData as any).communityReports = JSON.parse(reportsJson);
      logger.info(
        `Loaded ${(parsedData as any).communityReports.length} community reports`,
      );
    } catch (e) {
      logger.warn(`Could not load community reports from ${reportsPath}`, e);
    }

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
    logger.info("Step 3: Building graph from parsed data");
    const builder = await createGraphBuilder(graph);
    await builder.buildGraph(parsedData);

    // Step 4: Verify graph
    logger.info("Step 4: Verifying graph");

    // Check in-memory first
    const preRefreshStats = await graph.getStats();
    const preRefreshTotal = await graph.query(
      "MATCH ()-[r]->() RETURN count(r) as count",
    );
    logger.info("Pre-refresh statistics:", preRefreshStats);
    logger.info(`Pre-refresh total edges: ${preRefreshTotal[0]?.count ?? 0}`);

    await graph.checkpoint();

    // Step 4.5: Refresh connection to ensure all data is visible
    logger.info("Refreshing database connection for verification...");
    await graph.close();
    await graph.initialize();

    const stats = await graph.getStats();
    const totalEdgesRes = await graph.query(
      "MATCH ()-[r]->() RETURN count(r) as count",
    );
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
    logger.info(`Total edges (any type): ${totalEdgesRes[0]?.count ?? 0}`);
    logger.info(`Labeled HAS_CHAPTER count: ${hasChapterRes[0]?.count ?? 0}`);
    logger.info(
      `BELONGS_TO_SUBSECTION count: ${belongsToSubRes[0]?.count ?? 0}`,
    );
    logger.info(`BELONGS_TO_SECTION count: ${belongsToSecRes[0]?.count ?? 0}`);

    const communityNodeRes = await graph.query(
      "MATCH (n:Community) RETURN count(n) as count",
    );
    logger.info(`Community nodes count: ${communityNodeRes[0]?.count ?? 0}`);

    // Step 5: Initialize ConGraphDB vector store
    logger.info("Step 5: Initializing ConGraphDB vector store");
    const vectorStore = await createConGraphVectorStore();

    // Step 6: Clear existing vector data
    logger.info("Step 6: Clearing existing vector data");
    await vectorStore.clearAll();

    // Step 7: Index limited articles and clauses
    logger.info(`Step 7: Indexing limited articles and clauses (Lite Mode)`);
    logger.info(`- Max articles: ${LITE_MODE_CONFIG.maxArticles}`);
    logger.info(`- Max clauses: ${LITE_MODE_CONFIG.maxClauses}`);

    const allArticles = Array.from(parsedData.articles.values());

    // Take first 200 articles
    const limitedArticles = allArticles.slice(0, LITE_MODE_CONFIG.maxArticles);

    // Collect clauses from those 200 articles (up to 200 clauses for lite mode)
    let clauseCount = 0;
    const limitedArticlesForClauses: ArticleNode[] = [];
    for (const article of limitedArticles) {
      const clausesToAdd = article.clauses.slice(
        0,
        Math.min(
          article.clauses.length,
          LITE_MODE_CONFIG.maxClauses - clauseCount,
        ),
      );
      if (clausesToAdd.length > 0) {
        limitedArticlesForClauses.push({
          ...article,
          clauses: clausesToAdd,
        });
        clauseCount += clausesToAdd.length;
      }
      if (clauseCount >= LITE_MODE_CONFIG.maxClauses) break;
    }

    logger.info(
      `Will index ${limitedArticles.length} articles with ${clauseCount} clauses from ${limitedArticlesForClauses.length} articles`,
    );

    const pipeline = await createConGraphIndexingPipeline(
      vectorStore,
      embedder,
    );

    // Index articles (all limited articles)
    logger.info(`Indexing ${limitedArticles.length} articles...`);
    await pipeline.indexArticles(limitedArticles);

    // Index clauses (from filtered articles with limited clauses)
    logger.info(
      `Indexing clauses from ${limitedArticlesForClauses.length} articles...`,
    );
    await pipeline.indexClauses(limitedArticlesForClauses);

    // Step 8: Index community reports (all 14)
    logger.info("Step 8: Indexing community reports");
    if ((parsedData as any).communityReports) {
      await pipeline.indexCommunityReports(
        (parsedData as any).communityReports,
      );
    }

    // Step 8.5: Force checkpoint to ensure all vector data is persisted
    logger.info("Step 8.5: Checkpointing vector store");
    await vectorStore.checkpoint();

    // Step 9: Verify vector index
    logger.info("Step 9: Verifying vector index");
    const vectorStats = await vectorStore.getStats();
    const reportCount = await vectorStore.getCommunityReportCount();
    logger.info("Vector index statistics:", { ...vectorStats, reportCount });

    // Step 10: Close connections
    await graph.close();
    await vectorStore.close();

    logger.info("=== Graph Build Complete (Lite Mode) ===");
    logger.info(`Summary:`);
    logger.info(`- Parts: ${stats.Part || 0}`);
    logger.info(`- Chapters: ${stats.Chapter || 0}`);
    logger.info(`- Sections: ${stats.Section || 0}`);
    logger.info(`- Subsections: ${stats.Subsection || 0}`);
    logger.info(`- Articles: ${stats.Article || 0}`);
    logger.info(`- Clauses: ${stats.Clause || 0}`);
    logger.info(`- Points: ${stats.ClausePoint || 0}`);
    logger.info(`Vector Indexing (Lite Mode):`);
    logger.info(
      `- Articles indexed: ${vectorStats.articleCount} (limited to ${LITE_MODE_CONFIG.maxArticles})`,
    );
    logger.info(
      `- Clauses indexed: ${vectorStats.clauseCount} (limited to ${LITE_MODE_CONFIG.maxClauses})`,
    );
    logger.info(`- Community reports indexed: ${reportCount}`);
  } catch (error) {
    logger.error("Failed to build graph", error);
    throw error;
  } finally {
    await embedder.dispose();
  }
}

// Run the script if executed directly
if (import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  buildGraphLite()
    .then(() => {
      logger.info("Graph build (lite) completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("Graph build (lite) failed", error);
      process.exit(1);
    });
}
