// ============================================================================
// Build Vector Index from Legal Data (LanceDB + Python API)
// ============================================================================

import { createIndexingPipeline } from "../embeddings/lancedb";
import { getEmbedder } from "../embeddings/embedder-factory";
import { parseLegalData, parseLegalFile } from "../graph/parser";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import logger from "../shared/logger";
import type { ArticleNode, ParsedLegalData } from "../shared/types";
import {
  createVectorStore,
  type IVectorStore,
} from "../embeddings/vector-store-factory";
import { config } from "../shared/config";

// ----------------------------------------------------------------------------
// Build Vector Index Script (LanceDB with Python API)
// ----------------------------------------------------------------------------

export async function buildVectorIndex(): Promise<void> {
  logger.info("=== Starting Vector Index Build (LanceDB + Python API) ===");

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
    // Step 1: Load articles directly from parsed legal data
    logger.info("Step 1: Loading articles from legal data source");
    const parsedData = await parseLegalData();

    // Step 1.5: Load Community Reports
    await loadCommunityReports(parsedData);

    const articles = Array.from(parsedData.articles.values());
    if (articles.length === 0) {
      logger.warn("No articles found in data source.");
      return;
    }

    // Step 2: Initialize LanceDB vector store
    logger.info("Step 2: Initializing LanceDB vector store");
    const vectorStore = await createVectorStore("lancedb");

    // Step 3: Clear existing data (to avoid duplicates)
    logger.info("Step 3: Clearing existing vector data");
    await vectorStore.clearAll();

    // Step 5-6: Index data
    await runIndexingProcess(vectorStore, embedder, parsedData, false);

    // Step 7: Verify index
    await verifyIndex(vectorStore);

    // Step 8: Close connection
    await vectorStore.close();

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info("=== Vector Index Build Complete (LanceDB) ===");
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
  logger.info("=== Adding to Vector Index (LanceDB) ===");

  const startTime = Date.now();
  const embedder = await getEmbedder();

  try {
    // Step 1: Parse legal data
    let parsedData: ParsedLegalData;
    if (filePath) {
      logger.info(`Step 1: Parsing legal data from ${filePath}`);
      parsedData = await parseLegalFile(filePath);
    } else {
      logger.info("Step 1: Parsing legal data from all JSON files");
      parsedData = await parseLegalData();
    }
    const articles = Array.from(parsedData.articles.values());
    if (articles.length === 0) {
      logger.warn("No articles found in data source.");
      return;
    }

    // Step 2: Initialize LanceDB vector store
    let vectorStore: IVectorStore;
    if (existingVectorStore) {
      logger.info("Step 2: Using existing LanceDB vector store connection");
      vectorStore = existingVectorStore;
    } else {
      logger.info("Step 2: Initializing LanceDB vector store");
      vectorStore = await createVectorStore("lancedb");
    }

    // Step 5-6: Index data
    await runIndexingProcess(vectorStore, embedder, parsedData, true);

    // Step 7: Verify index
    await verifyIndex(vectorStore);

    // Step 8: Close connection only if we created it
    if (!existingVectorStore) {
      await vectorStore.close();
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info("=== Vector Index Update Complete (LanceDB) ===");
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
  // Step 5: Index articles and clauses
  logger.info(`Step 5: ${isAdd ? "Adding" : "Indexing"} articles and clauses`);
  const articles = Array.from(parsedData.articles.values()) as ArticleNode[];
  const pipeline = await createIndexingPipeline(
    vectorStore.getStore(),
    embedder,
  );
  await pipeline.indexAll(articles);

  // Step 6: Index community reports
  logger.info("Step 6: Indexing community reports");
  if (parsedData.communityReports) {
    await pipeline.indexCommunityReports(parsedData.communityReports);
  }
}

/**
 * Common verification logic
 */
async function verifyIndex(vectorStore: any): Promise<void> {
  logger.info("Step 7: Verifying vector index");
  const stats = await vectorStore.getStats();
  const reportCount = await vectorStore.getCommunityReportCount();
  logger.info("Vector index statistics:", { ...stats, reportCount });

  logger.info("Summary:");
  logger.info(`- Articles indexed: ${stats.articleCount}`);
  logger.info(`- Clauses indexed: ${stats.clauseCount}`);
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
