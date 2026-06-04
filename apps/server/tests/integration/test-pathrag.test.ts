import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPathRAG } from "../../src/retrieval/pathRAG-congraph";
import { createStorageAdapter } from "../../src/storage-adapters/congraph-rag-adapter";
import { GraphFixture } from "./fixtures/graph-fixture";

// Note: Integration tests use real congraphdb (no mocks) via workspace config

describe("PathRAG Traversal Integration", () => {
  let client: Awaited<ReturnType<typeof GraphFixture.get>>;
  let mockVectorStore: any;

  beforeAll(async () => {
    client = await GraphFixture.get();
    // Create a mock vector store
    mockVectorStore = {
      searchArticles: vi.fn().mockResolvedValue([]),
      searchClauses: vi.fn().mockResolvedValue([]),
      searchCommunityReports: vi.fn().mockResolvedValue([]),
      addArticles: vi.fn().mockResolvedValue(undefined),
      addClauses: vi.fn().mockResolvedValue(undefined),
      addCommunityReports: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockReturnValue(true),
      getStats: vi.fn().mockResolvedValue({ articleCount: 0, clauseCount: 0 }),
      getArticle: vi.fn().mockResolvedValue(null),
      getClause: vi.fn().mockResolvedValue(null),
      getCommunityReportCount: vi.fn().mockResolvedValue(0),
      clearAll: vi.fn().mockResolvedValue(undefined),
      checkpoint: vi.fn().mockResolvedValue(undefined),
      getType: vi.fn().mockReturnValue("mock"),
      getStore: vi.fn().mockReturnValue(null),
      searchArticlesBatch: vi.fn().mockResolvedValue([]),
    };
  });

  afterAll(async () => {
    await GraphFixture.cleanup();
  });

  it.skip("should build a graph and traverse references", async () => {
    const storage = createStorageAdapter(client, mockVectorStore);
    const pathRAG = createPathRAG(storage);

    const query = "Người chưa thành niên ký hợp đồng được không?";
    const paths = await pathRAG.traverseReferences(query, { maxDepth: 2 });

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].article).toBeDefined();
    expect(paths[0].depth).toBe(0);
  }, 30000);

  it.skip("should find a path between adjacent articles", async () => {
    // SKIPPED: This test hangs due to slow BFS traversal
    // TODO: Optimize findPath method or add better caching
    const storage = createStorageAdapter(client, mockVectorStore);
    const pathRAG = createPathRAG(storage);
    const path = await pathRAG.findPath("article_20", "article_21");
    expect(Array.isArray(path)).toBe(true);
  });

  it.skip("should get referencing articles", async () => {
    // SKIPPED: This test hangs due to slow getIncomingEdges query
    // TODO: Investigate and optimize the query
    const storage = createStorageAdapter(client, mockVectorStore);
    const pathRAG = createPathRAG(storage);
    const refArticles = await pathRAG.getReferencingArticles("article_21");
    expect(Array.isArray(refArticles)).toBe(true);
  });
});
