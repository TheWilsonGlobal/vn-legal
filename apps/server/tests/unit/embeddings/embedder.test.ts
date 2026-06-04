import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  Embedder,
  getEmbedder,
  resetEmbedder,
} from "../../../src/embeddings/embedder";
import { config } from "../../../src/shared/config";
import { pipeline } from "@xenova/transformers";

// Mock transformers
vi.mock("@xenova/transformers", () => ({
  pipeline: vi.fn(),
  env: {
    allowLocalModels: true,
    useBrowserCache: false,
    backends: {
      onnx: {
        executionTarget: "node",
      },
    },
  },
}));

// Mock config
vi.mock("../../../src/shared/config", () => ({
  config: {
    embeddingModel: "test-model",
    embeddingDimension: 384,
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

describe("Embedder (Transformers)", () => {
  let mockPipeline: any;

  beforeEach(() => {
    mockPipeline = vi.fn().mockResolvedValue({
      data: new Float32Array(new Array(384).fill(0.1)),
    });
    mockPipeline.dispose = vi.fn().mockResolvedValue(undefined);
    (pipeline as any).mockResolvedValue(mockPipeline);
  });

  afterEach(() => {
    resetEmbedder();
    vi.clearAllMocks();
  });

  it("should initialize successfully", async () => {
    const embedder = new Embedder();
    await embedder.initialize();
    expect(pipeline).toHaveBeenCalledWith(
      "feature-extraction",
      "test-model",
      expect.any(Object),
    );
    expect(embedder.isReady()).toBe(true);
  });

  it("should handle double initialization", async () => {
    const embedder = new Embedder();
    await embedder.initialize();
    await embedder.initialize();
    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it("should trigger progress callback during initialization", async () => {
    let callback: any;
    (pipeline as any).mockImplementation((_a, _b, options) => {
      callback = options.progress_callback;
      return Promise.resolve(mockPipeline);
    });
    const embedder = new Embedder();
    await embedder.initialize();

    callback({ status: "downloading", progress: 50 });
    callback({ status: "loading", progress: 100 });
    callback({ status: "other" });
  });

  it("should handle initialization failure", async () => {
    (pipeline as any).mockRejectedValueOnce(new Error("Init failed"));
    const embedder = new Embedder();
    await expect(embedder.initialize()).rejects.toThrow("Init failed");
  });

  it("should generate embedding for single text", async () => {
    const embedder = new Embedder();
    await embedder.initialize();
    const result = await embedder.embed("hello");
    expect(result).toHaveLength(384);
    expect(result[0]).toBeCloseTo(0.1);
    expect(mockPipeline).toHaveBeenCalledWith("hello", {
      pooling: "mean",
      normalize: true,
    });
  });

  it("should handle single embedding failure", async () => {
    const embedder = new Embedder();
    await embedder.initialize();
    mockPipeline.mockRejectedValueOnce(new Error("Embed failed"));
    await expect(embedder.embed("hello")).rejects.toThrow("Embed failed");
  });

  it("should throw error if embedding without initialization", async () => {
    const embedder = new Embedder();
    await expect(embedder.embed("hello")).rejects.toThrow(
      "Embedder not initialized",
    );
  });

  it("should throw error if batch embedding without initialization", async () => {
    const embedder = new Embedder();
    await expect(embedder.embedBatch(["hello"])).rejects.toThrow(
      "Embedder not initialized",
    );
  });

  it("should generate batch embeddings", async () => {
    const embedder = new Embedder();
    await embedder.initialize();

    // For batch, mockPipeline returns a flat array for all texts
    mockPipeline.mockResolvedValueOnce({
      data: new Float32Array(new Array(384 * 2).fill(0.2)),
    });

    const results = await embedder.embedBatch(["text1", "text2"]);
    expect(results).toHaveLength(2);
    expect(results[0]).toHaveLength(384);
    expect(results[1]).toHaveLength(384);
    expect(results[0][0]).toBeCloseTo(0.2);
  });

  it("should handle batch embedding failure", async () => {
    const embedder = new Embedder();
    await embedder.initialize();
    mockPipeline.mockRejectedValueOnce(new Error("Batch failed"));
    await expect(embedder.embedBatch(["t1"])).rejects.toThrow("Batch failed");
  });

  it("should return empty array for empty batch", async () => {
    const embedder = new Embedder();
    await embedder.initialize();
    const results = await embedder.embedBatch([]);
    expect(results).toEqual([]);
  });

  it("should embed article", async () => {
    const embedder = new Embedder();
    await embedder.initialize();
    const article = { title: "Title", content: "Content" } as any;
    await embedder.embedArticle(article);
    expect(mockPipeline).toHaveBeenCalledWith(
      "Title Content",
      expect.any(Object),
    );
  });

  it("should embed clause", async () => {
    const embedder = new Embedder();
    await embedder.initialize();
    const article = { title: "Title" } as any;
    const clause = { clause_number: 1, text: "Clause text" } as any;
    await embedder.embedClause(article, clause);
    expect(mockPipeline).toHaveBeenCalledWith(
      "Title - Khoản 1: Clause text",
      expect.any(Object),
    );
  });

  it("should embed article clauses", async () => {
    const embedder = new Embedder();
    await embedder.initialize();
    const article = {
      title: "Title",
      clauses: [
        { clause_number: 1, text: "C1" },
        { clause_number: 2, text: "C2" },
      ],
    } as any;

    mockPipeline.mockResolvedValueOnce({
      data: new Float32Array(new Array(384 * 2).fill(0.3)),
    });

    const results = await embedder.embedArticleClauses(article);
    expect(results).toHaveLength(2);
    expect(mockPipeline).toHaveBeenCalledWith(
      ["Title - Khoản 1: C1", "Title - Khoản 2: C2"],
      expect.any(Object),
    );
  });

  it("should dispose resources", async () => {
    const embedder = new Embedder();
    await embedder.initialize();
    await embedder.dispose();
    expect(mockPipeline.dispose).toHaveBeenCalled();
    expect(embedder.isReady()).toBe(false);
  });

  it("should provide singleton instance", async () => {
    const e1 = await getEmbedder();
    const e2 = await getEmbedder();
    expect(e1).toBe(e2);
  });
});
