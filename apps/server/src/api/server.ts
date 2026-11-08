// ============================================================================
// Fastify Server Setup
// ============================================================================

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import fs from "fs";
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
import { authRoutes } from "./routes/auth";
import { agentRoutes, type AgentRoutesOptions } from "./routes/agent";
import { createJsonlSessionStore } from "../agent/sessions/jsonl-session-store";
import { EmbeddingFailure } from "../agent/graph/embedding-failure";
import { createSessionMemory } from "../agent/memory/session-memory";
import { createAgentTracer } from "../observability/tracer";
import { policyHook, type PolicyEntry } from "./middleware/iamAuth";
import { assertIamConfig } from "../shared/config";
import { createGraphClient } from "../graph/client";
import { createVectorStore } from "../embeddings/vector-store-factory";
import { getEmbedder } from "../embeddings/embedder-factory";
import { createHybridRetrieval } from "../retrieval/hybrid-congraph";
import { createLegalConsultationAgent } from "../agent/setup";
import { createLLMAdapter } from "../agent/congraph-rag-llm";
import { createStorageAdapter } from "../storage-adapters/congraph-rag-adapter";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { assertGeminiOnlyAgentConfig } from "../agent/graph/guard";
import {
  createLegalAgentRunner,
  setActiveAgentRunner,
} from "../agent/graph/runner";
import {
  assertIndexManifest,
  assertServerEmbeddingConfig,
  describeEmbedder,
} from "../embeddings/index-manifest";

// Server Options
// ----------------------------------------------------------------------------

interface ServerOptions {
  agent: LegalConsultationAgent;
  graph: GraphClient;
  vectorStore: IVectorStore;
  agentRoutesOptions?: AgentRoutesOptions;
}

// ----------------------------------------------------------------------------
// Create Server
// ----------------------------------------------------------------------------

/**
 * Embedding failures seen by the retrieval layer on the agent path (AC 38). Hybrid
 * retrieval turns an error into an empty result, so the failure is recorded here
 * and the agent adapter below throws it instead.
 */
const agentEmbedding: { failed?: string } = {};

function withEmbeddingFailureRecording<T extends object>(embedder: T): T {
  return new Proxy(embedder, {
    get(target, prop) {
      if (prop === "embed") {
        return async (text: string) => {
          try {
            return await (target as any).embed(text);
          } catch (err) {
            agentEmbedding.failed = err instanceof Error ? err.message : String(err);
            throw err;
          }
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

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

  // 2. Register Global IAM Policy Hook
  // Public routes are explicitly marked 'public'.
  // Protected routes require valid IAM permission.
  // Missing routes fail closed with 403 Forbidden.
  const policy: PolicyEntry[] = [
    // Public routes
    { method: "GET", url: "/api/health", permission: "public" },
    { method: "GET", url: "/api/health/liveness", permission: "public" },
    { method: "GET", url: "/api/health/readiness", permission: "public" },
    { method: "GET", url: "/api/config", permission: "public" },
    { method: "GET", url: "/api/auth/me", permission: "public" },
    { method: "GET", url: "/api/docs", permission: "public" },
    { method: "GET", url: "/api/docs/*", permission: "public" },
    { method: "GET", url: "/api/error", permission: "public" },
    { method: "GET", url: "/api/error-no-msg", permission: "public" },
    { method: "GET", url: "/api/consult/suggestions", permission: "public" },

    // Consultation routes
    { method: "POST", url: "/api/consult", permission: "consult:create" },

    // Article query routes
    { method: "GET", url: "/api/article/:id", permission: "articles:read" },
    {
      method: "GET",
      url: "/api/article/:id/clauses",
      permission: "articles:read",
    },
    { method: "GET", url: "/api/articles", permission: "articles:read" },
    { method: "GET", url: "/api/articles/random", permission: "articles:read" },
    { method: "GET", url: "/api/articles/search", permission: "articles:read" },
    { method: "GET", url: "/api/search", permission: "articles:read" },

    // Agent workbench routes (C1-C10)
    { method: "POST", url: "/api/agent/stream", permission: "consult:create" },
    { method: "POST", url: "/api/agent/run", permission: "consult:create" },
    {
      method: "POST",
      url: "/api/agent/sessions",
      permission: "session:manage_own",
    },
    {
      method: "GET",
      url: "/api/agent/sessions",
      permission: "session:read_own",
    },
    {
      method: "GET",
      url: "/api/agent/sessions/:id",
      permission: "session:read_own",
    },
    {
      method: "DELETE",
      url: "/api/agent/sessions/:id",
      permission: "session:manage_own",
    },
    { method: "GET", url: "/api/agent/traces", permission: "session:read_own" },
    {
      method: "GET",
      url: "/api/agent/traces/verify",
      permission: "session:read_own",
    },
    { method: "GET", url: "/api/agent/examples", permission: "public" },
    { method: "GET", url: "/api/agent/info", permission: "public" },
    { method: "GET", url: "/api/agent/memory/stats", permission: "public" },

    // Admin & system routes
    { method: "GET", url: "/api/admin/stats", permission: "graph:read" },
    { method: "GET", url: "/api/admin/activity", permission: "logs:read" },
    { method: "GET", url: "/api/admin/sessions", permission: "logs:read" },
    { method: "GET", url: "/api/admin/traces", permission: "logs:read" },
    {
      method: "POST",
      url: "/api/admin/rebuild-graph",
      permission: "graph:manage",
    },
    {
      method: "POST",
      url: "/api/admin/rebuild-vector",
      permission: "vector:manage",
    },
    {
      method: "GET",
      url: "/api/admin/vector-store/status",
      permission: "vector:manage",
    },
    {
      method: "GET",
      url: "/api/admin/vector/chunks",
      permission: "vector:manage",
    },
    {
      method: "POST",
      url: "/api/admin/vector/search",
      permission: "vector:manage",
    },
    { method: "GET", url: "/api/admin/graph/data", permission: "graph:read" },
    {
      method: "GET",
      url: "/api/admin/graph/relations",
      permission: "graph:read",
    },
    {
      method: "GET",
      url: "/api/admin/graph/relations/leaderboard",
      permission: "graph:read",
    },
    {
      method: "GET",
      url: "/api/admin/communities",
      permission: "community:read",
    },
    {
      method: "POST",
      url: "/api/admin/community/add",
      permission: "community:read",
    },
    {
      method: "POST",
      url: "/api/admin/knowledge/upload",
      permission: "graph:manage",
    },
    {
      method: "POST",
      url: "/api/admin/knowledge/clean",
      permission: "graph:manage",
    },
    { method: "GET", url: "/api/admin/config", permission: "settings:manage" },
    {
      method: "GET",
      url: "/api/admin/config/export",
      permission: "settings:manage",
    },
    { method: "POST", url: "/api/admin/config", permission: "settings:manage" },
    {
      method: "GET",
      url: "/api/admin/llm/status",
      permission: "settings:manage",
    },
    {
      method: "GET",
      url: "/api/admin/llm/last-prompt",
      permission: "settings:manage",
    },
    {
      method: "PUT",
      url: "/api/admin/llm/endpoint",
      permission: "settings:manage",
    },
    {
      method: "POST",
      url: "/api/admin/llm/test",
      permission: "settings:manage",
    },
  ];

  fastify.addHook("onRequest", policyHook(policy));

  // 3. Register API routes
  await fastify.register(healthRoutes, { prefix: "/api", graph, vectorStore });
  await fastify.register(authRoutes, { prefix: "/api" });
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

  // Register Agent Workbench routes (C1-C10). The runner is the LangGraph graph
  // (plan r5 §5.1): tools, native tool calling, Gemini only.
  let agentOpts = options.agentRoutesOptions;
  if (!agentOpts) {
    const sessionsDir =
      config.memory?.sessionsDir ||
      path.join(process.cwd(), "storage", "agent-sessions");
    const memoryHolder: { instance?: any } = {};
    const sessionStore = createJsonlSessionStore({
      dir: sessionsDir,
      isActive: (id) => Boolean(memoryHolder.instance?.isActive(id)),
    });
    // Only a missing directory (fresh setup) is tolerated. A torn or corrupt session
    // log must stop the server from starting (plan AC 21); swallowing it here hid that.
    if (fs.existsSync(sessionsDir)) {
      await sessionStore.load();
    }

    const memoryInstance = createSessionMemory({
      store: sessionStore,
      limits: {
        shortTermMaxTurns: config.memory?.shortTermMaxTurns ?? 8,
        shortTermMaxTokens: config.memory?.shortTermMaxTokens ?? 512,
        historyMaxTokens: config.memory?.historyMaxTokens ?? 1500,
        maxObservationTokens: config.memory?.maxObservationTokens ?? 6000,
        maxSessions: config.memory?.maxSessions ?? 1000,
        sessionTtlS: config.memory?.sessionTtlS ?? 3600,
      },
    });
    memoryHolder.instance = memoryInstance;

    const tracer = createAgentTracer(config.langfuse);
    const runner = createLegalAgentRunner({
      config: config as any,
      // Resolved per call, so building the server never needs the legacy agent's retrieval.
      retrieval: {
        retrieve: async (query, mode, filters) => {
          agentEmbedding.failed = undefined;
          const ctx = await options.agent.getRetrieval().retrieve(query, mode, filters);
          if (agentEmbedding.failed !== undefined) {
            throw new EmbeddingFailure(agentEmbedding.failed);
          }
          return ctx;
        },
      },
      store: sessionStore,
      memory: memoryInstance,
      tracer,
    });
    setActiveAgentRunner(runner);

    agentOpts = {
      runner,
      store: sessionStore,
      memory: memoryInstance,
      memoryStats: async () => memoryInstance.stats(),
      tracer,
      probeLlm: () => runner.probe(),
    };
  }

  await fastify.register(agentRoutes, {
    prefix: "/api",
    ...agentOpts,
  });

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

      // 0. Validate IAM configuration
      assertIamConfig();

      // 0b. Agent and index guards (plan r5 §5.3, §5.6): refuse to start on any mismatch.
      assertGeminiOnlyAgentConfig(config);
      assertServerEmbeddingConfig(config);
      await assertIndexManifest(
        config.conGraphVectorDbPath,
        describeEmbedder(config),
      );

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
      const retrieval = createHybridRetrieval(
        storage,
        retrievalLlm,
        withEmbeddingFailureRecording(embedder),
      );

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
