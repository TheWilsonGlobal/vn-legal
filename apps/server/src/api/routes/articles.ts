// ============================================================================
// Articles Routes
// ============================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { GraphClient } from "../../graph/client";
import type { IVectorStore } from "../../embeddings/vector-store-factory";
import { z } from "zod";
import { getEmbedder } from "../../embeddings/embedder";

// ----------------------------------------------------------------------------
// Request Schemas
// ----------------------------------------------------------------------------

const ArticleParamsSchema = z.object({
  id: z.string(),
});

const SearchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.number().optional().default(10),
  part: z.string().optional(),
  chapter: z.string().optional(),
  section: z.string().optional(),
});

// ----------------------------------------------------------------------------
// Articles Routes
// ----------------------------------------------------------------------------

export async function articlesRoutes(
  fastify: FastifyInstance,
  options: {
    graph: GraphClient;
    vectorStore: IVectorStore;
  },
) {
  const { graph, vectorStore } = options;

  // GET /article/:id - Get article by ID
  fastify.get(
    "/article/:id",
    {
      schema: {
        description: "Get detailed information about a specific article by ID",
        tags: ["Articles"],
        params: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              article: { type: "object" },
              related_articles: {
                type: "object",
                properties: {
                  references: { type: "array", items: { type: "object" } },
                  referenced_by: { type: "array", items: { type: "object" } },
                },
              },
            },
          },
          404: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = ArticleParamsSchema.parse(request.params);

        // Get article from graph
        const article = await graph.getNode("Article", id);

        if (!article) {
          return reply.status(404).send({
            error: "Article not found",
          });
        }

        // Get related articles (referenced by and references)
        const outgoingEdges = await graph.getOutgoingEdges(id, "REFERENCES");
        const incomingEdges = await graph.getIncomingEdges(id, "REFERENCES");

        const referencedArticles = [];
        const referencingArticles = [];

        for (const edge of outgoingEdges) {
          const relatedArticle = await graph.getNode("Article", edge.to);
          if (relatedArticle) {
            referencedArticles.push({
              id: relatedArticle.id,
              article_number: relatedArticle.article_number,
              title: relatedArticle.title,
            });
          }
        }

        for (const edge of incomingEdges) {
          const relatedArticle = await graph.getNode("Article", edge.from);
          if (relatedArticle) {
            referencingArticles.push({
              id: relatedArticle.id,
              article_number: relatedArticle.article_number,
              title: relatedArticle.title,
            });
          }
        }

        return reply.send({
          article,
          related_articles: {
            references: referencedArticles,
            referenced_by: referencingArticles,
          },
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          error: "Internal server error",
        });
      }
    },
  );

  // GET /article/:id/clauses - Get article clauses
  fastify.get(
    "/article/:id/clauses",
    {
      schema: {
        description: "Get all clauses associated with a specific article",
        tags: ["Articles"],
        params: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              article_id: { type: "string" },
              clauses: { type: "array", items: { type: "object" } },
            },
          },
          404: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const { id } = ArticleParamsSchema.parse(request.params);

        const article = await graph.getNode("Article", id);

        if (!article) {
          return reply.status(404).send({
            error: "Article not found",
          });
        }

        return reply.send({
          article_id: id,
          clauses: article.clauses || [],
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          error: "Internal server error",
        });
      }
    },
  );

  // GET /search - Search articles
  fastify.get(
    "/search",
    {
      schema: {
        description: "Search articles using semantic or keyword search",
        tags: ["Articles"],
        querystring: {
          type: "object",
          properties: {
            q: { type: "string" },
            limit: { type: "integer", default: 10 },
            part: { type: "string" },
            chapter: { type: "string" },
            section: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              query: { type: "string" },
              results: { type: "array", items: { type: "object" } },
              filters: { type: "object" },
              limit: { type: "integer" },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Querystring: z.infer<typeof SearchQuerySchema>;
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const {
          q,
          limit = 10,
          part,
          chapter,
          section,
        } = SearchQuerySchema.parse(request.query);

        // 1. Get embedder and embed query
        const embedder = await getEmbedder();
        const queryVector = await embedder.embed(q);

        // 2. Search vector store
        const results = await vectorStore.searchArticles(queryVector, limit, {
          part,
          chapter,
          section,
        });

        return reply.send({
          query: q,
          results: results.map((r) => ({
            id: r.article_id,
            article_number: r.article_number,
            title: r.title,
            content: r.content,
            score:
              (r as any)._distance !== undefined
                ? 1 - (r as any)._distance
                : undefined,
          })),
          filters: { part, chapter, section },
          limit,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          error: "Internal server error",
        });
      }
    },
  );

  // GET /articles/random - Get random article
  fastify.get(
    "/articles/random",
    {
      schema: {
        description: "Get a random article, optionally filtered by chapter",
        tags: ["Articles"],
        querystring: {
          type: "object",
          properties: {
            chapter: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              article: { type: "object" },
            },
          },
          404: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Querystring: { chapter?: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const { chapter } = request.query;

        const articles = await graph.getNodesByType("Article");

        let filteredArticles = articles;

        if (chapter) {
          // Filter by chapter
          filteredArticles = [];
          for (const article of articles) {
            const edges = await graph.getOutgoingEdges(
              article.id,
              "BELONGS_TO",
            );
            const belongsToChapter = edges.some((edge) => {
              // Check if the edge leads to a chapter node with matching name
              return edge.to.includes(chapter);
            });

            if (belongsToChapter) {
              filteredArticles.push(article);
            }
          }
        }

        if (filteredArticles.length === 0) {
          return reply.status(404).send({
            error: "No articles found",
          });
        }

        const randomIndex = Math.floor(Math.random() * filteredArticles.length);
        const randomArticle = filteredArticles[randomIndex];

        return reply.send({
          article: randomArticle,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          error: "Internal server error",
        });
      }
    },
  );
}
