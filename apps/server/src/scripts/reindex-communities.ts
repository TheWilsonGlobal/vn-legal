import {
  createVectorStore,
  createIndexingPipeline,
} from "../embeddings/lancedb";
import { getEmbedder } from "../embeddings/embedder";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import logger from "../shared/logger";

async function reindexCommunities() {
  const embedder = await getEmbedder();
  const vectorStore = await createVectorStore();
  const pipeline = await createIndexingPipeline(vectorStore, embedder);

  const reportsPath = join(process.cwd(), "data", "community_reports.json");
  const reportsJson = await readFile(reportsPath, "utf-8");
  const reports = JSON.parse(reportsJson);

  logger.info(`Re-indexing ${reports.length} community reports...`);
  await pipeline.indexCommunityReports(reports);

  const count = await vectorStore.getCommunityReportCount();
  logger.info(`Done. Total community reports: ${count}`);

  await vectorStore.close();
  await embedder.dispose();
}

reindexCommunities().catch(console.error);
