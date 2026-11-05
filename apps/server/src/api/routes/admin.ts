// ============================================================================
// Admin Routes (Modular Entry Point)
// ============================================================================

import type { FastifyInstance } from "fastify";
import type { GraphClient } from "../../graph/client";
import type { IVectorStore } from "../../embeddings/vector-store-factory";
import type { LegalConsultationAgent } from "../../agent/setup";
import type { AdminRoutesOptions } from "./admin/types";
import { registerSystemRoutes } from "./admin/system.routes";
import { registerVectorRoutes } from "./admin/vector.routes";
import { registerGraphDataRoutes } from "./admin/graph-data.routes";
import { registerGraphRelationsRoutes } from "./admin/graph-relations.routes";
import { registerCommunityRoutes } from "./admin/community.routes";
import { registerConfigRoutes } from "./admin/config.routes";
import { registerKnowledgeRoutes } from "./admin/knowledge.routes";
import { registerLlmRoutes } from "./admin/llm.routes";

export type { AdminRoutesOptions };

export async function adminRoutes(
  fastify: FastifyInstance,
  options: {
    graph: GraphClient;
    vectorStore: IVectorStore;
    agent?: LegalConsultationAgent;
  },
) {
  registerSystemRoutes(fastify, options);
  registerVectorRoutes(fastify, options);
  registerGraphDataRoutes(fastify, options);
  registerGraphRelationsRoutes(fastify, options);
  registerCommunityRoutes(fastify, options);
  registerConfigRoutes(fastify, options);
  registerKnowledgeRoutes(fastify, options);
  registerLlmRoutes(fastify, options);
}
