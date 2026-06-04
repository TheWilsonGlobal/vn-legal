// ============================================================================
// Fastify Server Setup
// ============================================================================

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import path from "path";
import type { LegalConsultationAgent } from "../agent/setup";
import type { GraphClient } from "../graph/client";
import type { IVectorStore } from "../embeddings/vector-store-factory";
import { config } from "../shared/config";
import logger from "../shared/logger";
import { consultationRoutes } from "./routes/consultation";
import { articlesRoutes } from "./routes/articles";
import { healthRoutes } from "./routes/health";
import { adminRoutes } from "./routes/admin";
import { configRoutes } from "./routes/config";
import { createGraphClient } from "../graph/client";
import { createVectorStore } from "../embeddings/vector-store-factory";
import { getEmbedder } from "../embeddings/embedder-factory";
import { createHybridRetrieval } from "../retrieval/hybrid-congraph";
import { createLegalConsultationAgent } from "../agent/setup";
import { createLLMAdapter } from "../agent/congraph-rag-llm";
import { createStorageAdapter } from "../storage-adapters/congraph-rag-adapter";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

// Server Options
// ----------------------------------------------------------------------------

interface ServerOptions {
  agent: LegalConsultationAgent;
  graph: GraphClient;
  vectorStore: IVectorStore;
}

// ----------------------------------------------------------------------------
// Create Server
// ----------------------------------------------------------------------------

export async function createServer(options: ServerOptions) {
  const { agent, graph, vectorStore } = options;

  const fastify = Fastify({
    logger: {
      level: config.logging.level,
    },
    bodyLimit: 10 * 1024 * 1024, // 10MB
  });

  // 1. Register Swagger & UI first

  await fastify.register(fastifySwagger, {
    openapi: {
      info: {
        title: "VinaLegal API",
        description: "Vietnam Legal Consultant System API Documentation",
        version: "0.1.0",
      },
    },
  });

  await fastify.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    staticCSP: false,
    uiConfig: {
      docExpansion: "list",
      deepLinking: false,
    },
  });

  await fastify.after();

  // 3. Register API routes
  await fastify.register(healthRoutes, { prefix: "/api", graph, vectorStore });
  await fastify.register(adminRoutes, {
    prefix: "/api",
    graph,
    vectorStore,
    agent,
  });
  await fastify.register(consultationRoutes, { prefix: "/api", agent });
  await fastify.register(articlesRoutes, {
    prefix: "/api",
    graph,
    vectorStore,
  });
  await fastify.register(configRoutes, { prefix: "/api" });

  // 4. Register static files (last)
  await fastify.register(fastifyStatic, {
    root: path.join(process.cwd(), "dist/client"),
    prefix: "/",
  });

  await fastify.register(fastifyStatic, {
    root: path.join(process.cwd(), "dist/admin"),
    prefix: "/admin",
    decorateReply: false,
  });

  // 4. Register error handler
  fastify.setErrorHandler(errorHandler);

  // 5. Register not found handler (very last)
  fastify.setNotFoundHandler(notFoundHandler);

  // Graceful shutdown
  fastify.addHook("onClose", async (_instance) => {
    logger.info("Closing server connections");

    try {
      await graph.close();
      await vectorStore.close();
    } catch (error) {
      logger.error("Error closing connections", error);
    }
  });

  return fastify;
}

// ----------------------------------------------------------------------------
// Start Server
// ----------------------------------------------------------------------------

export async function startServer(options: ServerOptions): Promise<any> {
  const fastify = await createServer(options);

  try {
    const address = await fastify.listen({
      port: config.api.port,
      host: config.api.host,
    });

    logger.info(`Server listening at ${address}`);
    logger.info(
      `API documentation available at http://${config.api.host}:${config.api.port}/docs/`,
    );
    logger.info(
      `Health check available at http://${config.api.host}:${config.api.port}/api/health`,
    );
  } catch (error) {
    logger.error("Failed to start server", error);
    throw error;
  }

  return fastify;
}

// ----------------------------------------------------------------------------
// Server factory
// ----------------------------------------------------------------------------

export function initializeServer(options: ServerOptions) {
  return {
    create: () => createServer(options),
    start: () => startServer(options),
  };
}
// ----------------------------------------------------------------------------
// Run if directly executed
// ----------------------------------------------------------------------------

const isMainModule =
  (import.meta.url ===
    `file://${path.resolve(process.argv[1]).replace(/\\/g, "/")}` ||
    process.argv[1]?.endsWith("server.js") ||
    process.argv[1]?.endsWith("server.ts")) &&
  process.env.NODE_ENV !== "test";

if (isMainModule) {
  (async () => {
    try {
      logger.info("Initializing Vietnam Legal Consultant System...");

      // 1. Initialize core components
      const graph = await createGraphClient();
      const vectorStore = await createVectorStore(config.vectorStoreType);
      await vectorStore.initialize(); // Initialize the vector store
      const embedder = await getEmbedder();

      // 2. Initialize LLM (optional)
      const useLlm = config.retrieval.useLlmForRetrieval;
      const llm = useLlm
        ? createLLMAdapter(embedder, {
            provider: config.llm.provider as any,
            apiKey: config.llm.apiKey,
            model: config.llm.model,
            apiUrl: (config.llm as any).apiUrl,
          })
        : undefined;

      // 3. Initialize Retrieval with Template LLM (fast, database-only operations)
      const storage = createStorageAdapter(graph, vectorStore);
      const retrievalLlm = createLLMAdapter(embedder, { provider: "template" });
      const retrieval = createHybridRetrieval(storage, retrievalLlm, embedder);

      // 4. Initialize Agent with the real LLM (used to generate final consultation text)
      const agent = createLegalConsultationAgent(retrieval, llm);

      // 5. Start Server
      await startServer({
        agent,
        graph,
        vectorStore,
      });
    } catch (error) {
      logger.error("Failed to initialize system", error);
      process.exit(1);
    }
  })();
}
