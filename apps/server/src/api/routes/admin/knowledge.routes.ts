import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { writeFile, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import logger from "../../../shared/logger";
import { addGraph } from "../../../scripts/build-graph";
import { addIndex } from "../../../scripts/build-index";
import { activityLog } from "../../../shared/activity-log";
import { config } from "../../../shared/config";
import type { AdminRoutesOptions } from "./types";

export function registerKnowledgeRoutes(
  fastify: FastifyInstance,
  options: AdminRoutesOptions,
): void {
  const { graph, vectorStore } = options;

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
                .reduce((acc, [_, v]) => acc + (v as number), 0),
            total_edges:
              graphStats["total_edges"] ||
              Object.entries(graphStats)
                .filter(([k]) => k.startsWith("edge:"))
                .reduce((acc, [_, v]) => acc + (v as number), 0),
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
}
