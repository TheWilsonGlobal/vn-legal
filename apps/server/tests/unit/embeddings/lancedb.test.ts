import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  VectorStore,
  IndexingPipeline,
  createVectorStore,
  createIndexingPipeline,
} from "../../../src/embeddings/lancedb";
import { config } from "../../../src/shared/config";
import * as lancedb from "@lancedb/lancedb";

// Mock lancedb
vi.mock("@lancedb/lancedb", () => ({
  connect: vi.fn(),
}));

vi.mock("../../../src/shared/config", () => ({
  config: {
    vectorDbPath: "./test-db",
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

describe("LanceDB VectorStore", () => {
  let mockConnection: any;
  let mockTable: any;

  beforeEach(() => {
    mockTable = {
      add: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
      countRows: vi.fn().mockResolvedValue(10),
    };

    mockConnection = {
      openTable: vi.fn().mockResolvedValue(mockTable),
      createTable: vi.fn().mockResolvedValue(mockTable),
      tableNames: vi
        .fn()
        .mockResolvedValue(["articles", "clauses", "community_reports"]),
      dropTable: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    (lancedb.connect as any).mockResolvedValue(mockConnection);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize and open existing tables", async () => {
    const store = new VectorStore();
    await store.initialize();
    expect(lancedb.connect).toHaveBeenCalledWith("./test-db");
    expect(mockConnection.openTable).toHaveBeenCalledWith("articles");
    expect(mockConnection.openTable).toHaveBeenCalledWith("clauses");
    expect(mockConnection.openTable).toHaveBeenCalledWith("community_reports");
    expect(store.isReady()).toBe(true);
  });

  it("should handle initialization failure", async () => {
    (lancedb.connect as any).mockRejectedValueOnce(new Error("Connect failed"));
    const store = new VectorStore();
    await expect(store.initialize()).rejects.toThrow("Connect failed");
  });

  it("should handle missing tables during initialization", async () => {
    mockConnection.openTable.mockRejectedValue(new Error("Table not found"));
    const store = new VectorStore();
    await store.initialize();
    expect(store.isReady()).toBe(false); // Because tables are null
  });

  it("should add articles (creating table if needed)", async () => {
    const store = new VectorStore();
    await store.initialize();

    // Simulate table not opened during init
    (store as any).articlesTable = null;

    const embeddings = [{ vector: [0.1], article_id: "1" }] as any;
    await store.addArticles(embeddings);

    expect(mockConnection.createTable).toHaveBeenCalledWith(
      "articles",
      embeddings,
    );
  });

  it("should handle addArticles failure", async () => {
    const store = new VectorStore();
    await store.initialize();
    mockTable.add.mockRejectedValueOnce(new Error("Add failed"));
    await expect(store.addArticles([{ vector: [0.1] }] as any)).rejects.toThrow(
      "Add failed",
    );
  });

  it("should search articles with filters", async () => {
    const store = new VectorStore();
    await store.initialize();

    await store.searchArticles([0.1], 5, {
      part: "Part 1",
      chapter: "Chapter 2",
    });

    expect(mockTable.search).toHaveBeenCalledWith([0.1]);
    expect(mockTable.where).toHaveBeenCalledWith("part = 'Part 1'");
    expect(mockTable.where).toHaveBeenCalledWith("chapter = 'Chapter 2'");
    expect(mockTable.limit).toHaveBeenCalledWith(5);
  });

  it("should handle searchArticles failure", async () => {
    const store = new VectorStore();
    await store.initialize();
    mockTable.toArray.mockRejectedValueOnce(new Error("Search failed"));
    await expect(store.searchArticles([0.1])).rejects.toThrow("Search failed");
  });

  it("should search clauses", async () => {
    const store = new VectorStore();
    await store.initialize();

    await store.searchClauses([0.1], 10, { chapter: "C1" });

    expect(mockTable.where).toHaveBeenCalledWith("chapter = 'C1'");
  });

  it("should search community reports", async () => {
    const store = new VectorStore();
    await store.initialize();
    // Simulate communityReportsTable missing
    (store as any).communityReportsTable = null;
    const results = await store.searchCommunityReports([0.1]);
    expect(results).toEqual([]);

    // Now simulate it existing
    (store as any).communityReportsTable = mockTable;
    await store.searchCommunityReports([0.1]);
    expect(mockTable.search).toHaveBeenCalled();
  });

  it("should get stats", async () => {
    const store = new VectorStore();
    await store.initialize();
    mockTable.countRows.mockResolvedValueOnce(50).mockResolvedValueOnce(200);

    const stats = await store.getStats();
    expect(stats).toEqual({ articleCount: 50, clauseCount: 200 });
  });

  it("should get article by ID", async () => {
    const store = new VectorStore();
    await store.initialize();
    mockTable.where.mockReturnThis();
    mockTable.limit.mockReturnThis();
    mockTable.toArray.mockResolvedValueOnce([{ article_id: "a1" }]);
    const article = await store.getArticle("a1");
    expect(article?.article_id).toBe("a1");
  });

  it("should get clause by ID", async () => {
    const store = new VectorStore();
    await store.initialize();
    mockTable.where.mockReturnThis();
    mockTable.limit.mockReturnThis();
    mockTable.toArray.mockResolvedValueOnce([{ clause_id: "c1" }]);
    const clause = await store.getClause("c1");
    expect(clause?.clause_id).toBe("c1");
  });

  it("should handle missing article or clause", async () => {
    const store = new VectorStore();
    await store.initialize();
    mockTable.toArray.mockResolvedValue([]);
    expect(await store.getArticle("x")).toBeNull();
    expect(await store.getClause("x")).toBeNull();
  });

  it("should add clauses (creating table if needed)", async () => {
    const store = new VectorStore();
    await store.initialize();
    (store as any).clausesTable = null;
    const embeddings = [{ vector: [0.1], clause_id: "c1" }] as any;
    await store.addClauses(embeddings);
    expect(mockConnection.createTable).toHaveBeenCalledWith(
      "clauses",
      embeddings,
    );
  });

  it("should add community reports (creating table if needed)", async () => {
    const store = new VectorStore();
    await store.initialize();
    (store as any).communityReportsTable = null;
    const embeddings = [{ vector: [0.1], id: "r1" }] as any;
    await store.addCommunityReports(embeddings);
    expect(mockConnection.createTable).toHaveBeenCalledWith(
      "community_reports",
      embeddings,
    );
  });

  it("should get community report count", async () => {
    const store = new VectorStore();
    await store.initialize();
    (store as any).communityReportsTable = mockTable;
    const count = await store.getCommunityReportCount();
    expect(count).toBe(10);
  });

  it("should clear all tables", async () => {
    const store = new VectorStore();
    await store.initialize();
    await store.clearAll();
    expect(mockConnection.dropTable).toHaveBeenCalledWith("articles");
    expect(mockConnection.dropTable).toHaveBeenCalledWith("clauses");
    expect(mockConnection.dropTable).toHaveBeenCalledWith("community_reports");
  });

  it("should handle clearAll failure", async () => {
    const store = new VectorStore();
    await store.initialize();
    mockConnection.dropTable.mockRejectedValueOnce(new Error("Drop failed"));
    await expect(store.clearAll()).rejects.toThrow("Drop failed");
  });

  it("should close connection", async () => {
    const store = new VectorStore();
    await store.initialize();
    await store.close();
    expect(mockConnection.close).toHaveBeenCalled();
    expect(store.isReady()).toBe(false);
  });

  it("should get underlying store", async () => {
    const store = new VectorStore();
    await store.initialize();
    expect(store.getStore()).toBe(mockConnection);
  });

  it("should use factory function to create vector store", async () => {
    const store = await createVectorStore();
    expect(store).toBeInstanceOf(VectorStore);
    expect(lancedb.connect).toHaveBeenCalled();
  });
});

describe("IndexingPipeline", () => {
  let mockStore: any;
  let mockEmbedder: any;

  beforeEach(() => {
    mockStore = {
      addArticles: vi.fn().mockResolvedValue(undefined),
      addClauses: vi.fn().mockResolvedValue(undefined),
      addCommunityReports: vi.fn().mockResolvedValue(undefined),
    };
    mockEmbedder = {
      embed: vi.fn().mockResolvedValue([0.1]),
      embedBatch: vi.fn().mockResolvedValue([[0.1], [0.2]]),
    };
  });

  it("should index articles in batches", async () => {
    const pipeline = new IndexingPipeline(mockStore, mockEmbedder);
    const articles = new Array(250).fill(0).map((_, i) => ({
      id: `${i}`,
      title: `T${i}`,
      content: `C${i}`,
      article_number: i,
      metadata: {},
    })) as any;

    await pipeline.indexArticles(articles);

    // Batch size is 200, so 2 batches (200 + 50)
    expect(mockEmbedder.embedBatch).toHaveBeenCalledTimes(2);
    expect(mockStore.addArticles).toHaveBeenCalledTimes(2);
  });

  it("should index clauses", async () => {
    const pipeline = new IndexingPipeline(mockStore, mockEmbedder);
    const articles = [
      {
        id: "a1",
        title: "T1",
        metadata: {},
        clauses: [{ id: "c1", clause_number: 1, text: "text1" }],
      },
    ] as any;

    await pipeline.indexClauses(articles);
    expect(mockEmbedder.embedBatch).toHaveBeenCalled();
    expect(mockStore.addClauses).toHaveBeenCalled();
  });

  it("should index community reports", async () => {
    const pipeline = new IndexingPipeline(mockStore, mockEmbedder);
    const reports = [
      {
        community_id: "r1",
        title: "RT1",
        summary: "S1",
        findings: ["f1"],
        level: 1,
        rating: 5,
      },
    ] as any;

    await pipeline.indexCommunityReports(reports);
    expect(mockEmbedder.embed).toHaveBeenCalled();
    expect(mockStore.addCommunityReports).toHaveBeenCalled();
  });

  it("should handle indexing reports with failed embeddings", async () => {
    const pipeline = new IndexingPipeline(mockStore, mockEmbedder);
    const reports = [{ community_id: "r1" }] as any;
    mockEmbedder.embed.mockResolvedValueOnce([]); // Fail
    await pipeline.indexCommunityReports(reports);
    expect(mockStore.addCommunityReports).not.toHaveBeenCalled();
  });

  it("should handle indexing reports with errors", async () => {
    const pipeline = new IndexingPipeline(mockStore, mockEmbedder);
    const reports = [{ community_id: "r1" }] as any;
    mockEmbedder.embed.mockRejectedValueOnce(new Error("Embed error"));
    await pipeline.indexCommunityReports(reports);
    expect(mockStore.addCommunityReports).not.toHaveBeenCalled();
  });

  it("should handle empty community reports indexing", async () => {
    const pipeline = new IndexingPipeline(mockStore, mockEmbedder);
    await pipeline.indexCommunityReports([]);
    expect(mockStore.addCommunityReports).not.toHaveBeenCalled();
  });

  it("should index clauses in batches", async () => {
    const pipeline = new IndexingPipeline(mockStore, mockEmbedder);
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
    const pipeline = new IndexingPipeline(mockStore, mockEmbedder);
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
    const pipeline = await createIndexingPipeline(mockStore, mockEmbedder);
    expect(pipeline).toBeInstanceOf(IndexingPipeline);
  });
});
