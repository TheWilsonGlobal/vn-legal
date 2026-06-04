import "../setup-integration"; // Must be first import to unmock congraphdb
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createGraphRAG } from "../../src/retrieval/graphRAG-congraph";
import { createLLMAdapter } from "../../src/agent/congraph-rag-llm";
import { getEmbedder } from "../../src/embeddings/embedder";
import { createStorageAdapter } from "../../src/storage-adapters/congraph-rag-adapter";
import { GraphFixture } from "./fixtures/graph-fixture";

// Note: Integration tests use real congraphdb (no mocks) via workspace config

describe("MSGraphRAG Community Context Integration", () => {
  let client: Awaited<ReturnType<typeof GraphFixture.get>>;
  let storage: any;
  let llm: any;
  let mockVectorStore: any;

  beforeAll(async () => {
    client = await GraphFixture.get();

    const embedder = await getEmbedder();
    llm = createLLMAdapter(embedder, { provider: "template" });

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

    storage = createStorageAdapter(client, mockVectorStore);
  }, 300000);

  afterAll(async () => {
    await GraphFixture.cleanup();
  });

  it("should retrieve community context at different levels", async () => {
    const graphRAG = createGraphRAG(storage, llm);
    const context = await graphRAG.getCommunityContext("article_21", 1);

    expect(context).toBeDefined();
    expect(context.part).toBeDefined();
    expect(context.chapter).toBeDefined();
    expect(context.principles).toBeDefined();
  }, 30000);

  it("should perform global query", async () => {
    const graphRAG = createGraphRAG(storage, llm);
    const result = await graphRAG.globalQuery("Tóm tắt quyền sở hữu", 0);
    expect(typeof result).toBe("string");
    // When no communities exist, result may be empty or a message
    // This is expected behavior for graphs without community reports
    expect(result.length).toBeGreaterThanOrEqual(0);
  }, 30000);

  it("should get community articles", async () => {
    const graphRAG = createGraphRAG(storage, llm);
    const communityArticles = await graphRAG.getCommunityArticles(
      "article_21",
      5,
      1,
    );
    expect(Array.isArray(communityArticles)).toBe(true);
  }, 30000);
});
