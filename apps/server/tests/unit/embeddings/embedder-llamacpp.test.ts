import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LlamaCppEmbedder } from "../../../src/embeddings/embedder-llamacpp";
import { config } from "../../../src/shared/config";

// Mock config
vi.mock("../../../src/shared/config", () => ({
  config: {
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

describe("LlamaCppEmbedder", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize successfully", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true });
    const embedder = new LlamaCppEmbedder("http://llama:3018");
    await embedder.initialize();
    expect(embedder.isReady()).toBe(true);
  });

  it("should truncate long text", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true }); // health
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ embedding: new Array(384).fill(0.1) }),
    });

    const embedder = new LlamaCppEmbedder();
    await embedder.initialize();

    const longText = "a".repeat(3000);
    await embedder.embed(longText);

    const fetchCall = (global.fetch as any).mock.calls[1];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.content.length).toBe(2000);
  });

  describe("Response Parsing", () => {
    let embedder: LlamaCppEmbedder;

    beforeEach(async () => {
      embedder = new LlamaCppEmbedder();
      (global.fetch as any).mockResolvedValueOnce({ ok: true });
      await embedder.initialize();
    });

    it("should parse { embedding: [...] }", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ embedding: [1, 2, 3] }),
      });
      const result = await embedder.embed("test");
      expect(result).toHaveLength(3);
    });

    it("should parse { embedding: [[...]] }", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ embedding: [[1, 2, 3]] }),
      });
      const result = await embedder.embed("test");
      expect(result).toHaveLength(3);
    });

    it("should parse [{ embedding: [...] }]", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ embedding: [1, 2, 3] }]),
      });
      const result = await embedder.embed("test");
      expect(result).toHaveLength(3);
    });

    it("should parse { results: [{ embedding: [...] }] }", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ results: [{ embedding: [1, 2, 3] }] }),
      });
      const result = await embedder.embed("test");
      expect(result).toHaveLength(3);
    });

    it("should parse flat array [1, 2, 3]", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([1, 2, 3]),
      });
      const result = await embedder.embed("test");
      expect(result).toHaveLength(3);
    });

    it("should handle malformed response", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ something: "else" }),
      });
      await expect(embedder.embed("test")).rejects.toThrow(
        "Invalid embedding response",
      );
    });

    it("should handle non-array response in validateVector", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ embedding: "not an array" }),
      });
      // In this case, Array.isArray(d.embedding) is false, so it throws Llama.cpp error
      await expect(embedder.embed("test")).rejects.toThrow(
        "Invalid embedding response from Llama.cpp",
      );
    });

    it("should handle non-numeric array in validateVector", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ embedding: ["a", "b"] }),
      });
      const result = await embedder.embed("test");
      expect(result).toEqual([0, 0]);
    });
  });

  it("should validate and normalize vectors", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true });
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ embedding: [3, 4] }), // norm is 5
    });

    const embedder = new LlamaCppEmbedder();
    await embedder.initialize();
    const result = await embedder.embed("test");

    expect(result[0]).toBeCloseTo(3 / 5);
    expect(result[1]).toBeCloseTo(4 / 5);
  });

  it("should handle invalid numbers in vector", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true });
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ embedding: [1, NaN, Infinity, { value: 2 }, "3"] }),
    });

    const embedder = new LlamaCppEmbedder();
    await embedder.initialize();
    const result = await embedder.embed("test");

    // NaN and Infinity become 0
    // { value: 2 } becomes 2
    // '3' becomes 3
    // [1, 0, 0, 2, 3] -> norm is sqrt(1+4+9) = sqrt(14)
    expect(result).toHaveLength(5);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
  });

  it("should process batch with concurrency limit", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true }); // health
    // Mock 12 calls (more than concurrency limit of 10)
    for (let i = 0; i < 12; i++) {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ embedding: [0.1] }),
      });
    }

    const embedder = new LlamaCppEmbedder();
    await embedder.initialize();
    const texts = new Array(12).fill("test");
    const results = await embedder.embedBatch(texts);

    expect(results).toHaveLength(12);
    expect(global.fetch).toHaveBeenCalledTimes(13); // 1 health + 12 embed
  });

  it("should dispose", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true });
    const embedder = new LlamaCppEmbedder();
    await embedder.initialize();
    await embedder.dispose();
    expect(embedder.isReady()).toBe(false);
  });

  it("should get dimension", async () => {
    const embedder = new LlamaCppEmbedder();
    const dim = await embedder.getDimension();
    expect(dim).toBe(384);
  });
});
