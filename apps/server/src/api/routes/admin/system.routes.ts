import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import logger from "../../../shared/logger";
import { buildGraph } from "../../../scripts/build-graph";
import { buildVectorIndex } from "../../../scripts/build-index";
import { activityLog } from "../../../shared/activity-log";
import type { AdminRoutesOptions } from "./types";

export function registerSystemRoutes(
  fastify: FastifyInstance,
  options: AdminRoutesOptions,
): void {
  const { graph, vectorStore } = options;

  // POST /admin/rebuild-graph - Trigger graph rebuild
  fastify.post(
    "/admin/rebuild-graph",
    {
      schema: {
        description: "Trigger a full rebuild of the Knowledge Graph",
        tags: ["Admin"],
        response: {
          200: {
            type: "object",
            properties: {
              message: { type: "string" },
              timestamp: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logger.info("Admin: Graph rebuild triggered via API");

      // We run this asynchronously to not block the response
      // In a production app, we would use a task queue
      setImmediate(async () => {
        try {
          await buildGraph();

          // Refresh the graph connection
          await graph.refresh();

          activityLog.addEntry(
            "system",
            "Hệ thống: Knowledge Graph đã được xây dựng lại thành công",
          );
          logger.info("Admin: Graph rebuild completed successfully");
        } catch (error) {
          logger.error("Admin: Graph rebuild failed", error);
        }
      });

      return reply.send({
        message: "Graph rebuild process started in the background",
        timestamp: new Date().toISOString(),
      });
    },
  );

  // POST /admin/rebuild-vector - Trigger vector re-indexing
  fastify.post(
    "/admin/rebuild-vector",
    {
      schema: {
        description: "Trigger a full re-indexing of the Vector Store",
        tags: ["Admin"],
        response: {
          200: {
            type: "object",
            properties: {
              message: { type: "string" },
              timestamp: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logger.info("Admin: Vector re-indexing triggered via API");

      setImmediate(async () => {
        try {
          await buildVectorIndex();
          activityLog.addEntry(
            "system",
            "Hệ thống: Vector Index đã được xây dựng lại thành công",
          );
          logger.info("Admin: Vector re-indexing completed successfully");
        } catch (error) {
          logger.error("Admin: Vector re-indexing failed", error);
        }
      });

      return reply.send({
        message: "Vector re-indexing process started in the background",
        timestamp: new Date().toISOString(),
      });
    },
  );

  // GET /admin/stats - Get system-wide statistics
  fastify.get(
    "/admin/stats",
    {
      schema: {
        description: "Get system-wide statistics for graph and vector store",
        tags: ["Admin"],
        response: {
          200: {
            type: "object",
            properties: {
              graph: {
                type: "object",
                additionalProperties: true,
                properties: {
                  total_nodes: { type: "number" },
                  total_edges: { type: "number" },
                },
              },
              vector: {
                type: "object",
                properties: {
                  total_chunks: { type: "number" },
                  article_count: { type: "number" },
                  clause_count: { type: "number" },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const graphStats = await graph.getStats();
        const vectorStats = await vectorStore.getStats();

        const stats = {
          graph: {
            ...graphStats,
            total_nodes:
              graphStats["total_nodes"] ||
              Object.entries(graphStats)
                .filter(
                  ([k]) =>
                    !k.startsWith("edge:") &&
                    k !== "total_nodes" &&
                    k !== "total_edges",
                )
                .reduce((acc, [_, v]) => acc + (v as number), 0),
            total_edges:
              graphStats["total_edges"] ||
              Object.entries(graphStats)
                .filter(([k]) => k.startsWith("edge:"))
                .reduce((acc, [_, v]) => acc + (v as number), 0),
          },
          vector: {
            total_chunks:
              (vectorStats.articleCount || 0) + (vectorStats.clauseCount || 0),
            article_count: vectorStats.articleCount || 0,
            clause_count: vectorStats.clauseCount || 0,
            community_report_count: 0,
          },
        };

        logger.info(
          `Admin: Serving stats. ArticleCount=${(stats.graph as any).Article || 0}, TotalNodes=${stats.graph.total_nodes}`,
        );
        // Log some sample article IDs to check for duplicates/encoding issues
        try {
          const samples = await graph.query(
            "MATCH (n:Article) RETURN n LIMIT 1",
          );
          logger.info(
            `Admin: Article Node Sample: ${JSON.stringify(samples[0])}`,
          );
        } catch {
          // Sample fetch failed, ignore for stats
        }

        return reply.send(stats);
      } catch (error) {
        logger.error("Failed to fetch admin stats", error);
        return reply.status(500).send({ error: "Failed to fetch stats" });
      }
    },
  );

  // GET /admin/activity - Get recent activity logs
  fastify.get(
    "/admin/activity",
    {
      schema: {
        description: "Get recent system activity logs",
        tags: ["Admin"],
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", default: 10 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { limit = 10 } = request.query as { limit?: number };
      return reply.send({
        activities: activityLog.getEntries(limit),
      });
    },
  );
}
