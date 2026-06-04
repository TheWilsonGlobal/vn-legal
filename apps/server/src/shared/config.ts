// ============================================================================
// Application Configuration
// ============================================================================

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config as dotenvConfig } from "dotenv";

// Load .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try to load .env from project root (up from apps/server/src/shared/)
dotenvConfig({ path: join(__dirname, "../../../.env") });
// Also try current working directory as a fallback
dotenvConfig();

export const config = {
  // Database paths
  graphDbPath: join(process.cwd(), "storage", "graph.cgraph"),
  vectorDbPath: join(process.cwd(), "storage", "vectors.lance"),
  conGraphVectorDbPath: join(
    process.cwd(),
    "storage",
    "congraph_vectors.cgraph",
  ),

  // Vector store type: "lancedb" or "congraph"
  vectorStoreType: (process.env.VECTOR_STORE_TYPE === "congraphdb"
    ? "congraph"
    : process.env.VECTOR_STORE_TYPE || "congraph") as "lancedb" | "congraph",

  // Client graph display mode
  clientGraphMode: "query" as "query" | "explorer",

  // Data source
  dataSourcePath: join(process.cwd(), "data", "vietnam_civil_law.json"),

  // Embedding model
  embeddingModel: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  embeddingDimension: 384,

  // Embedding backend: "transformers" (WebAssembly), "api" (Python ONNX), or "llamacpp" (GGUF)
  embeddingBackend: (process.env.EMBEDDING_BACKEND || "transformers") as
    | "transformers"
    | "api"
    | "llamacpp",
  embeddingApiUrl: process.env.EMBEDDING_API_URL || "http://127.0.0.1:8765",

  // Retrieval parameters
  retrieval: {
    topKSeedArticles: 3,
    pathTraversalDepth: 2,
    maxConcepts: 10,
    useLlmForRetrieval: process.env.USE_LLM_FOR_RETRIEVAL !== "false",
  },

  // LLM configuration
  llm: {
    provider: (process.env.LLM_PROVIDER || "anthropic") as
      | "anthropic"
      | "llama"
      | "openai"
      | "template",
    model: process.env.LLM_MODEL || "claude-3-haiku-20240307",
    temperature: 0.3,
    maxTokens: 2000,
    apiKey: process.env.ANTHROPIC_API_KEY || process.env.LLM_API_KEY || "",
    apiUrl: process.env.LLM_API_URL || "http://localhost:8080",
  },

  // API configuration
  api: {
    port: parseInt(process.env.PORT || "3000", 10),
    host: process.env.HOST || "127.0.0.1",
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || "info",
  },

  // Processing
  processing: {
    batchSize: 50,
    maxConcurrentEmbeddings: 5,
  },
};

// Type exports
export type Config = typeof config;
