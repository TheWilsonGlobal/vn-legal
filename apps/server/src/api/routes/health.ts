// ============================================================================
// Health Check Routes
// ============================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { GraphClient } from "../../graph/client";
import type { IVectorStore } from "../../embeddings/vector-store-factory";

// ----------------------------------------------------------------------------
// Health Check Routes
// ----------------------------------------------------------------------------

export async function healthRoutes(
  fastify: FastifyInstance,
  options: {
    graph: GraphClient;
    vectorStore: IVectorStore;
  },
) {
  const { graph, vectorStore } = options;

  // GET /health - Basic health check
  fastify.get(
    "/health",
    {
      schema: {
        description: "Get basic health status of the system",
        tags: ["Health"],
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              databases: {
                type: "object",
                properties: {
                  graph: { type: "string" },
                  vector: { type: "string" },
                },
              },
              timestamp: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const graphReady = await checkGraphHealth(graph);
        const vectorReady = checkVectorHealth(vectorStore);

        const health = {
          status: graphReady && vectorReady ? "ok" : "degraded",
          databases: {
            graph: graphReady ? "ready" : "not ready",
            vector: vectorReady ? "ready" : "not ready",
          },
          timestamp: new Date().toISOString(),
        };

        const statusCode = health.status === "ok" ? 200 : 503;

        return reply.status(statusCode).send(health);
      } catch (error) {
        fastify.log.error(error);

        return reply.status(503).send({
          status: "error",
          databases: {
            graph: "error",
            vector: "error",
          },
          timestamp: new Date().toISOString(),
        });
      }
    },
  );

  // GET /health/stats - Detailed statistics
  fastify.get(
    "/health/stats",
    {
      schema: {
        description: "Get detailed statistics from graph and vector databases",
        tags: ["Health"],
        response: {
          200: {
            type: "object",
            properties: {
              graph: { type: "object", additionalProperties: true },
              vector: { type: "object", additionalProperties: true },
              timestamp: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const graphStats = await graph.getStats();
        const vectorStats = await vectorStore.getStats();

        const totalNodes = Object.entries(graphStats)
          .filter(([key]) => !key.startsWith("edge:"))
          .reduce((sum, [, count]) => sum + count, 0);

        const totalEdges = Object.entries(graphStats)
          .filter(([key]) => key.startsWith("edge:"))
          .reduce((sum, [, count]) => sum + count, 0);

        return reply.send({
          graph: {
            ...graphStats,
            total_nodes: totalNodes,
            total_edges: totalEdges,
          },
          vector: vectorStats,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        fastify.log.error(error);

        return reply.status(500).send({
          error: "Failed to retrieve statistics",
        });
      }
    },
  );

  // GET /health/ready - Readiness check
  fastify.get(
    "/health/ready",
    {
      schema: {
        description: "Check if the system is ready to handle requests",
        tags: ["Health"],
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
            },
          },
          503: {
            type: "object",
            properties: {
              status: { type: "string" },
              checks: { type: "object" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const graphReady = await checkGraphHealth(graph);
      const vectorReady = checkVectorHealth(vectorStore);

      if (graphReady && vectorReady) {
        return reply.status(200).send({
          status: "ready",
        });
      }

      return reply.status(503).send({
        status: "not ready",
        checks: {
          graph: graphReady ? "ready" : "not ready",
          vector: vectorReady ? "ready" : "not ready",
        },
      });
    },
  );
}

// ----------------------------------------------------------------------------
// Helper Functions
// ----------------------------------------------------------------------------

async function checkGraphHealth(graph: GraphClient): Promise<boolean> {
  try {
    const nodeCount = await graph.countNodes();
    return nodeCount > 0;
  } catch {
    return false;
  }
}

function checkVectorHealth(vectorStore: IVectorStore): boolean {
  return vectorStore.isReady();
}
