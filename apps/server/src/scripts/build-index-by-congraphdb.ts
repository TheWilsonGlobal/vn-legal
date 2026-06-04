// ============================================================================
// Build Vector Index Only (No Graph Build) - ConGraphDB
// ============================================================================

import { parseLegalFile, parseLegalData } from "../graph/parser";
import type { ArticleNode, ParsedLegalData } from "../shared/types";
import {
  createVectorStore,
  type IVectorStore,
} from "../embeddings/vector-store-factory";
import { config } from "../shared/config";
import logger from "../shared/logger";
import { getEmbedder } from "../embeddings/embedder-factory";
import { createConGraphIndexingPipeline } from "../embeddings/congraph";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ----------------------------------------------------------------------------
// Build Vector Index Only Script (Skip Graph Build)
// ----------------------------------------------------------------------------

export async function buildVectorIndex(): Promise<void> {
  logger.info(
    "=== Starting Vector Index Build (ConGraphDB - Vectors Only) ===",
  );

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

  const startTime = Date.now();
  const embedder = await getEmbedder();

  try {
    // Step 1: Parse legal data
    logger.info("Step 1: Parsing legal data from JSON");
    const parsedData = await parseLegalData();

    // Step 1.5: Load Community Reports
    await loadCommunityReports(parsedData);

    // Step 5: Initialize ConGraphDB vector store
    logger.info("Step 5: Initializing ConGraphDB vector store");
    const vectorStore = await createVectorStore("congraph");

    // Step 6: Clear existing vector data
    logger.info("Step 6: Clearing existing vector data");
    await vectorStore.clearAll();

    // Step 7-8: Index data
    await runIndexingProcess(vectorStore, embedder, parsedData, false);

    // Step 9: Verify vector index
    await verifyIndex(vectorStore);

    // Close connections
    await vectorStore.close();

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info("=== Vector Index Build Complete (ConGraphDB) ===");
    logger.info(`Total Time: ${totalTime}s`);
  } catch (error) {
    logger.error("Failed to build vector index", error);
    throw error;
  } finally {
    await embedder.dispose();
  }
}

/**
 * Add more legal data to the existing vector index
 */
export async function addIndex(
  filePath?: string,
  existingVectorStore?: IVectorStore,
): Promise<void> {
  logger.info("=== Adding to Vector Index (ConGraphDB) ===");

  const startTime = Date.now();
  const embedder = await getEmbedder();

  try {
    // Step 1: Parse legal data
    let parsedData: ParsedLegalData;
    if (filePath) {
      logger.info(`Step 1: Parsing legal data from ${filePath}`);
      parsedData = await parseLegalFile(filePath);
    } else {
      logger.info("Step 1: Parsing legal data from JSON");
      parsedData = await parseLegalData();
    }

    // Step 5: Initialize ConGraphDB vector store
    let vectorStore: IVectorStore;
    if (existingVectorStore) {
      logger.info("Step 5: Using existing ConGraphDB vector store connection");
      vectorStore = existingVectorStore;
    } else {
      logger.info("Step 5: Initializing ConGraphDB vector store");
      vectorStore = await createVectorStore("congraph");
    }

    // Step 7-8: Index data
    await runIndexingProcess(vectorStore, embedder, parsedData, true);

    // Step 9: Verify vector index
    await verifyIndex(vectorStore);

    // Close connections only if we created it
    if (!existingVectorStore) {
      await vectorStore.checkpoint();
      await vectorStore.close();
    } else {
      await vectorStore.checkpoint();
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info("=== Vector Index Update Complete (ConGraphDB) ===");
    logger.info(`Total Time: ${totalTime}s`);
  } catch (error) {
    logger.error("Failed to update vector index", error);
    throw error;
  } finally {
    await embedder.dispose();
  }
}

/**
 * Common logic to load community reports
 */
async function loadCommunityReports(
  parsedData: ParsedLegalData & { communityReports?: any[] },
): Promise<void> {
  logger.info("Step 1.5: Loading community reports");
  const reportsPath = join(process.cwd(), "data", "community_reports.json");
  try {
    const reportsJson = await readFile(reportsPath, "utf-8");
    const reports = JSON.parse(reportsJson);
    parsedData.communityReports = reports;
    logger.info(`Loaded ${reports.length} community reports`);
  } catch (e) {
    logger.warn(`Could not load community reports from ${reportsPath}`, e);
  }
}

/**
 * Common indexing logic shared between buildVectorIndex and addIndex
 */
async function runIndexingProcess(
  vectorStore: IVectorStore,
  embedder: any,
  parsedData: ParsedLegalData & { communityReports?: any[] },
  isAdd: boolean,
): Promise<void> {
  // Step 7: Index all articles and clauses
  logger.info(
    `Step 7: ${isAdd ? "Adding" : "Indexing"} all articles and clauses`,
  );
  const articles = Array.from(parsedData.articles.values()) as ArticleNode[];
  const pipeline = await createConGraphIndexingPipeline(
    vectorStore.getStore(),
    embedder,
  );

  logger.info(`Indexing ${articles.length} articles...`);
  await pipeline.indexArticles(articles);

  logger.info(`Indexing clauses from ${articles.length} articles...`);
  await pipeline.indexClauses(articles);

  // Step 8: Index community reports
  logger.info("Step 8: Indexing community reports");
  if (parsedData.communityReports) {
    await pipeline.indexCommunityReports(parsedData.communityReports);
  }

  // Step 8.5: Force checkpoint to ensure all vector data is persisted
  logger.info("Step 8.5: Checkpointing vector store");
  await vectorStore.checkpoint();
}

/**
 * Common verification logic
 */
async function verifyIndex(vectorStore: any): Promise<void> {
  logger.info("Step 9: Verifying vector index");
  const vectorStats = await vectorStore.getStats();
  const reportCount = await vectorStore.getCommunityReportCount();
  logger.info("Vector index statistics:", { ...vectorStats, reportCount });

  logger.info(`Summary:`);
  logger.info(`- Articles indexed: ${vectorStats.articleCount}`);
  logger.info(`- Clauses indexed: ${vectorStats.clauseCount}`);
  logger.info(`- Community reports indexed: ${reportCount}`);
}

// Run the script if executed directly
if (import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  buildVectorIndex()
    .then(() => {
      logger.info("Vector index build completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("Vector index build failed", error);
      process.exit(1);
    });
}
