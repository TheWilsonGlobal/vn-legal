// ============================================================================
// Admin Routes
// ============================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { GraphClient } from "../../graph/client";
import type { IVectorStore } from "../../embeddings/vector-store-factory";
import type { LegalConsultationAgent } from "../../agent/setup";
import logger from "../../shared/logger";
import { buildGraph, addGraph } from "../../scripts/build-graph";
import { buildVectorIndex, addIndex } from "../../scripts/build-index";
import { getEmbedder } from "../../embeddings/embedder";
import { activityLog } from "../../shared/activity-log";
import { config } from "../../shared/config";
import type { VectorResult } from "../../shared/types";
import { writeFile, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import { llmTracker } from "../../shared/llm-tracker";

// ----------------------------------------------------------------------------
// Admin Routes
// ----------------------------------------------------------------------------

export async function adminRoutes(
  fastify: FastifyInstance,
  options: {
    graph: GraphClient;
    vectorStore: IVectorStore;
    agent?: LegalConsultationAgent;
  },
) {
  const { graph, vectorStore, agent } = options;

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

  // GET /admin/communities - Fetch all community reports
  fastify.get(
    "/admin/communities",
    {
      schema: {
        description: "Get all community reports and summaries",
        tags: ["Admin"],
      } as any,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const query =
          "MATCH (n:Community) RETURN n.id as id, n.level as level, n.title as title, n.summary as summary, n.rating as rating, n.findings as findings, n.principles as principles, n.article_count as article_count ORDER BY n.level, n.title";
        const rawCommunities = await graph.query(query);

        const communities = rawCommunities.map((c: any) => ({
          ...c,
          findings:
            typeof c.findings === "string"
              ? JSON.parse(c.findings)
              : c.findings || [],
        }));

        return reply.send({ communities });
      } catch (error) {
        logger.error("Failed to fetch communities", error);
        return reply.status(500).send({ error: "Failed to fetch communities" });
      }
    },
  );

  // GET /admin/vector-store/status - Get vector store status
  fastify.get(
    "/admin/vector-store/status",
    {
      schema: {
        description: "Get current vector store type and status",
        tags: ["Admin"],
        response: {
          200: {
            type: "object",
            properties: {
              type: { type: "string" },
              ready: { type: "boolean" },
              config: { type: "object" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return reply.send({
          type: vectorStore.getType(),
          ready: vectorStore.isReady(),
          config: {
            vectorStoreType: config.vectorStoreType,
            lancedbPath: config.vectorDbPath,
            congraphPath: config.conGraphVectorDbPath,
          },
        });
      } catch (error) {
        logger.error("Failed to get vector store status", error);
        return reply
          .status(500)
          .send({ error: "Failed to get vector store status" });
      }
    },
  );

  // GET /admin/config - Get system configuration
  fastify.get(
    "/admin/config",
    {
      schema: {
        description: "Get system configuration",
        tags: ["Admin"],
        response: {
          200: {
            type: "object",
            properties: {
              vectorStoreType: { type: "string" },
              embeddingModel: { type: "string" },
              embeddingDimension: { type: "number" },
              embeddingBackend: { type: "string" },
              llmProvider: { type: "string" },
              llmModel: { type: "string" },
              clientGraphMode: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return reply.send({
          vectorStoreType: config.vectorStoreType,
          embeddingModel: config.embeddingModel,
          embeddingDimension: config.embeddingDimension,
          embeddingBackend: config.embeddingBackend,
          llmProvider: config.llm.provider,
          llmModel: config.llm.model,
          clientGraphMode: config.clientGraphMode,
        });
      } catch (error) {
        logger.error("Failed to get config", error);
        return reply.status(500).send({ error: "Failed to get config" });
      }
    },
  );

  // POST /admin/config - Update system configuration
  fastify.post(
    "/admin/config",
    {
      schema: {
        description: "Update system configuration",
        tags: ["Admin"],
        body: {
          type: "object",
          properties: {
            clientGraphMode: { type: "string", enum: ["query", "explorer"] },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = request.body as { clientGraphMode?: "query" | "explorer" };
        if (body.clientGraphMode) {
          config.clientGraphMode = body.clientGraphMode;
          logger.info(
            `Admin: Updated clientGraphMode to ${body.clientGraphMode}`,
          );
        }
        return reply.send({
          success: true,
          config: { clientGraphMode: config.clientGraphMode },
        });
      } catch (error) {
        logger.error("Failed to update config", error);
        return reply.status(500).send({ error: "Failed to update config" });
      }
    },
  );

  // POST /admin/knowledge/upload - Upload a legal data file and update graph
  fastify.post(
    "/admin/knowledge/upload",
    {
      schema: {
        description: "Upload a legal data file and update the Knowledge Graph",
        tags: ["Admin"],
        body: {
          type: "object",
          properties: {
            filename: { type: "string" },
            content: { type: "array" },
          },
          required: ["filename", "content"],
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { filename, content } = request.body as {
        filename: string;
        content: any[];
      };

      try {
        const dataDir = join(process.cwd(), "data");
        const filePath = join(dataDir, filename);

        logger.info(`Admin: Uploading knowledge file ${filename}`);

        // Save the file
        await writeFile(filePath, JSON.stringify(content, null, 2));
        activityLog.addEntry(
          "system",
          `Hệ thống: Đã tải lên tệp tri thức mới: ${filename}`,
        );

        // Trigger graph rebuild
        // We do this synchronously or asynchronously?
        // The user wants it to be "updated" after upload.
        // Update graph incrementally
        try {
          // Pass the shared graph instance to avoid multiple connections to the same file
          await addGraph(filePath, graph);

          // Also update vector index incrementally
          await addIndex(filePath, vectorStore);

          activityLog.addEntry(
            "system",
            "Hệ thống: Knowledge Graph và Vector Index đã được cập nhật thành công",
          );
        } catch (buildError) {
          logger.error("Failed to update index after upload", buildError);
          return reply
            .status(500)
            .send({ error: "File saved but index update failed" });
        }

        const graphStats = await graph.getStats();

        return reply.send({
          message: `File ${filename} uploaded and graph updated`,
          stats: {
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
                .reduce((acc, [_, v]) => acc + v, 0),
            total_edges:
              graphStats["total_edges"] ||
              Object.entries(graphStats)
                .filter(([k]) => k.startsWith("edge:"))
                .reduce((acc, [_, v]) => acc + v, 0),
          },
        });
      } catch (error) {
        logger.error("Failed to upload knowledge file", error);
        return reply.status(500).send({ error: "Upload failed" });
      }
    },
  );

  // POST /admin/knowledge/clean - Delete graph and knowledge data
  fastify.post(
    "/admin/knowledge/clean",
    {
      schema: {
        description: "Clean the Knowledge Graph and delete uploaded data files",
        tags: ["Admin"],
      } as any,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        logger.info("Admin: Cleaning knowledge data");

        // 1. Delete graph files
        const dbPath = config.graphDbPath;
        const walPath = dbPath.replace(".cgraph", ".wal");

        await unlink(dbPath).catch(() => {});
        await unlink(walPath).catch(() => {});

        // 2. Delete data files (except community_reports.json)
        const dataDir = join(process.cwd(), "data");
        const files = await readdir(dataDir);
        for (const file of files) {
          if (file.endsWith(".json") && file !== "community_reports.json") {
            await unlink(join(dataDir, file)).catch(() => {});
          }
        }

        activityLog.addEntry(
          "system",
          "Hệ thống: Toàn bộ dữ liệu tri thức và đồ thị đã được xóa sạch",
        );

        // 3. Clear graph client memory
        await graph.refresh();

        return reply.send({ message: "Knowledge data cleaned successfully" });
      } catch (error) {
        logger.error("Failed to clean knowledge data", error);
        return reply.status(500).send({ error: "Clean failed" });
      }
    },
  );

  // POST /admin/community/add - Add a new community report manually
  fastify.post(
    "/admin/community/add",
    {
      schema: {
        description:
          "Add a new community report to both graph and vector databases",
        tags: ["Admin"],
        body: {
          type: "object",
          properties: {
            community_id: { type: "string" },
            level: { type: "number" },
            title: { type: "string" },
            summary: { type: "string" },
            findings: { type: "array", items: { type: "string" } },
            rating: { type: "number" },
            parent_id: { type: "string" },
            article_count: { type: "number" },
            principles: { type: "string" },
          },
          required: ["community_id", "level", "title", "summary"],
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const report = request.body as any;

      try {
        logger.info(
          `Admin: Adding new community report: ${report.community_id}`,
        );

        // 1. Generate embedding for vector store
        const embedder = await getEmbedder();
        const textToEmbed = `${report.title} ${report.summary} ${(report.findings || []).join(" ")}`;
        const embedding = await embedder.embed(textToEmbed);

        // 2. Add to Vector Store
        await vectorStore.addCommunityReports([
          {
            vector: embedding,
            id: report.community_id,
            level: report.level,
            title: report.title,
            summary: report.summary,
            findings: Array.isArray(report.findings)
              ? report.findings.join("\n")
              : String(report.findings),
            rating: report.rating || 0,
            parent_id: report.parent_id || "",
          },
        ]);

        // 3. Add to Graph Database
        // Create the node
        await graph.addNode("Community", report.community_id, {
          level: report.level,
          title: report.title,
          summary: report.summary,
          rating: report.rating || 0,
          findings: report.findings || [],
          principles: report.principles || "",
          article_count: report.article_count || 0,
        });

        // Create hierarchical edge if level 1
        if (report.level === 1 && report.parent_id) {
          await graph.addEdge({
            from: report.parent_id,
            to: report.community_id,
            type: "CONTAINS",
          });
        }

        // Create BELONGS_TO_COMMUNITY edges from articles
        // We assume community_id matches the chapter ID for Level 1 communities (chapter_X)
        if (report.level === 1 && report.community_id.startsWith("chapter_")) {
          const chapterId = report.community_id;
          // Batch query articles and then create edges
          const articlesRes = await graph.query(
            `MATCH (a:Article)-[:BELONGS_TO_CHAPTER]->(c:Chapter {id: '${chapterId}'}) RETURN a.id as id`,
          );

          if (articlesRes && articlesRes.length > 0) {
            logger.info(
              `Linking ${articlesRes.length} articles to community ${report.community_id}`,
            );
            const edges = articlesRes.map((a) => ({
              from: a.id,
              to: report.community_id,
              type: "BELONGS_TO_COMMUNITY",
            }));
            await graph.createEdgesBatch(edges);
          }
        }

        // 4. Update local community_reports.json file
        const reportsPath = join(
          process.cwd(),
          "data",
          "community_reports.json",
        );
        try {
          const { readFile } = await import("node:fs/promises");
          let reports = [];
          try {
            const content = await readFile(reportsPath, "utf-8");
            reports = JSON.parse(content);
          } catch {
            logger.warn(
              "Could not read community_reports.json, creating new file",
            );
          }

          // Remove existing if same ID
          reports = reports.filter(
            (r: any) => r.community_id !== report.community_id,
          );
          reports.push(report);

          await writeFile(reportsPath, JSON.stringify(reports, null, 2));
        } catch {
          logger.error("Failed to update community_reports.json");
        }

        activityLog.addEntry(
          "system",
          `Hệ thống: Đã thêm báo cáo cộng đồng mới: ${report.title}`,
        );

        return reply.send({ message: "Community report added successfully" });
      } catch (error) {
        logger.error("Failed to add community report", error);
        return reply
          .status(500)
          .send({ error: "Failed to add community report" });
      }
    },
  );

  // GET /admin/llm/status - Check LLM connection status
  fastify.get(
    "/admin/llm/status",
    {
      schema: {
        description: "Get LLM provider status and connectivity",
        tags: ["Admin"],
        response: {
          200: {
            type: "object",
            properties: {
              provider: { type: "string" },
              model: { type: "string" },
              apiUrl: { type: "string" },
              status: { type: "string" },
              useLlm: { type: "boolean" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const useLlm = config.retrieval.useLlmForRetrieval;
      const provider = config.llm.provider;
      const model = config.llm.model;
      const apiUrl = (config.llm as any).apiUrl || "N/A";
      let status = "disconnected";

      if (useLlm) {
        if (provider === "template") {
          status = "connected";
        } else if (provider === "llama") {
          try {
            const checkRes = await fetch(`${apiUrl}/health`, {
              signal: AbortSignal.timeout(2000),
            });
            if (checkRes.ok) {
              status = "connected";
            }
          } catch {
            status = "disconnected";
          }
        } else if (provider === "anthropic") {
          status = config.llm.apiKey ? "connected" : "disconnected";
        } else if (provider === "openai") {
          status = config.llm.apiKey ? "connected" : "disconnected";
        }
      }

      return reply.send({
        provider,
        model,
        apiUrl,
        status,
        useLlm,
      });
    },
  );

  // GET /admin/llm/last-prompt - Retrieve last executed prompt/response log
  fastify.get(
    "/admin/llm/last-prompt",
    {
      schema: {
        description: "Get last executed LLM prompt and response log",
        tags: ["Admin"],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const log = llmTracker.getLastLog();
      return reply.send(
        log || {
          systemPrompt: "No prompts executed yet.",
          userPrompt: "No prompts executed yet.",
          response: "No response recorded.",
          timestamp: new Date().toISOString(),
        },
      );
    },
  );

  // POST /admin/llm/test - Test LLM connection with diagnostic prompt
  fastify.post(
    "/admin/llm/test",
    {
      schema: {
        description: "Test LLM connectivity with a simple query",
        tags: ["Admin"],
        body: {
          type: "object",
          properties: {
            prompt: { type: "string" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { prompt?: string };
      const testPrompt =
        body.prompt || "Xin chào, đây là câu hỏi kiểm tra kết nối.";

      try {
        const llm = (agent as any)?.llm;

        if (!llm) {
          return reply.status(400).send({
            success: false,
            error: "No active LLM adapter configured in the server.",
          });
        }

        const start = Date.now();
        const systemPrompt = "Bạn là trợ lý ảo kiểm tra kết nối hệ thống.";

        let prompt = `${systemPrompt}\n\n${testPrompt}`;
        if (config.llm.provider === "llama") {
          prompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${systemPrompt}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n${testPrompt}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n`;
        }

        const result = await llm.generate(prompt);
        const duration = Date.now() - start;

        return reply.send({
          success: true,
          response: result.content,
          duration_ms: duration,
          provider: config.llm.provider,
          model: config.llm.model,
        });
      } catch (error: any) {
        logger.error("LLM diagnostic test failed", error);
        return reply.status(500).send({
          success: false,
          error: error.message || String(error),
        });
      }
    },
  );
}
