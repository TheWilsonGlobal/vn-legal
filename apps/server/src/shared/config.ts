// ============================================================================
// Application Configuration
// ============================================================================

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";

// Load .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try to load .env from project root (up from apps/server/src/shared/)
dotenvConfig({ path: join(__dirname, "../../../.env") });
// Also try current working directory as a fallback
dotenvConfig();

// ----------------------------------------------------------------------------
// Env helpers. Nothing here throws at import: a set-but-unusable value is
// recorded in `configIssues` (variable name only, never the value), and the
// value is returned as NaN or false so that it cannot be used silently. The
// server boot must refuse to start while `configIssues` is non-empty.
// ----------------------------------------------------------------------------

export const configIssues: string[] = [];

/** Trimmed value, or undefined when the variable is unset or blank. */
function env(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

function intEnv(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    configIssues.push(`${name} must be a non-negative integer`);
    return NaN;
  }
  return Number(raw);
}

function unitIntervalEnv(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!/^\d*\.?\d+$/.test(raw) || n < 0 || n > 1) {
    configIssues.push(`${name} must be a number between 0 and 1`);
    return NaN;
  }
  return n;
}

function boolEnv(name: string): boolean {
  const raw = env(name);
  if (raw === undefined) return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  configIssues.push(`${name} must be "true" or "false"`);
  return false;
}

function captureEnv(): "full" | "masked" | "metadata_only" {
  const raw = env("LANGFUSE_CAPTURE");
  if (raw === undefined) return "metadata_only";
  if (raw === "full" || raw === "masked" || raw === "metadata_only") return raw;
  configIssues.push(
    'LANGFUSE_CAPTURE must be "full", "masked" or "metadata_only"',
  );
  return "metadata_only";
}

const EMBEDDING_PROVIDER = env("EMBEDDING_PROVIDER");
const EMBEDDING_DIM = intEnv("EMBEDDING_DIM", 768);

export const config = {
  // Database paths
  graphDbPath: join(process.cwd(), "storage", "graph.cgraph"),
  vectorDbPath: join(process.cwd(), "storage", "vectors.lance"),
  // Env-driven (CONGRAPH_VECTOR_DB_PATH). Unset keeps the legacy store path.
  conGraphVectorDbPath: resolve(
    process.cwd(),
    env("CONGRAPH_VECTOR_DB_PATH") ??
      join("storage", "congraph_vectors.cgraph"),
  ),

  // Vector store type: "lancedb" or "congraph"
  vectorStoreType: (process.env.VECTOR_STORE_TYPE === "congraphdb"
    ? "congraph"
    : process.env.VECTOR_STORE_TYPE || "congraph") as "lancedb" | "congraph",

  // Client graph display mode
  clientGraphMode: "query" as "query" | "explorer",

  // Data source (DATA_SOURCE_PATH). Default is the real corpus file.
  dataSourcePath: resolve(
    process.cwd(),
    env("DATA_SOURCE_PATH") ?? join("data", "Docs", "Vietnam Civil Law.json"),
  ),

  // Embedding model (legacy transformers embedder)
  embeddingModel: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  // 768 for the Gemini index (EMBEDDING_DIM); the legacy 384-d store otherwise.
  embeddingDimension: EMBEDDING_PROVIDER === "gemini" ? EMBEDDING_DIM : 384,

  // Embedding backend: "transformers" (WebAssembly), "api" (Python ONNX), or "llamacpp" (GGUF)
  // Legacy: read only by the old-index comparison (ER1) and the legacy embedder path.
  embeddingBackend: (process.env.EMBEDDING_BACKEND || "transformers") as
    | "transformers"
    | "api"
    | "llamacpp",
  embeddingApiUrl: process.env.EMBEDDING_API_URL || "http://127.0.0.1:8765",

  // Embeddings served by Gemini (agent path). Keys are read here only.
  embedding: {
    provider: EMBEDDING_PROVIDER, // EMBEDDING_PROVIDER: no default, undefined when unset
    model: env("EMBEDDING_MODEL"), // EMBEDDING_MODEL: no default
    dim: EMBEDDING_DIM,
    batchSize: intEnv("EMBED_BATCH_SIZE", 50),
    maxConcurrency: intEnv("EMBED_MAX_CONCURRENCY", 2),
    maxTokensBudget: intEnv("EMBED_MAX_TOKENS_BUDGET", 2000000),
    apiKey: env("GEMINI_EMBEDDING_API_KEY"),
    // Optional extra keys, tried in order only when a key is over quota (see key-rotation.ts).
    fallbackApiKeys: [env("GEMINI_EMBEDDING_API_KEY_2"), env("GEMINI_EMBEDDING_API_KEY_3")]
      .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
      .filter((k, i, all) => all.indexOf(k) === i),
  },

  // Retrieval parameters
  retrieval: {
    topKSeedArticles: 3,
    pathTraversalDepth: 2,
    maxConcepts: 10,
    useLlmForRetrieval: process.env.USE_LLM_FOR_RETRIEVAL !== "false",
  },

  // LLM configuration (legacy /api/consult path, unchanged)
  llm: {
    provider: (process.env.LLM_PROVIDER || "anthropic") as
      | "anthropic"
      | "llama"
      | "openai"
      | "gemini"
      | "template",
    model:
      process.env.GEMINI_MODEL_NAME ||
      process.env.LLM_MODEL ||
      (process.env.LLM_PROVIDER === "gemini"
        ? "gemini-3.5-flash-lite"
        : "claude-3-haiku-20240307"),
    temperature: 0.3,
    maxTokens: 2000,
    apiKey:
      process.env.GEMINI_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.LLM_API_KEY ||
      "",
    // Default endpoint from LLM_API_URL; may be overridden at runtime via
    // PUT /api/admin/llm/endpoint. Keep this fallback in sync with .env.example.
    apiUrl:
      process.env.LLM_API_URL ||
      (process.env.LLM_PROVIDER === "gemini"
        ? "https://generativelanguage.googleapis.com/v1beta/openai"
        : "http://localhost:5814"),
  },

  // Gemini chat settings for the agent (LangGraph path, §5.3). config.ts does
  // not validate the provider; the agent runner factory does.
  gemini: {
    apiKey: env("GEMINI_API_KEY"), // undefined when unset; never defaulted
    model: env("GEMINI_MODEL_NAME"), // undefined when unset; never defaulted
    baseUrl:
      env("GEMINI_OPENAI_BASE_URL") ??
      "https://generativelanguage.googleapis.com/v1beta/openai/",
    maxRetries: intEnv("GEMINI_MAX_RETRIES", 2),
    maxConcurrency: intEnv("GEMINI_MAX_CONCURRENCY", 4),
    temperature: 0.3,
    maxTokens: 2000,
  },

  // Agent loop
  agent: {
    maxSteps: intEnv("AGENT_MAX_STEPS", 4),
  },

  // Working memory, history and session store (§5.5)
  memory: {
    shortTermMaxTurns: intEnv("SHORT_TERM_MAX_TURNS", 8),
    shortTermMaxTokens: intEnv("SHORT_TERM_MAX_TOKENS", 512),
    historyMaxTokens: intEnv("HISTORY_MAX_TOKENS", 1500),
    maxObservationTokens: intEnv("MAX_OBSERVATION_TOKENS", 6000),
    maxSessions: intEnv("MAX_SESSIONS", 1000),
    sessionTtlS: intEnv("SESSION_TTL_S", 3600),
    sessionsDir: resolve(
      process.cwd(),
      env("AGENT_SESSIONS_DIR") ?? join("storage", "agent-sessions"),
    ),
  },

  // Langfuse Cloud observability (§5.8). Keys are read here only.
  langfuse: {
    enabled: boolEnv("LANGFUSE_ENABLED"),
    publicKey: env("LANGFUSE_PUBLIC_KEY"), // undefined when unset
    secretKey: env("LANGFUSE_SECRET_KEY"), // undefined when unset
    baseUrl: env("LANGFUSE_BASE_URL") ?? "https://cloud.langfuse.com",
    capture: captureEnv(),
    projectId: env("LANGFUSE_PROJECT_ID"), // not secret; builds trace_url only
    sampleRate: unitIntervalEnv("LANGFUSE_SAMPLE_RATE", 1),
    environment: env("LANGFUSE_ENVIRONMENT"),
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

  // Identity & Access Management (iam-platform + Supabase Auth)
  iam: {
    iamUrl: env("IAM_URL") || "https://iam-api-cdnd.onrender.com",
    iamClientId: env("IAM_CLIENT_ID") || "",
    iamClientSecret: env("IAM_CLIENT_SECRET") || "",
    iamRepoCode: "vn-legal",
    supabaseUrl: (env("SUPABASE_URL") || "").replace(/\/+$/, ""),
    supabaseAnonKey: env("SUPABASE_ANON_KEY") || "",
    // REQUIRE_LOGIN defaults to true, overridable via env REQUIRE_LOGIN (e.g. false in development)
    requireLogin: env("REQUIRE_LOGIN") !== undefined ? boolEnv("REQUIRE_LOGIN") : true,
  },
};

/**
 * Fails fast when identity is not configured and requireLogin is active.
 */
export function assertIamConfig(): void {
  if (!config.iam.requireLogin) return;
  const problems: string[] = [];
  if (!config.iam.iamClientId || !config.iam.iamClientSecret) {
    problems.push(
      "IAM_CLIENT_ID and IAM_CLIENT_SECRET are required (pnpm register-repo in iam-platform writes them)",
    );
  }
  if (!config.iam.supabaseUrl || !config.iam.supabaseAnonKey) {
    problems.push("SUPABASE_URL and SUPABASE_ANON_KEY are required");
  }
  if (problems.length > 0) {
    throw new Error(
      [
        `Refusing to start (REQUIRE_LOGIN=true):`,
        ...problems.map((p) => `  - ${p}`),
      ].join("\n"),
    );
  }
}

// Type exports
export type Config = typeof config;
