import { createGraphClient } from "../graph/client";
import logger from "../shared/logger";

async function debugGraph() {
  const graph = await createGraphClient();

  logger.info("--- Node Counts ---");
  const nodeTypes = [
    "Part",
    "Chapter",
    "Section",
    "Subsection",
    "Article",
    "Clause",
    "ClausePoint",
  ];
  for (const type of nodeTypes) {
    const count = await graph.countNodes(type);
    logger.info(`${type}: ${count}`);
  }

  logger.info("--- Edge Counts (Generic) ---");
  const edgeTypes = [
    "HAS_CHAPTER",
    "HAS_SECTION",
    "HAS_SUBSECTION",
    "BELONGS_TO",
    "HAS_CLAUSE",
    "HAS_POINT",
  ];
  for (const type of edgeTypes) {
    const query = `MATCH ()-[r:${type}]->() RETURN count(r) as count`;
    const rows = await graph.query(query);
    logger.info(`${type} (MATCH ( )-[r:${type}]->( )): ${rows[0]?.count ?? 0}`);
  }

  logger.info("--- Sample Edges ---");
  for (const type of ["HAS_CHAPTER", "BELONGS_TO"]) {
    const query = `MATCH (a)-[r:${type}]->(b) RETURN a.id as from, b.id as to LIMIT 5`;
    const rows = await graph.query(query);
    logger.info(`Sample ${type}:`, rows);
  }

  await graph.close();
}

debugGraph().catch(console.error);
