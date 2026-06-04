// ============================================================================
// Build Vector Index Entry Point
// ============================================================================

import { config } from "../shared/config";
import {
  buildVectorIndex as buildConGraphIndex,
  addIndex as addConGraphIndex,
} from "./build-index-by-congraphdb";
import {
  buildVectorIndex as buildLanceDBIndex,
  addIndex as addLanceDBIndex,
} from "./build-index-by-lancedb";
import logger from "../shared/logger";

/**
 * Main entry point for building vector index.
 * Dispatches to the appropriate indexing script based on configuration.
 */
export async function buildVectorIndex(): Promise<void> {
  const storeType = config.vectorStoreType;
  logger.info(`Starting vector index build for store type: ${storeType}`);

  try {
    if (storeType === "congraph") {
      await buildConGraphIndex();
    } else {
      await buildLanceDBIndex();
    }
    logger.info("Vector index build completed successfully");
  } catch (error) {
    logger.error("Vector index build failed", error);
    throw error;
  }
}

/**
 * Add more legal data to the existing vector index.
 * Dispatches to the appropriate indexing script based on configuration.
 */
export async function addIndex(
  filePath?: string,
  existingVectorStore?: any,
): Promise<void> {
  const storeType = config.vectorStoreType;
  logger.info(`Adding to vector index for store type: ${storeType}`);

  try {
    if (storeType === "congraph") {
      await addConGraphIndex(filePath, existingVectorStore);
    } else {
      await addLanceDBIndex(filePath, existingVectorStore);
    }
    logger.info("Vector index update completed successfully");
  } catch (error) {
    logger.error("Vector index update failed", error);
    throw error;
  }
}

// Run the script if executed directly
if (import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  buildVectorIndex()
    .then(() => {
      process.exit(0);
    })
    .catch((_error) => {
      process.exit(1);
    });
}
