/**
 * Setup file for unit tests
 * Note: congraphdb mocking is done per-test-file to avoid interference with integration tests
 */

import { vi } from "vitest";

// Mock config
//
// The `llm` block is not optional padding: routes/admin.ts reads
// `config.llm.apiUrl` at MODULE scope, so a mock missing it throws during
// import and fails the whole suite with "Cannot read properties of undefined"
// rather than a single assertion. Anything read at import time has to exist
// here, even when the test under it never touches the LLM.
//
// Every block below mirrors shared/config.ts (the Gemini, embedding, memory
// and Langfuse settings added for the agent). Keys are `undefined` here: no
// test may see a secret, and the live-call guard below keeps any SDK from
// reaching the network with one.
vi.mock("../src/shared/config", () => ({
  config: {
    graphDbPath: "/test/db/path",
    vectorDbPath: "/test/vectors",
    conGraphVectorDbPath: "/test/congraph_vectors.cgraph",
    dataSourcePath: "/test/data/Vietnam Civil Law.json",
    // Mirrors shared/config.ts. The embedder reads these; without them the
    // transformers pipeline is called with no model name and fails to load.
    embeddingModel: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    embeddingDimension: 384,
    embeddingBackend: "transformers",
    embeddingApiUrl: "http://127.0.0.1:8765",
    embedding: {
      provider: undefined,
      model: undefined,
      dim: 768,
      batchSize: 50,
      maxConcurrency: 2,
      maxTokensBudget: 2000000,
      apiKey: undefined,
    },
    api: {
      port: 3000,
      host: "127.0.0.1",
    },
    logging: {
      level: "info",
    },
    llm: {
      provider: "template",
      model: "test-model",
      temperature: 0.3,
      maxTokens: 2000,
      apiKey: "",
      apiUrl: "http://127.0.0.1:5814",
    },
    gemini: {
      apiKey: undefined,
      model: undefined,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      maxRetries: 2,
      maxConcurrency: 4,
      temperature: 0.3,
      maxTokens: 2000,
    },
    agent: {
      maxSteps: 4,
    },
    memory: {
      shortTermMaxTurns: 8,
      shortTermMaxTokens: 512,
      historyMaxTokens: 1500,
      maxObservationTokens: 6000,
      maxSessions: 1000,
      sessionTtlS: 3600,
      sessionsDir: "/test/agent-sessions",
    },
    langfuse: {
      enabled: false,
      publicKey: undefined,
      secretKey: undefined,
      baseUrl: "https://cloud.langfuse.com",
      capture: "metadata_only",
      projectId: undefined,
      sampleRate: 1,
      environment: undefined,
    },
  },
  configIssues: [],
}));

// Live-call guard (plan §9.2, assumption A33).
//
// Unit tests must never reach Google's Gemini API or Langfuse. Keys can still
// arrive from the shell environment, and the SDKs read some variables on their
// own (ChatOpenAI reads OPENAI_API_KEY, @google/genai reads GOOGLE_API_KEY and
// GEMINI_API_KEY, the Langfuse SDK reads LANGFUSE_*). So the keys are removed
// here, Langfuse is switched off, and global fetch refuses the two hosts.
// setup-guard.test.ts proves that both SDKs reach this wrapper.
for (const name of [
  "GEMINI_API_KEY",
  "GEMINI_EMBEDDING_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "LANGFUSE_SECRET_KEY",
  "LANGFUSE_PUBLIC_KEY",
]) {
  delete process.env[name];
}
process.env.LANGFUSE_ENABLED = "false";

const isBlockedHost = (host: string): boolean =>
  host === "generativelanguage.googleapis.com" ||
  host === "langfuse.com" ||
  host.endsWith(".langfuse.com");

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const href =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const host = new URL(href).hostname;
  if (isBlockedHost(host)) {
    throw new Error(`live network call in a unit test: ${host}`);
  }
  return realFetch(input, init);
}) as typeof fetch;

// Mock logger - but not for logger.test.ts which tests the real logger
const loggerMock = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../src/shared/logger", () => ({
  logger: loggerMock,
  default: loggerMock,
}));
