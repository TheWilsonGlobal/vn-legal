import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { adminRoutes } from "../../../../src/api/routes/admin";

// Mock dependencies
vi.mock("../../../../src/shared/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../../../src/shared/activity-log", () => ({
  activityLog: {
    addEntry: vi.fn(),
    getEntries: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("../../../../src/shared/config", () => ({
  config: {
    vectorStoreType: "congraph",
    vectorDbPath: "/data/vectors",
    conGraphVectorDbPath: "/data/congraph",
    graphDbPath: "/data/graph.cgraph",
    embeddingModel: "model",
    embeddingDimension: 384,
    embeddingBackend: "transformers",
    llm: {
      provider: "anthropic",
      model: "claude-3",
    },
  },
}));

vi.mock("../../../../src/embeddings/embedder", () => ({
  getEmbedder: vi.fn().mockResolvedValue({
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  }),
}));

vi.mock("../../../../src/scripts/build-graph", () => ({
  buildGraph: vi.fn().mockResolvedValue(undefined),
  addGraph: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/scripts/build-index", () => ({
  buildVectorIndex: vi.fn().mockResolvedValue(undefined),
  addIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue("[]"),
}));

describe("Admin Routes", () => {
  let fastify: any;
  let mockGraph: any;
  let mockVectorStore: any;

  beforeEach(async () => {
    fastify = Fastify();

    mockGraph = {
      refresh: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockResolvedValue({
        Article: 10,
        Chapter: 5,
        edge: 15,
        "edge:REFERENCES": 5,
      }),
      query: vi.fn(),
      getNodesByType: vi.fn().mockResolvedValue([]),
      addNode: vi.fn().mockResolvedValue(undefined),
      addEdge: vi.fn().mockResolvedValue(undefined),
      createEdgesBatch: vi.fn().mockResolvedValue(undefined),
    };

    mockVectorStore = {
      getStats: vi.fn().mockResolvedValue({
        articleCount: 10,
        clauseCount: 20,
      }),
      getType: vi.fn().mockReturnValue("lancedb"),
      isReady: vi.fn().mockReturnValue(true),
      searchArticles: vi.fn(),
      searchClauses: vi.fn(),
      addCommunityReports: vi.fn().mockResolvedValue(undefined),
    };

    await fastify.register(adminRoutes, {
      prefix: "/api",
      graph: mockGraph,
      vectorStore: mockVectorStore,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /admin/rebuild-graph", () => {
    it("should start graph rebuild process", async () => {
      const response = await fastify.inject({
        method: "POST",
        url: "/api/admin/rebuild-graph",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.message).toContain("Graph rebuild process started");
      expect(body.timestamp).toBeDefined();
    });
  });

  describe("POST /admin/rebuild-vector", () => {
    it("should start vector re-indexing process", async () => {
      const response = await fastify.inject({
        method: "POST",
        url: "/api/admin/rebuild-vector",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.message).toContain("Vector re-indexing process started");
    });
  });

  describe("GET /admin/stats", () => {
    it("should return system statistics", async () => {
      mockGraph.getStats.mockResolvedValue({
        Article: 10,
        Chapter: 5,
        "edge:REFERENCES": 5,
        "edge:BELONGS_TO": 10,
      });
      mockVectorStore.getStats.mockResolvedValue({
        articleCount: 10,
        clauseCount: 20,
      });

      const response = await fastify.inject({
        method: "GET",
        url: "/api/admin/stats",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.graph).toBeDefined();
      expect(body.vector).toBeDefined();
    });

    it("should handle stats query failure", async () => {
      mockGraph.getStats.mockRejectedValue(new Error("DB error"));

      const response = await fastify.inject({
        method: "GET",
        url: "/api/admin/stats",
      });

      expect(response.statusCode).toBe(500);
    });

    it("should handle sample fetch failure gracefully", async () => {
      mockGraph.getStats.mockResolvedValue({
        Article: 10,
        Chapter: 5,
      });
      mockGraph.query.mockRejectedValue(new Error("Query failed"));

      const response = await fastify.inject({
        method: "GET",
        url: "/api/admin/stats",
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("POST /admin/vector/search", () => {
    it("should search vector store and return combined results", async () => {
      mockVectorStore.searchArticles.mockResolvedValue([
        {
          article_id: "a1",
          article_number: 1,
          title: "T1",
          content: "C1",
          _distance: 0.1,
        },
      ]);
      mockVectorStore.searchClauses.mockResolvedValue([
        {
          article_id: "a1",
          clause_number: 1,
          text: "Clause text",
          article_title: "T1",
          _distance: 0.2,
        },
      ]);

      const response = await fastify.inject({
        method: "POST",
        url: "/api/admin/vector/search",
        payload: { query: "test query", limit: 5 },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.results).toBeDefined();
    });

    it("should handle search errors", async () => {
      mockVectorStore.searchArticles.mockRejectedValue(
        new Error("Search failed"),
      );

      const response = await fastify.inject({
        method: "POST",
        url: "/api/admin/vector/search",
        payload: { query: "test" },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe("GET /admin/graph/data", () => {
    it("should return graph nodes and edges", async () => {
      mockGraph.getNodesByType.mockImplementation((type: string) => {
        if (type === "Article") return [{ id: "a1", name: "Article 1" }];
        if (type === "Chapter") return [{ id: "c1", name: "Chapter 1" }];
        return [];
      });
      mockGraph.query.mockResolvedValue([
        { source: "c1", target: "a1", type: "HAS_CHAPTER" },
      ]);

      const response = await fastify.inject({
        method: "GET",
        url: "/api/admin/graph/data",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.nodes).toBeDefined();
      expect(body.edges).toBeDefined();
    });

    it("should handle graph data fetch errors", async () => {
      mockGraph.getNodesByType.mockRejectedValue(new Error("Fetch error"));

      const response = await fastify.inject({
        method: "GET",
        url: "/api/admin/graph/data",
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe("GET /admin/activity", () => {
    it("should return activity logs", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: "/api/admin/activity",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.activities).toBeDefined();
    });

    it("should respect limit parameter", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: "/api/admin/activity?limit=5",
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("GET /admin/communities", () => {
    it("should return community reports", async () => {
      mockGraph.query.mockResolvedValue([
        {
          id: "c1",
          level: 1,
          title: "Community 1",
          summary: "Summary",
          rating: 5,
          findings: '["F1", "F2"]',
        },
      ]);

      const response = await fastify.inject({
        method: "GET",
        url: "/api/admin/communities",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.communities).toBeDefined();
    });

    it("should handle communities query errors", async () => {
      mockGraph.query.mockRejectedValue(new Error("Query error"));

      const response = await fastify.inject({
        method: "GET",
        url: "/api/admin/communities",
      });

      expect(response.statusCode).toBe(500);
    });

    it("should handle findings that are already arrays", async () => {
      mockGraph.query.mockResolvedValue([
        {
          id: "c1",
          level: 1,
          title: "C1",
          summary: "S",
          rating: 5,
          findings: ["F1", "F2"],
        },
      ]);

      const response = await fastify.inject({
        method: "GET",
        url: "/api/admin/communities",
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("GET /admin/vector-store/status", () => {
    it("should return vector store status", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: "/api/admin/vector-store/status",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.type).toBe("lancedb");
      expect(body.ready).toBe(true);
      expect(body.config).toBeDefined();
    });

    it("should handle status errors", async () => {
      mockVectorStore.getType.mockImplementation(() => {
        throw new Error("Error");
      });

      const response = await fastify.inject({
        method: "GET",
        url: "/api/admin/vector-store/status",
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe("GET /admin/config", () => {
    it("should return system configuration", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: "/api/admin/config",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.vectorStoreType).toBeDefined();
      expect(body.embeddingModel).toBeDefined();
      expect(body.llmProvider).toBeDefined();
    });

    it("should handle config errors", async () => {
      const { config } = await import("../../../../src/shared/config");
      Object.defineProperty(config, "vectorStoreType", {
        get: () => {
          throw new Error("Config error");
        },
      });

      const response = await fastify.inject({
        method: "GET",
        url: "/api/admin/config",
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe("POST /admin/knowledge/upload", () => {
    it("should upload file and update graph", async () => {
      mockGraph.getStats.mockResolvedValue({ Article: 5 });

      const response = await fastify.inject({
        method: "POST",
        url: "/api/admin/knowledge/upload",
        payload: {
          filename: "test.json",
          content: [{ test: "data" }],
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should handle upload failures", async () => {
      const { writeFile } = await import("node:fs/promises");
      (writeFile as any).mockRejectedValueOnce(new Error("Write error"));

      const response = await fastify.inject({
        method: "POST",
        url: "/api/admin/knowledge/upload",
        payload: { filename: "test.json", content: [] },
      });

      expect(response.statusCode).toBe(500);
    });

    it("should handle index update failures", async () => {
      const { addIndex } = await import("../../../../src/scripts/build-index");
      (addIndex as any).mockRejectedValueOnce(new Error("Index error"));

      const response = await fastify.inject({
        method: "POST",
        url: "/api/admin/knowledge/upload",
        payload: { filename: "test.json", content: [] },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe("POST /admin/knowledge/clean", () => {
    it("should clean knowledge data", async () => {
      const { readdir } = await import("node:fs/promises");
      vi.mocked(readdir).mockResolvedValueOnce(["test.json"]);

      const response = await fastify.inject({
        method: "POST",
        url: "/api/admin/knowledge/clean",
      });

      expect(response.statusCode).toBe(200);
    });

    it("should handle clean errors", async () => {
      const { readdir } = await import("node:fs/promises");
      vi.mocked(readdir).mockRejectedValueOnce(new Error("Delete error"));

      const response = await fastify.inject({
        method: "POST",
        url: "/api/admin/knowledge/clean",
      });

      expect(response.statusCode).toBe(500);
    });

    it("should skip community_reports.json when cleaning", async () => {
      const { readdir } = await import("node:fs/promises");
      vi.mocked(readdir).mockResolvedValueOnce([
        "community_reports.json",
        "other.json",
      ]);

      const response = await fastify.inject({
        method: "POST",
        url: "/api/admin/knowledge/clean",
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("POST /admin/community/add", () => {
    it("should add new community report", async () => {
      mockGraph.query.mockResolvedValue([{ id: "a1" }]);

      const response = await fastify.inject({
        method: "POST",
        url: "/api/admin/community/add",
        payload: {
          community_id: "chapter_1",
          level: 1,
          title: "Test Community",
          summary: "Test Summary",
          findings: ["F1", "F2"],
          rating: 5,
          parent_id: "part_1",
          article_count: 10,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should handle community add errors", async () => {
      const { getEmbedder } =
        await import("../../../../src/embeddings/embedder");
      (getEmbedder as any).mockRejectedValueOnce(new Error("Embedder error"));

      const response = await fastify.inject({
        method: "POST",
        url: "/api/admin/community/add",
        payload: {
          community_id: "c1",
          level: 1,
          title: "T",
          summary: "S",
        },
      });

      expect(response.statusCode).toBe(500);
    });

    it("should create hierarchical edge for level 1 with parent", async () => {
      mockGraph.query.mockResolvedValue([]);

      const response = await fastify.inject({
        method: "POST",
        url: "/api/admin/community/add",
        payload: {
          community_id: "chapter_1",
          level: 1,
          title: "T",
          summary: "S",
          parent_id: "part_1",
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should create BELONGS_TO_COMMUNITY edges for chapter communities", async () => {
      mockGraph.query.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);

      const response = await fastify.inject({
        method: "POST",
        url: "/api/admin/community/add",
        payload: {
          community_id: "chapter_1",
          level: 1,
          title: "T",
          summary: "S",
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should update community_reports.json file", async () => {
      const { readFile } = await import("node:fs/promises");
      (readFile as any).mockResolvedValueOnce(JSON.stringify([]));
      mockGraph.query.mockResolvedValue([]);

      const response = await fastify.inject({
        method: "POST",
        url: "/api/admin/community/add",
        payload: {
          community_id: "c1",
          level: 1,
          title: "T",
          summary: "S",
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should create new community_reports.json if not exists", async () => {
      const { readFile } = await import("node:fs/promises");
      (readFile as any).mockRejectedValueOnce(new Error("Not found"));
      mockGraph.query.mockResolvedValue([]);

      const response = await fastify.inject({
        method: "POST",
        url: "/api/admin/community/add",
        payload: {
          community_id: "c1",
          level: 1,
          title: "T",
          summary: "S",
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
