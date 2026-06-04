import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ApiEmbedder,
  getEmbedder,
  resetEmbedder,
} from "../../../src/embeddings/embedder-api";
import { config } from "../../../src/shared/config";

// Mock config
vi.mock("../../../src/shared/config", () => ({
  config: {
    embeddingApiUrl: "http://test-api:8765",
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

describe("ApiEmbedder", () => {
  beforeEach(() => {
    // Mock fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    resetEmbedder();
    vi.clearAllMocks();
  });

  it("should initialize successfully when health check passes", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ status: "ok", model: "test-model", dimension: 384 }),
    });

    const embedder = new ApiEmbedder("http://test-api:8765");
    await embedder.initialize();
    expect(global.fetch).toHaveBeenCalledWith("http://test-api:8765/health");
    expect(embedder.isReady()).toBe(true);
  });

  it("should throw error when health check fails", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      statusText: "Service Unavailable",
    });

    const embedder = new ApiEmbedder("http://test-api:8765");
    await expect(embedder.initialize()).rejects.toThrow(
      "Cannot connect to embedding API",
    );
  });

  it("should generate embedding for single text", async () => {
    // Health check
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ dimension: 384 }),
    });
    // Embed call
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ embeddings: [[0.1, 0.2, 0.3]] }),
    });

    const embedder = new ApiEmbedder("http://test-api:8765");
    await embedder.initialize();
    const result = await embedder.embed("hello");

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://test-api:8765/embed",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ texts: ["hello"] }),
      }),
    );
  });

  it("should generate batch embeddings", async () => {
    // Health check
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ dimension: 384 }),
    });
    // Embed call
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ embeddings: [[0.1], [0.2]] }),
    });

    const embedder = new ApiEmbedder("http://test-api:8765");
    await embedder.initialize();
    const results = await embedder.embedBatch(["t1", "t2"]);

    expect(results).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://test-api:8765/embed",
      expect.objectContaining({
        body: JSON.stringify({ texts: ["t1", "t2"] }),
      }),
    );
  });

  it("should embed article", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ dimension: 384 }),
    });
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ embeddings: [[0.1]] }),
    });
    const embedder = new ApiEmbedder();
    await embedder.initialize();
    await embedder.embedArticle({ title: "T", content: "C" } as any);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/embed"),
      expect.objectContaining({
        body: JSON.stringify({ texts: ["T C"] }),
      }),
    );
  });

  it("should embed clause", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ dimension: 384 }),
    });
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ embeddings: [[0.1]] }),
    });
    const embedder = new ApiEmbedder();
    await embedder.initialize();
    await embedder.embedClause(
      { title: "T" } as any,
      { clause_number: 1, text: "C" } as any,
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/embed"),
      expect.objectContaining({
        body: JSON.stringify({ texts: ["T - Khoản 1: C"] }),
      }),
    );
  });

  it("should embed article clauses", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ dimension: 384 }),
    });
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ embeddings: [[0.1]] }),
    });
    const embedder = new ApiEmbedder();
    await embedder.initialize();
    await embedder.embedArticleClauses({
      title: "T",
      clauses: [{ clause_number: 1, text: "C" }],
    } as any);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/embed"),
      expect.objectContaining({
        body: JSON.stringify({ texts: ["T - Khoản 1: C"] }),
      }),
    );
  });

  it("should get dimension from API", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ dimension: 512 }),
    });

    const embedder = new ApiEmbedder("http://test-api:8765");
    const dim = await embedder.getDimension();
    expect(dim).toBe(512);
  });

  it("should handle API errors during embedding", async () => {
    // Health check
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ dimension: 384 }),
    });
    // Embed call fails
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      statusText: "Internal Server Error",
    });

    const embedder = new ApiEmbedder("http://test-api:8765");
    await embedder.initialize();
    await expect(embedder.embed("hello")).rejects.toThrow("API request failed");
  });

  it("should provide singleton instance", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ dimension: 384 }),
    });
    const e1 = await getEmbedder();
    const e2 = await getEmbedder();
    expect(e1).toBe(e2);
  });
});
