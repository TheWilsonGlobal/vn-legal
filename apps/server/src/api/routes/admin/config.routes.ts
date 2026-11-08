import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import logger from "../../../shared/logger";
import { config } from "../../../shared/config";
import type { AdminRoutesOptions } from "./types";

export function registerConfigRoutes(
  fastify: FastifyInstance,
  options: AdminRoutesOptions,
): void {
  const { vectorStore } = options;

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
              graphDbPath: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // The agent path embeds with Gemini (config.embedding). The legacy
        // transformers fields describe a store that is no longer used, so report
        // the running embedder when it is Gemini.
        const gemini = config.embedding?.provider === "gemini";
        return reply.send({
          vectorStoreType: config.vectorStoreType,
          embeddingModel: gemini ? (config.embedding?.model ?? "") : config.embeddingModel,
          embeddingDimension: gemini ? config.embedding?.dim : config.embeddingDimension,
          embeddingBackend: gemini ? "gemini" : config.embeddingBackend,
          llmProvider: config.llm.provider,
          llmModel: config.llm.model,
          clientGraphMode: config.clientGraphMode,
          graphDbPath: config.graphDbPath,
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
}
