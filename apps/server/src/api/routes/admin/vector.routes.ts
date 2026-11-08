import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import logger from "../../../shared/logger";
import { getEmbedder } from "../../../embeddings/embedder-factory";
import type { VectorResult } from "../../../shared/types";
import type { AdminRoutesOptions } from "./types";

export function registerVectorRoutes(
  fastify: FastifyInstance,
  options: AdminRoutesOptions,
): void {
  const { graph, vectorStore } = options;

  // POST /admin/vector/search - Search vector store for debugging
  fastify.post(
    "/admin/vector/search",
    {
      schema: {
        description: "Search vector store with raw query for debugging",
        tags: ["Admin"],
        body: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number" },
          },
          required: ["query"],
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { query, limit = 5 } = request.body as {
        query: string;
        limit?: number;
      };

      try {
        const embedder = await getEmbedder();
        const queryVector = await embedder.embed(query);

        const articleResults = (await vectorStore.searchArticles(
          queryVector,
          limit,
        )) as VectorResult[];
        const clauseResults = (await vectorStore.searchClauses(
          queryVector,
          limit,
        )) as VectorResult[];

        // Combine and sort by distance
        const combined = [
          ...articleResults.map((r) => ({ ...r, type: "article" })),
          ...clauseResults.map((r) => {
            // Extract article_number from article_id if available
            let articleNumber = 0;
            if (r.article_id) {
              const parts = (r.article_id as string).split("_");
              const numPart = parts[parts.length - 1]; // Get the last part
              articleNumber = parseInt(numPart, 10) || 0;
            }

            return {
              ...r,
              type: "clause",
              content: r.text,
              title: r.article_title,
              article_number: articleNumber,
              article_id: r.article_id
                ? `${r.article_id}_clause_${r.clause_number}`
                : `clause_${r.clause_number}`,
            };
          }),
        ]
          .sort(
            (a, b) =>
              ((a as VectorResult)._distance || 0) -
              ((b as VectorResult)._distance || 0),
          )
          .slice(0, limit);

        return reply.send({ results: combined });
      } catch (error) {
        logger.error("Admin vector search failed", error);
        return reply.status(500).send({ error: "Search failed" });
      }
    },
  );

  // GET /admin/vector/chunks - List all vector chunks
  fastify.get(
    "/admin/vector/chunks",
    {
      schema: {
        description:
          "Get all vector store chunks (articles and clauses) with pagination and search",
        tags: ["Admin"],
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", default: 1 },
            limit: { type: "integer", default: 20 },
            search: { type: "string", default: "" },
            type: {
              type: "string",
              enum: ["all", "article", "clause"],
              default: "all",
            },
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

        // 1. Fetch articles from graph
        const rawArticles = await graph.getNodesByType("Article");
        const articles = rawArticles.map((a) => ({
          id: a.id,
          type: "article",
          title: a.title,
          content: a.content,
          article_number: a.article_number,
          metadata: a.metadata || {},
        }));

        // Create article map for clause lookup
        const articleMap = new Map<string, any>();
        articles.forEach((a) => articleMap.set(a.id, a));

        // 2. Fetch clauses from graph
        const rawClauses = await graph.getNodesByType("Clause");
        const clauses = rawClauses.map((c) => {
          const article = articleMap.get(c.article_id);
          const meta = article?.metadata || {};
          return {
            id: c.id,
            type: "clause",
            title: `${article?.title || "N/A"} - Khoản ${c.clause_number}`,
            content: c.text,
            article_id: c.article_id,
            clause_number: c.clause_number,
            metadata: {
              part: meta.part || "",
              chapter: meta.chapter || "",
              section: meta.section || "",
              subsection: meta.subsection || "",
            },
          };
        });

        // 3. Combine chunks
        let chunks: any[] = [];
        if (type === "all") {
          chunks = [...articles, ...clauses];
        } else if (type === "article") {
          chunks = articles;
        } else if (type === "clause") {
          chunks = clauses;
        }

        // 4. Apply search filter if provided
        if (search && search.trim() !== "") {
          const searchLower = search.toLowerCase();
          chunks = chunks.filter((chunk) => {
            const titleMatch = chunk.title?.toLowerCase().includes(searchLower);
            const contentMatch = chunk.content
              ?.toLowerCase()
              .includes(searchLower);
            const idMatch = chunk.id?.toLowerCase().includes(searchLower);
            return titleMatch || contentMatch || idMatch;
          });
        }

        // Sort chunks: sort by type (articles first, then clauses), and then by article number / clause number or ID
        chunks.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === "article" ? -1 : 1;
          }
          if (a.type === "article") {
            return (a.article_number || 0) - (b.article_number || 0);
          } else {
            // For clauses, sort by article_id then clause_number
            if (a.article_id !== b.article_id) {
              return (a.article_id || "").localeCompare(b.article_id || "");
            }
            return (a.clause_number || 0) - (b.clause_number || 0);
          }
        });

        // 5. Paginate
        const total = chunks.length;
        const totalPages = Math.ceil(total / limit);
        const startIndex = (page - 1) * limit;
        const paginatedChunks = chunks.slice(startIndex, startIndex + limit);

        return reply.send({
          chunks: paginatedChunks,
          pagination: {
            total,
            page,
            limit,
            pages: totalPages,
          },
        });
      } catch (error) {
        logger.error("Failed to fetch vector store chunks", error);
        return reply.status(500).send({ error: "Failed to fetch chunks" });
      }
    },
  );
}
