import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import logger from "../../../shared/logger";
import type { AdminRoutesOptions } from "./types";

export function registerGraphDataRoutes(
  fastify: FastifyInstance,
  options: AdminRoutesOptions,
): void {
  const { graph } = options;

  // GET /admin/graph/data - Fetch nodes and edges for visualization
  fastify.get(
    "/admin/graph/data",
    {
      schema: {
        description: "Get graph nodes and edges for visualization",
        tags: ["Admin"],
        response: {
          200: {
            type: "object",
            properties: {
              nodes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    type: { type: "string" },
                  },
                },
              },
              edges: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    source: { type: "string" },
                    target: { type: "string" },
                    type: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Fetch core hierarchy nodes
        const nodeTypes = [
          "Part",
          "Chapter",
          "Section",
          "Subsection",
          "Article",
          "Clause",
          "ClausePoint",
        ];
        const nodes: any[] = [];
        const edges: any[] = [];

        for (const type of nodeTypes) {
          const typeNodes = await graph.getNodesByType(type);
          nodes.push(
            ...typeNodes.map((n) => ({
              id: n.id,
              label: n.name || n.title || n.id,
              type: type,
            })),
          );
        }

        // Fetch core relationships
        const relTypes = [
          "HAS_PART",
          "HAS_CHAPTER",
          "HAS_SECTION",
          "HAS_SUBSECTION",
          "HAS_ARTICLE",
          "BELONGS_TO_ARTICLE",
          "BELONGS_TO_SUBSECTION",
          "BELONGS_TO_SECTION",
          "BELONGS_TO_CHAPTER",
          "BELONGS_TO_PART",
          "HAS_CLAUSE",
          "HAS_POINT",
        ];

        // Since we don't have a global "get all edges" efficiently yet,
        // we'll query for each type that connects the nodes we fetched
        for (const type of relTypes) {
          const query = `MATCH (n)-[r:${type}]->(m) RETURN n.id as source, m.id as target, type(r) as type`;
          const rels = await graph.query(query);
          edges.push(
            ...rels.map((r, i) => ({
              id: `${type}_${i}`,
              source: r.source,
              target: r.target,
              type: r.type,
            })),
          );
        }

        return reply.send({ nodes, edges });
      } catch (error) {
        logger.error("Failed to fetch graph data", error);
        return reply.status(500).send({ error: "Failed to fetch graph data" });
      }
    },
  );

  // GET /admin/graph/relations/leaderboard - Get top referenced and referring articles
  fastify.get(
    "/admin/graph/relations/leaderboard",
    {
      schema: {
        description:
          "Get top referenced and referring articles in the Knowledge Graph",
        tags: ["Admin"],
        response: {
          200: {
            type: "object",
            properties: {
              topReferenced: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    title: { type: "string" },
                    count: { type: "number" },
                  },
                },
              },
              topReferring: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    title: { type: "string" },
                    count: { type: "number" },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const topReferencedRaw = await graph.query(
          "MATCH (n:Article)-[r:REFERENCES]->(m:Article) RETURN m.id as id, m.title as title, count(r) as count ORDER BY count DESC LIMIT 5",
        );
        const topReferringRaw = await graph.query(
          "MATCH (n:Article)-[r:REFERENCES]->(m:Article) RETURN n.id as id, n.title as title, count(r) as count ORDER BY count DESC LIMIT 5",
        );

        const topReferenced = topReferencedRaw.map((row: any) => ({
          id: row.id ?? row.group_key_0 ?? "",
          title: row.title ?? row.group_key_1 ?? "",
          count: Number(row.count ?? 0),
        }));

        const topReferring = topReferringRaw.map((row: any) => ({
          id: row.id ?? row.group_key_0 ?? "",
          title: row.title ?? row.group_key_1 ?? "",
          count: Number(row.count ?? 0),
        }));

        return reply.send({ topReferenced, topReferring });
      } catch (error) {
        logger.error("Failed to fetch graph relations leaderboard", error);
        return reply.status(500).send({ error: "Failed to fetch leaderboard" });
      }
    },
  );
}
