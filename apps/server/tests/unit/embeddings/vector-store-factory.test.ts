import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createVectorStore } from "../../../src/embeddings/vector-store-factory";
import { config } from "../../../src/shared/config";
import * as lancedbModule from "../../../src/embeddings/lancedb";
import * as congraphModule from "../../../src/embeddings/congraph";

// Mock the store implementations
vi.mock("../../../src/embeddings/lancedb", () => ({
  createVectorStore: vi.fn().mockResolvedValue({
    initialize: vi.fn().mockResolvedValue(undefined),
    addArticles: vi.fn(),
    searchArticles: vi.fn().mockResolvedValue([]),
    isReady: vi.fn().mockReturnValue(true),
    close: vi.fn(),
  }),
}));

vi.mock("../../../src/embeddings/congraph", () => ({
  createConGraphVectorStore: vi.fn().mockResolvedValue({
    initialize: vi.fn().mockResolvedValue(undefined),
    addArticles: vi.fn(),
    searchArticles: vi.fn().mockResolvedValue([]),
    isReady: vi.fn().mockReturnValue(true),
    close: vi.fn(),
  }),
}));

vi.mock("../../../src/shared/config", () => ({
  config: {
    vectorStoreType: "lancedb",
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

describe("VectorStore Factory", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should create LanceDB vector store", async () => {
    const store = await createVectorStore("lancedb");
    expect(store.getType()).toBe("lancedb");
    expect(lancedbModule.createVectorStore).toHaveBeenCalled();
  });

  it("should create ConGraphDB vector store", async () => {
    const store = await createVectorStore("congraph");
    expect(store.getType()).toBe("congraph");
    expect(congraphModule.createConGraphVectorStore).toHaveBeenCalled();
  });

  it("should use default type from config", async () => {
    (config as any).vectorStoreType = "lancedb";
    const store = await createVectorStore();
    expect(store.getType()).toBe("lancedb");
  });

  it("should throw error for unknown type", async () => {
    await expect(createVectorStore("unknown")).rejects.toThrow(
      "Unknown vector store type",
    );
  });

  describe("LanceDBAdapter delegation", () => {
    it("should delegate searchArticlesBatch to store", async () => {
      const store = await createVectorStore("lancedb");
      const mockStore = await (lancedbModule.createVectorStore as any).mock
        .results[0].value;
      await store.searchArticlesBatch([[0.1]], 5);
      expect(mockStore.searchArticles).toHaveBeenCalled();
    });

    it("should delegate addClauses to store", async () => {
      const store = await createVectorStore("lancedb");
      const mockStore = await (lancedbModule.createVectorStore as any).mock
        .results[0].value;
      mockStore.addClauses = vi.fn();
      await store.addClauses([]);
      expect(mockStore.addClauses).toHaveBeenCalled();
    });

    it("should delegate addCommunityReports to store", async () => {
      const store = await createVectorStore("lancedb");
      const mockStore = await (lancedbModule.createVectorStore as any).mock
        .results[0].value;
      mockStore.addCommunityReports = vi.fn();
      await store.addCommunityReports([]);
      expect(mockStore.addCommunityReports).toHaveBeenCalled();
    });

    it("should delegate searchClauses to store", async () => {
      const store = await createVectorStore("lancedb");
      const mockStore = await (lancedbModule.createVectorStore as any).mock
        .results[0].value;
      mockStore.searchClauses = vi.fn().mockResolvedValue([]);
      await store.searchClauses([0.1], 5);
      expect(mockStore.searchClauses).toHaveBeenCalled();
    });

    it("should delegate searchCommunityReports to store", async () => {
      const store = await createVectorStore("lancedb");
      const mockStore = await (lancedbModule.createVectorStore as any).mock
        .results[0].value;
      mockStore.searchCommunityReports = vi.fn().mockResolvedValue([]);
      await store.searchCommunityReports([0.1], 3);
      expect(mockStore.searchCommunityReports).toHaveBeenCalled();
    });

    it("should delegate getArticle to store", async () => {
      const store = await createVectorStore("lancedb");
      const mockStore = await (lancedbModule.createVectorStore as any).mock
        .results[0].value;
      mockStore.getArticle = vi.fn().mockResolvedValue(null);
      await store.getArticle("1");
      expect(mockStore.getArticle).toHaveBeenCalled();
    });

    it("should delegate getClause to store", async () => {
      const store = await createVectorStore("lancedb");
      const mockStore = await (lancedbModule.createVectorStore as any).mock
        .results[0].value;
      mockStore.getClause = vi.fn().mockResolvedValue(null);
      await store.getClause("1");
      expect(mockStore.getClause).toHaveBeenCalled();
    });

    it("should delegate getStats to store", async () => {
      const store = await createVectorStore("lancedb");
      const mockStore = await (lancedbModule.createVectorStore as any).mock
        .results[0].value;
      mockStore.getStats = vi
        .fn()
        .mockResolvedValue({ articleCount: 0, clauseCount: 0 });
      await store.getStats();
      expect(mockStore.getStats).toHaveBeenCalled();
    });

    it("should delegate getCommunityReportCount to store", async () => {
      const store = await createVectorStore("lancedb");
      const mockStore = await (lancedbModule.createVectorStore as any).mock
        .results[0].value;
      mockStore.getCommunityReportCount = vi.fn().mockResolvedValue(0);
      await store.getCommunityReportCount();
      expect(mockStore.getCommunityReportCount).toHaveBeenCalled();
    });

    it("should delegate clearAll to store", async () => {
      const store = await createVectorStore("lancedb");
      const mockStore = await (lancedbModule.createVectorStore as any).mock
        .results[0].value;
      mockStore.clearAll = vi.fn();
      await store.clearAll();
      expect(mockStore.clearAll).toHaveBeenCalled();
    });

    it("should check isReady", async () => {
      const store = await createVectorStore("lancedb");
      const mockStore = await (lancedbModule.createVectorStore as any).mock
        .results[0].value;
      expect(store.isReady()).toBe(true);
      expect(mockStore.isReady).toHaveBeenCalled();
    });

    it("should delegate checkpoint to store", async () => {
      const store = await createVectorStore("lancedb");
      await store.checkpoint();
      // Just verify it doesn't throw as LanceDBAdapter.checkpoint is a no-op
    });

    it("should close store", async () => {
      const store = await createVectorStore("lancedb");
      const mockStore = await (lancedbModule.createVectorStore as any).mock
        .results[0].value;

      await store.close();
      expect(mockStore.close).toHaveBeenCalled();
    });
  });

  describe("ConGraphDBAdapter delegation", () => {
    it("should delegate searchArticles to store", async () => {
      const store = await createVectorStore("congraph");
      const mockStore = await (congraphModule.createConGraphVectorStore as any)
        .mock.results[0].value;

      await store.searchArticles([0.1], 5);
      expect(mockStore.searchArticles).toHaveBeenCalledWith(
        [0.1],
        5,
        undefined,
      );
    });

    it("should delegate searchArticlesBatch to store", async () => {
      const store = await createVectorStore("congraph");
      const mockStore = await (congraphModule.createConGraphVectorStore as any)
        .mock.results[0].value;
      mockStore.searchArticlesBatch = vi.fn().mockResolvedValue([[]]);
      await store.searchArticlesBatch([[0.1]], 5);
      expect(mockStore.searchArticlesBatch).toHaveBeenCalled();
    });

    it("should delegate all other methods to store", async () => {
      const store = await createVectorStore("congraph");
      const mockStore = await (congraphModule.createConGraphVectorStore as any)
        .mock.results[0].value;

      mockStore.addClauses = vi.fn();
      mockStore.addCommunityReports = vi.fn();
      mockStore.searchClauses = vi.fn();
      mockStore.searchCommunityReports = vi.fn();
      mockStore.getArticle = vi.fn();
      mockStore.getClause = vi.fn();
      mockStore.getStats = vi
        .fn()
        .mockResolvedValue({ articleCount: 0, clauseCount: 0 });
      mockStore.getCommunityReportCount = vi.fn();
      mockStore.clearAll = vi.fn();
      mockStore.checkpoint = vi.fn();

      await store.addClauses([]);
      await store.addCommunityReports([]);
      await store.searchClauses([0.1]);
      await store.searchCommunityReports([0.1]);
      await store.getArticle("1");
      await store.getClause("1");
      await store.getStats();
      await store.getCommunityReportCount();
      await store.clearAll();
      await store.checkpoint();

      expect(mockStore.addClauses).toHaveBeenCalled();
      expect(mockStore.addCommunityReports).toHaveBeenCalled();
      expect(mockStore.searchClauses).toHaveBeenCalled();
      expect(mockStore.searchCommunityReports).toHaveBeenCalled();
      expect(mockStore.getArticle).toHaveBeenCalled();
      expect(mockStore.getClause).toHaveBeenCalled();
      expect(mockStore.getStats).toHaveBeenCalled();
      expect(mockStore.getCommunityReportCount).toHaveBeenCalled();
      expect(mockStore.clearAll).toHaveBeenCalled();
      expect(mockStore.checkpoint).toHaveBeenCalled();
    });

    it("should check isReady", async () => {
      const store = await createVectorStore("congraph");
      const mockStore = await (congraphModule.createConGraphVectorStore as any)
        .mock.results[0].value;
      expect(store.isReady()).toBe(true);
      expect(mockStore.isReady).toHaveBeenCalled();
    });

    it("should close store", async () => {
      const store = await createVectorStore("congraph");
      const mockStore = await (congraphModule.createConGraphVectorStore as any)
        .mock.results[0].value;

      await store.close();
      expect(mockStore.close).toHaveBeenCalled();
    });
  });
});
