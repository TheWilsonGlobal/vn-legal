import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import logger from "../../../shared/logger";
import type { AdminRoutesOptions } from "./types";

export function registerGraphRelationsRoutes(
  fastify: FastifyInstance,
  options: AdminRoutesOptions,
): void {
  const { graph } = options;

  // GET /admin/graph/relations - Fetch all graph relations with pagination and filtering
  fastify.get(
    "/admin/graph/relations",
    {
      schema: {
        description:
          "Get all graph relations with pagination and search/filters",
        tags: ["Admin"],
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", default: 1 },
            limit: { type: "integer", default: 20 },
            search: { type: "string", default: "" },
            type: { type: "string", default: "all" },
          },
        },
      } as any,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const {
          page = 1,
          limit = 20,
          search = "",
          type = "all",
        } = request.query as {
          page?: number;
          limit?: number;
          search?: string;
          type?: string;
        };

        const nodeTypes = [
          "Part",
          "Chapter",
          "Section",
          "Subsection",
          "Article",
          "Clause",
          "ClausePoint",
        ];
        const nodeMap = new Map<string, { label: string; type: string }>();

        for (const t of nodeTypes) {
          const typeNodes = await graph.getNodesByType(t);
          for (const n of typeNodes) {
            nodeMap.set(n.id, {
              label: n.name || n.title || n.id,
              type: t,
            });
          }
        }

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
          "REFERENCES",
          "REFERENCED_BY",
          "NEXT_ARTICLE",
        ];

        const allRelations: any[] = [];
        for (const t of relTypes) {
          let q;
          if (t === "REFERENCES") {
            q = `MATCH (n)-[r:${t}]->(m) RETURN n.id as source, m.id as target, type(r) as type, r.context as context, r.reference_text as reference_text`;
          } else {
            q = `MATCH (n)-[r:${t}]->(m) RETURN n.id as source, m.id as target, type(r) as type`;
          }
          const rels = await graph.query(q);
          allRelations.push(...rels);
        }

        const relations = allRelations.map((r, idx) => {
          const sourceId = r.source;
          const targetId = r.target;
          const rType = r.type;

          const sourceNode = nodeMap.get(sourceId);
          const targetNode = nodeMap.get(targetId);

          return {
            id: `${rType}_${idx}`,
            sourceId,
            sourceLabel: sourceNode?.label || sourceId,
            sourceType: sourceNode?.type || "Unknown",
            targetId,
            targetLabel: targetNode?.label || targetId,
            targetType: targetNode?.type || "Unknown",
            type: rType,
            context: r.context || null,
            reference_text: r.reference_text || null,
          };
        });

        let filtered = relations;
        if (type !== "all") {
          filtered = filtered.filter((r) => r.type === type);
        }

        if (search && search.trim() !== "") {
          const searchLower = search.toLowerCase();
          filtered = filtered.filter(
            (r) =>
              r.sourceId.toLowerCase().includes(searchLower) ||
              r.sourceLabel.toLowerCase().includes(searchLower) ||
              r.targetId.toLowerCase().includes(searchLower) ||
              r.targetLabel.toLowerCase().includes(searchLower) ||
              (r.reference_text &&
                r.reference_text.toLowerCase().includes(searchLower)) ||
              (r.context && r.context.toLowerCase().includes(searchLower)),
          );
        }

        filtered.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type.localeCompare(b.type);
          }
          return a.sourceLabel.localeCompare(b.sourceLabel);
        });

        const total = filtered.length;
        const totalPages = Math.ceil(total / limit);
        const startIndex = (page - 1) * limit;
        const paginated = filtered.slice(startIndex, startIndex + limit);

        return reply.send({
          relations: paginated,
          pagination: {
            total,
            page,
            limit,
            pages: totalPages,
          },
        });
      } catch (error) {
        logger.error("Failed to fetch graph relations", error);
        return reply
          .status(500)
          .send({ error: "Failed to fetch graph relations" });
      }
    },
  );
}
