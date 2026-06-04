import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getEmbedder,
  getEmbedderType,
  resetEmbedder,
} from "../../../src/embeddings/embedder-factory";
import { config } from "../../../src/shared/config";

// Mock config
vi.mock("../../../src/shared/config", () => ({
  config: {
    embeddingBackend: "transformers",
    embeddingApiUrl: "http://localhost:8765",
  },
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
    it("should return configured embedding backend", () => {
      (config as any).embeddingBackend = "transformers";
      const type = getEmbedderType();
      expect(type).toBe("transformers");
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
