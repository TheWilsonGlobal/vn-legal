import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import logger from "../../../shared/logger";
import { getEmbedder } from "../../../embeddings/embedder";
import { activityLog } from "../../../shared/activity-log";
import type { AdminRoutesOptions } from "./types";

export function registerCommunityRoutes(
  fastify: FastifyInstance,
  options: AdminRoutesOptions,
): void {
  const { graph, vectorStore } = options;

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
}
