import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ConGraphVectorStore,
  ConGraphIndexingPipeline,
  createConGraphVectorStore,
  createConGraphIndexingPipeline,
} from "../../../src/embeddings/congraph";
import { config } from "../../../src/shared/config";
import * as congraphdb from "congraphdb";

// Mock congraphdb
vi.mock("congraphdb", () => ({
  createVectorStore: vi.fn(),
}));

vi.mock("../../../src/shared/config", () => ({
  config: {
    conGraphVectorDbPath: "./test-congraph",
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

describe("ConGraphVectorStore", () => {
  let mockStore: any;

  beforeEach(() => {
    mockStore = {
      init: vi.fn().mockResolvedValue(undefined),
      getTables: vi.fn().mockResolvedValue([]),
      createTable: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(100),
      search: vi.fn().mockResolvedValue([]),
      searchBatch: vi.fn().mockResolvedValue([[]]),
      get: vi.fn().mockResolvedValue(null),
      clear: vi.fn().mockResolvedValue(undefined),
      checkpoint: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    (congraphdb.createVectorStore as any).mockReturnValue(mockStore);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize and create tables if they do not exist", async () => {
    const store = new ConGraphVectorStore();
    await store.initialize();

    expect(congraphdb.createVectorStore).toHaveBeenCalledWith(
      "./test-congraph",
    );
    expect(mockStore.init).toHaveBeenCalled();
    expect(mockStore.createTable).toHaveBeenCalledTimes(3); // articles, clauses, community_reports
    expect(store.isReady()).toBe(true);
  });

  it("should handle initialization failure", async () => {
    mockStore.init.mockRejectedValueOnce(new Error("Init failed"));
    const store = new ConGraphVectorStore();
    await expect(store.initialize()).rejects.toThrow("Init failed");
  });

  it("should not recreate tables if they exist", async () => {
    mockStore.getTables.mockResolvedValue([
      { name: "articles" },
      { name: "clauses" },
      { name: "community_reports" },
    ]);

    const store = new ConGraphVectorStore();
    await store.initialize();

    expect(mockStore.createTable).not.toHaveBeenCalled();
  });

  it("should add articles", async () => {
    const store = new ConGraphVectorStore();
    await store.initialize();

    const embeddings = [{ vector: [0.1], article_id: "1" }] as any;
    await store.addArticles(embeddings);

    expect(mockStore.add).toHaveBeenCalledWith("articles", embeddings);
  });

  it("should handle addArticles failure", async () => {
    const store = new ConGraphVectorStore();
    await store.initialize();
    mockStore.add.mockRejectedValueOnce(new Error("Add failed"));
    await expect(store.addArticles([{ vector: [0.1] }] as any)).rejects.toThrow(
      "Add failed",
    );
  });

  it("should search articles and unwrap results", async () => {
    mockStore.search.mockResolvedValue([
      { n: { id: "1", title: "T1" } },
      { articles: { id: "2", title: "T2" } },
      { id: "3", title: "T3" },
    ]);

    const store = new ConGraphVectorStore();
    await store.initialize();

    const results = await store.searchArticles([0.1], 10, { part: "P1" });

    expect(mockStore.search).toHaveBeenCalledWith("articles", [0.1], {
      limit: 10,
      vectorProperty: "vector",
      filter: { part: "P1" },
    });

    expect(results).toHaveLength(3);
    expect(results[0].id).toBe("1");
    expect(results[1].id).toBe("2");
    expect(results[2].id).toBe("3");
  });

  it("should handle searchArticles failure", async () => {
    const store = new ConGraphVectorStore();
    await store.initialize();
    mockStore.search.mockRejectedValueOnce(new Error("Search failed"));
    await expect(store.searchArticles([0.1])).rejects.toThrow("Search failed");
  });

  it("should search articles batch", async () => {
    mockStore.searchBatch.mockResolvedValue([
      [{ n: { id: "1" } }],
      [{ n: { id: "2" } }],
    ]);

    const store = new ConGraphVectorStore();
    await store.initialize();

    const results = await store.searchArticlesBatch([[0.1], [0.2]], 5);

    expect(mockStore.searchBatch).toHaveBeenCalled();
    expect(results).toHaveLength(2);
    expect(results[0][0].id).toBe("1");
  });

  it("should search clauses", async () => {
    mockStore.search.mockResolvedValueOnce([{ n: { clause_id: "c1" } }]);
    const store = new ConGraphVectorStore();
    await store.initialize();
    const results = await store.searchClauses([0.1], 5, { chapter: "C1" });
    expect(results[0].clause_id).toBe("c1");
    expect(mockStore.search).toHaveBeenCalledWith(
      "clauses",
      [0.1],
      expect.objectContaining({ filter: { chapter: "C1" } }),
    );
  });

  it("should search community reports", async () => {
    mockStore.search.mockResolvedValueOnce([{ n: { id: "r1" } }]);
    const store = new ConGraphVectorStore();
    await store.initialize();
    const results = await store.searchCommunityReports([0.1], 3);
    expect(results[0].id).toBe("r1");
  });

  it("should get article by ID and unwrap", async () => {
    mockStore.get.mockResolvedValueOnce({ n: { id: "1" } });

    const store = new ConGraphVectorStore();
    await store.initialize();

    const article = await store.getArticle("1");
    expect(article.id).toBe("1");
    expect(mockStore.get).toHaveBeenCalledWith("articles", "1", "article_id");
  });

  it("should handle getArticle failure", async () => {
    const store = new ConGraphVectorStore();
    await store.initialize();
    mockStore.get.mockRejectedValueOnce(new Error("Get failed"));
    await expect(store.getArticle("1")).rejects.toThrow("Get failed");
  });

  it("should get clause by ID and unwrap", async () => {
    mockStore.get.mockResolvedValueOnce({ n: { clause_id: "c1" } });
    const store = new ConGraphVectorStore();
    await store.initialize();
    const clause = await store.getClause("c1");
    expect(clause.clause_id).toBe("c1");
    expect(mockStore.get).toHaveBeenCalledWith("clauses", "c1", "clause_id");
  });

  it("should handle getClause failure", async () => {
    const store = new ConGraphVectorStore();
    await store.initialize();
    mockStore.get.mockRejectedValueOnce(new Error("Get failed"));
    await expect(store.getClause("c1")).rejects.toThrow("Get failed");
  });

  it("should get community report count", async () => {
    mockStore.count.mockResolvedValueOnce(5);
    const store = new ConGraphVectorStore();
    await store.initialize();
    const count = await store.getCommunityReportCount();
    expect(count).toBe(5);
  });

  it("should handle getCommunityReportCount failure", async () => {
    const store = new ConGraphVectorStore();
    await store.initialize();
    mockStore.count.mockRejectedValueOnce(new Error("Count failed"));
    const count = await store.getCommunityReportCount();
    expect(count).toBe(-1);
  });

  it("should get stats", async () => {
    const store = new ConGraphVectorStore();
    await store.initialize();

    const stats = await store.getStats();
    expect(stats).toEqual({ articleCount: 100, clauseCount: 100 });
  });

  it("should clear all tables", async () => {
    const store = new ConGraphVectorStore();
    await store.initialize();
    await store.clearAll();

    expect(mockStore.clear).toHaveBeenCalledWith("articles");
    expect(mockStore.clear).toHaveBeenCalledWith("clauses");
    expect(mockStore.clear).toHaveBeenCalledWith("community_reports");
  });

  it("should handle clearAll failure", async () => {
    const store = new ConGraphVectorStore();
    await store.initialize();
    mockStore.clear.mockRejectedValueOnce(new Error("Clear failed"));
    await expect(store.clearAll()).rejects.toThrow("Clear failed");
  });

  it("should checkpoint", async () => {
    const store = new ConGraphVectorStore();
    await store.initialize();
    await store.checkpoint();
    expect(mockStore.checkpoint).toHaveBeenCalled();
  });

  it("should use factory function to create vector store", async () => {
    const store = await createConGraphVectorStore();
    expect(store).toBeInstanceOf(ConGraphVectorStore);
    expect(congraphdb.createVectorStore).toHaveBeenCalled();
  });
});

describe("ConGraphIndexingPipeline", () => {
  let mockStore: any;
  let mockEmbedder: any;

  beforeEach(() => {
    mockStore = {
      addArticles: vi.fn(),
      addClauses: vi.fn(),
      addCommunityReports: vi.fn(),
    };
    mockEmbedder = {
      embedBatch: vi.fn().mockResolvedValue([[0.1], [0.2]]),
    };
  });

  it("should index community reports in batch", async () => {
    const pipeline = new ConGraphIndexingPipeline(mockStore, mockEmbedder);
    const reports = [
      {
        community_id: "r1",
        title: "T1",
        summary: "S1",
        findings: ["f1"],
        level: 1,
        rating: 5,
      },
    ] as any;

    await pipeline.indexCommunityReports(reports);

    expect(mockEmbedder.embedBatch).toHaveBeenCalledWith(["T1 S1 f1"]);
    expect(mockStore.addCommunityReports).toHaveBeenCalled();
  });

  it("should handle indexing reports with some failed embeddings", async () => {
    const pipeline = new ConGraphIndexingPipeline(mockStore, mockEmbedder);
    const reports = [
      {
        community_id: "r1",
        title: "T1",
        summary: "S1",
        findings: ["f1"],
        level: 1,
        rating: 5,
      },
      {
        community_id: "r2",
        title: "T2",
        summary: "S2",
        findings: ["f2"],
        level: 1,
        rating: 5,
      },
    ] as any;

    mockEmbedder.embedBatch.mockResolvedValueOnce([[0.1], []]); // Second one fails
    await pipeline.indexCommunityReports(reports);
    expect(mockStore.addCommunityReports).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "r1" })]),
    );
  });

  it("should index articles in batches", async () => {
    const pipeline = new ConGraphIndexingPipeline(mockStore, mockEmbedder);
    const articles = new Array(250).fill(0).map((_, i) => ({
      id: `${i}`,
      title: `T${i}`,
      content: `C${i}`,
      article_number: i,
      metadata: {},
    })) as any;

    await pipeline.indexArticles(articles);
    expect(mockEmbedder.embedBatch).toHaveBeenCalledTimes(2);
  });

  it("should index clauses in batches", async () => {
    const pipeline = new ConGraphIndexingPipeline(mockStore, mockEmbedder);
    const articles = [
      {
        id: "a1",
        title: "T1",
        metadata: {},
        clauses: new Array(600)
          .fill(0)
          .map((_, i) => ({ id: `c${i}`, clause_number: i, text: "txt" })),
      },
    ] as any;

    await pipeline.indexClauses(articles);
    expect(mockStore.addClauses).toHaveBeenCalledTimes(2);
  });

  it("should index all", async () => {
    const pipeline = new ConGraphIndexingPipeline(mockStore, mockEmbedder);
    const articles = [
      { id: "a1", title: "T1", metadata: {}, clauses: [] },
    ] as any;
    const spy1 = vi.spyOn(pipeline, "indexArticles");
    const spy2 = vi.spyOn(pipeline, "indexClauses");
    await pipeline.indexAll(articles);
    expect(spy1).toHaveBeenCalled();
    expect(spy2).toHaveBeenCalled();
  });

  it("should use factory function to create indexing pipeline", async () => {
    const pipeline = await createConGraphIndexingPipeline(
      mockStore,
      mockEmbedder,
    );
    expect(pipeline).toBeInstanceOf(ConGraphIndexingPipeline);
  });
});
