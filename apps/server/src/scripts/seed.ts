// ============================================================================
// Seed Script - Initialize All Data
// ============================================================================

import { buildGraph } from "./build-graph";
import { buildVectorIndex } from "./build-index";
import logger from "../shared/logger";

// ----------------------------------------------------------------------------
// Seed Script
// ----------------------------------------------------------------------------

export async function seed(): Promise<void> {
  const startTime = Date.now();

  logger.info("╔════════════════════════════════════════════════════════╗");
  logger.info("║  Vietnam Legal Consultant - Data Initialization       ║");
  logger.info("╚════════════════════════════════════════════════════════╝");
  logger.info("");

  try {
    // Step 1: Build graph
    logger.info("Step 1/2: Building knowledge graph from legal data");
    logger.info("─────────────────────────────────────────────────────");
    await buildGraph();
    logger.info("");

    // Step 2: Build vector index
    logger.info("Step 2/2: Building vector index for semantic search");
    logger.info("─────────────────────────────────────────────────────");
    await buildVectorIndex();
    logger.info("");

    // Summary
    const duration = Date.now() - startTime;
    logger.info("╔════════════════════════════════════════════════════════╗");
    logger.info("║  Initialization Complete                             ║");
    logger.info(
      `║  Duration: ${(duration / 1000).toFixed(2)}s                                    ║`,
    );
    logger.info("╚════════════════════════════════════════════════════════╝");
    logger.info("");
    logger.info("Next steps:");
    logger.info("1. Start the API server: npm run start");
    logger.info("2. Test the API: http://localhost:3000/health");
    logger.info("3. Try a consultation: POST http://localhost:3000/consult");
  } catch (error) {
    logger.error("");
    logger.error("╔════════════════════════════════════════════════════════╗");
    logger.error("║  Initialization Failed                                ║");
    logger.error("╚════════════════════════════════════════════════════════╝");
    logger.error("");
    logger.error("Error details:", error);
    throw error;
  }
}

// Run the script if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => {
      logger.info("✓ All data initialized successfully");
      process.exit(0);
    })
    .catch((_error) => {
      logger.error("✗ Initialization failed");
      process.exit(1);
    });
}
