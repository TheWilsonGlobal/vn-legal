import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getEmbedder,
  getEmbedderType,
  resetEmbedder,
} from "../../../src/embeddings/embedder-factory";
import { config } from "../../../src/shared/config";
import { GeminiEmbedder } from "../../../src/embeddings/embedder-gemini";
import { ApiEmbedder } from "../../../src/embeddings/embedder-api";
import { Embedder } from "../../../src/embeddings/embedder";

// Mock config
vi.mock("../../../src/shared/config", () => ({
  config: {
    embeddingBackend: "transformers",
    embeddingApiUrl: "http://localhost:8765",
    embedding: {
      provider: undefined,
      model: "gemini-embedding-2",
      dim: 768,
      batchSize: 50,
      maxConcurrency: 2,
      apiKey: undefined,
    },
  },
}));

// No network: the Gemini embedder is replaced by a stub class.
vi.mock("../../../src/embeddings/embedder-gemini.js", () => ({
  GeminiEmbedder: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  })),
}));

vi.mock("../../../src/shared/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the modules that are dynamically imported
vi.mock("../../../src/embeddings/embedder-api.js", () => ({
  ApiEmbedder: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  })),
}));

vi.mock("../../../src/embeddings/embedder-llamacpp.js", () => ({
  LlamaCppEmbedder: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  })),
}));

vi.mock("../../../src/embeddings/embedder.js", () => ({
  Embedder: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  })),
}));

describe("Embedder Factory", () => {
  beforeEach(() => {
    resetEmbedder();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetEmbedder();
  });

  describe("getEmbedder", () => {
    it("should create and return ApiEmbedder when backend is api", async () => {
      (config as any).embeddingBackend = "api";
      const embedder = await getEmbedder();
      expect(embedder).toBeDefined();

      // Singleton check
      const embedder2 = await getEmbedder();
      expect(embedder2).toBe(embedder);
    });

    it("should create and return LlamaCppEmbedder when backend is llamacpp", async () => {
      (config as any).embeddingBackend = "llamacpp";
      const embedder = await getEmbedder();
      expect(embedder).toBeDefined();
    });

    it("should create and return default Embedder for other backends", async () => {
      (config as any).embeddingBackend = "transformers";
      const embedder = await getEmbedder();
      expect(embedder).toBeDefined();
    });
  });

  describe("getEmbedderType", () => {
    const originalEmbedding = (config as any).embedding;
    afterEach(() => {
      (config as any).embedding = originalEmbedding;
    });

    it("should return configured embedding backend", () => {
      (config as any).embeddingBackend = "transformers";
      const type = getEmbedderType();
      expect(type).toBe("transformers");
    });

    it("reports the provider under EMBEDDING_PROVIDER=gemini, not the legacy backend (R10-07)", () => {
      (config as any).embedding = { provider: "gemini" };
      (config as any).embeddingBackend = "transformers";

      expect(getEmbedderType()).toBe("gemini");
    });

    it("reports the legacy backend only when EMBEDDING_PROVIDER is unset", () => {
      (config as any).embedding = { provider: undefined };
      (config as any).embeddingBackend = "api";

      expect(getEmbedderType()).toBe("api");
    });
  });

  describe("resetEmbedder", () => {
    it("should dispose and clear instance", async () => {
      (config as any).embeddingBackend = "api";
      const embedder = await getEmbedder();
      const disposeSpy = vi.spyOn(embedder, "dispose");

      resetEmbedder();
      expect(disposeSpy).toHaveBeenCalled();

      // Should create new instance next time
      const embedder2 = await getEmbedder();
      expect(embedder2).not.toBe(embedder);
    });
  });
});

describe("EMBEDDING_PROVIDER selection", () => {
  const baseEmbedding = {
    provider: undefined as string | undefined,
    model: "gemini-embedding-2" as string | undefined,
    dim: 768,
    batchSize: 50,
    maxConcurrency: 2,
    apiKey: undefined as string | undefined,
  };

  beforeEach(() => {
    resetEmbedder();
    vi.clearAllMocks();
    (config as any).embedding = { ...baseEmbedding };
    (config as any).embeddingBackend = "transformers";
  });

  afterEach(() => {
    resetEmbedder();
  });

  it("gemini selects GeminiEmbedder with the configured model, dim and key", async () => {
    (config as any).embedding = {
      ...baseEmbedding,
      provider: "gemini",
      apiKey: "test-key-not-real",
    };
    (config as any).embeddingBackend = "api"; // ignored once the provider is set

    const embedder = await getEmbedder();

    expect(GeminiEmbedder).toHaveBeenCalledTimes(1);
    expect(vi.mocked(GeminiEmbedder).mock.calls[0][0]).toEqual({
      apiKey: "test-key-not-real",
      model: "gemini-embedding-2",
      dim: 768,
      batchSize: 50,
      maxConcurrency: 2,
    });
    expect(ApiEmbedder).not.toHaveBeenCalled();
    expect(Embedder).not.toHaveBeenCalled();
    expect(embedder.initialize).toHaveBeenCalled();
  });

  it("gemini with an empty key throws naming GEMINI_EMBEDDING_API_KEY and builds nothing", async () => {
    (config as any).embedding = {
      ...baseEmbedding,
      provider: "gemini",
      apiKey: undefined,
    };

    await expect(getEmbedder()).rejects.toThrow("GEMINI_EMBEDDING_API_KEY");
    expect(GeminiEmbedder).not.toHaveBeenCalled();
  });

  it("gemini with no model throws naming EMBEDDING_MODEL", async () => {
    (config as any).embedding = {
      ...baseEmbedding,
      provider: "gemini",
      model: undefined,
      apiKey: "test-key-not-real",
    };

    await expect(getEmbedder()).rejects.toThrow("EMBEDDING_MODEL");
    expect(GeminiEmbedder).not.toHaveBeenCalled();
  });

  it("transformers selects the transformers Embedder (documented rollback)", async () => {
    (config as any).embedding = { ...baseEmbedding, provider: "transformers" };
    (config as any).embeddingBackend = "api"; // ignored once the provider is set

    await getEmbedder();

    expect(Embedder).toHaveBeenCalledTimes(1);
    expect(ApiEmbedder).not.toHaveBeenCalled();
    expect(GeminiEmbedder).not.toHaveBeenCalled();
  });

  it("an unset provider keeps the EMBEDDING_BACKEND switch", async () => {
    (config as any).embedding = { ...baseEmbedding, provider: undefined };
    (config as any).embeddingBackend = "api";

    await getEmbedder();

    expect(ApiEmbedder).toHaveBeenCalledTimes(1);
    expect(GeminiEmbedder).not.toHaveBeenCalled();
  });

  it("an unsupported provider throws naming EMBEDDING_PROVIDER and builds nothing", async () => {
    (config as any).embedding = { ...baseEmbedding, provider: "openai" };

    await expect(getEmbedder()).rejects.toThrow("EMBEDDING_PROVIDER");
    expect(GeminiEmbedder).not.toHaveBeenCalled();
    expect(Embedder).not.toHaveBeenCalled();
    expect(ApiEmbedder).not.toHaveBeenCalled();
  });
});
