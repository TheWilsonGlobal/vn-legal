import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { articlesRoutes } from "../../../../src/api/routes/articles";

// Mock getEmbedder
const mockEmbed = vi.fn().mockResolvedValue([0.1, 0.2]);
const mockGetEmbedder = vi.fn().mockResolvedValue({
  embed: mockEmbed,
});

vi.mock("../../../../src/embeddings/embedder", () => ({
  getEmbedder: () => mockGetEmbedder(),
}));

describe("Articles Routes", () => {
  let fastify: any;
  let mockGraph: any;
  let mockVectorStore: any;

  beforeEach(async () => {
    fastify = Fastify();
    mockGraph = {
      getNode: vi.fn(),
      getOutgoingEdges: vi.fn().mockResolvedValue([]),
      getIncomingEdges: vi.fn().mockResolvedValue([]),
      getNodesByType: vi.fn().mockResolvedValue([]),
    };
    mockVectorStore = {
      searchArticles: vi.fn().mockResolvedValue([]),
    };
    await fastify.register(articlesRoutes, {
      prefix: "/api",
      graph: mockGraph,
      vectorStore: mockVectorStore,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /article/:id", () => {
    it("should return article and related info", async () => {
      mockGraph.getNode
        .mockResolvedValueOnce({ id: "a1", article_number: 1, title: "T1" })
        .mockResolvedValueOnce({ id: "a2", article_number: 2, title: "T2" });
      mockGraph.getOutgoingEdges.mockResolvedValue([{ to: "a2" }]);

      const response = await fastify.inject({
        method: "GET",
        url: "/api/article/a1",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.article).toBeDefined();
      expect(body.related_articles.references).toHaveLength(1);
    });

    it("should return 404 if article not found", async () => {
      mockGraph.getNode.mockResolvedValue(null);

      const response = await fastify.inject({
        method: "GET",
        url: "/api/article/missing",
      });

      expect(response.statusCode).toBe(404);
    });

    it("should handle both outgoing and incoming references", async () => {
      mockGraph.getNode
        .mockResolvedValueOnce({ id: "a1", article_number: 1, title: "T1" })
        .mockResolvedValueOnce({ id: "a2", article_number: 2, title: "T2" })
        .mockResolvedValueOnce({ id: "a3", article_number: 3, title: "T3" });
      mockGraph.getOutgoingEdges.mockResolvedValue([{ to: "a2" }]);
      mockGraph.getIncomingEdges.mockResolvedValue([{ from: "a3" }]);

      const response = await fastify.inject({
        method: "GET",
        url: "/api/article/a1",
      });

      expect(response.statusCode).toBe(200);
    });

    it("should skip related articles that are not found", async () => {
      mockGraph.getNode
        .mockResolvedValueOnce({ id: "a1", article_number: 1, title: "T1" })
        .mockResolvedValueOnce(null);
      mockGraph.getOutgoingEdges.mockResolvedValue([{ to: "missing" }]);

      const response = await fastify.inject({
        method: "GET",
        url: "/api/article/a1",
      });

      expect(response.statusCode).toBe(200);
    });

    it("should handle errors gracefully", async () => {
      mockGraph.getNode.mockRejectedValue(new Error("Database error"));

      const response = await fastify.inject({
        method: "GET",
        url: "/api/article/a1",
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe("GET /article/:id/clauses", () => {
    it("should return clauses", async () => {
      mockGraph.getNode.mockResolvedValue({
        id: "a1",
        clauses: [{ clause_number: 1 }],
      });

      const response = await fastify.inject({
        method: "GET",
        url: "/api/article/a1/clauses",
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload).clauses).toHaveLength(1);
    });

    it("should return empty clauses array if none exist", async () => {
      mockGraph.getNode.mockResolvedValue({ id: "a1", clauses: undefined });

      const response = await fastify.inject({
        method: "GET",
        url: "/api/article/a1/clauses",
      });

      expect(response.statusCode).toBe(200);
    });

    it("should return 404 if article not found", async () => {
      mockGraph.getNode.mockResolvedValue(null);

      const response = await fastify.inject({
        method: "GET",
        url: "/api/article/missing/clauses",
      });

      expect(response.statusCode).toBe(404);
    });

    it("should handle errors gracefully", async () => {
      mockGraph.getNode.mockRejectedValue(new Error("DB error"));

      const response = await fastify.inject({
        method: "GET",
        url: "/api/article/a1/clauses",
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe("GET /search", () => {
    it("should perform vector search", async () => {
      mockVectorStore.searchArticles.mockResolvedValue([
        {
          article_id: "a1",
          article_number: 1,
          title: "T1",
          content: "C1",
          _distance: 0.1,
        },
      ]);

      const response = await fastify.inject({
        method: "GET",
        url: "/api/search?q=test+query",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.results).toHaveLength(1);
    });

    it("should handle search with custom limit", async () => {
      mockVectorStore.searchArticles.mockResolvedValue([]);

      const response = await fastify.inject({
        method: "GET",
        url: "/api/search?q=test&limit=20",
      });

      expect(response.statusCode).toBe(200);
    });

    it("should apply filters to search", async () => {
      mockVectorStore.searchArticles.mockResolvedValue([]);

      const response = await fastify.inject({
        method: "GET",
        url: "/api/search?q=test&part=part1&chapter=ch1&section=s1",
      });

      expect(response.statusCode).toBe(200);
    });

    it("should return results without distance when not available", async () => {
      mockVectorStore.searchArticles.mockResolvedValue([
        { article_id: "a1", article_number: 1, title: "T1", content: "C1" },
      ]);

      const response = await fastify.inject({
        method: "GET",
        url: "/api/search?q=test",
      });

      expect(response.statusCode).toBe(200);
    });

    it("should handle search errors", async () => {
      mockVectorStore.searchArticles.mockRejectedValue(
        new Error("Search error"),
      );

      const response = await fastify.inject({
        method: "GET",
        url: "/api/search?q=test",
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe("GET /articles/random", () => {
    it("should return a random article", async () => {
      mockGraph.getNodesByType.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);

      const response = await fastify.inject({
        method: "GET",
        url: "/api/articles/random",
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload).article).toBeDefined();
    });

    it("should filter random article by chapter", async () => {
      mockGraph.getNodesByType.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
      mockGraph.getOutgoingEdges.mockImplementation((id: string) => {
        if (id === "a1") return Promise.resolve([{ to: "chapter_1" }]);
        return Promise.resolve([]);
      });

      const response = await fastify.inject({
        method: "GET",
        url: "/api/articles/random?chapter=chapter_1",
      });

      expect(response.statusCode).toBe(200);
    });

    it("should return 404 if no articles found", async () => {
      mockGraph.getNodesByType.mockResolvedValue([]);

      const response = await fastify.inject({
        method: "GET",
        url: "/api/articles/random",
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 404 if no articles match chapter filter", async () => {
      mockGraph.getNodesByType.mockResolvedValue([{ id: "a1" }]);
      mockGraph.getOutgoingEdges.mockResolvedValue([{ to: "chapter_2" }]);

      const response = await fastify.inject({
        method: "GET",
        url: "/api/articles/random?chapter=chapter_1",
      });

      expect(response.statusCode).toBe(404);
    });

    it("should handle partial chapter name matches", async () => {
      mockGraph.getNodesByType.mockResolvedValue([{ id: "a1" }]);
      mockGraph.getOutgoingEdges.mockResolvedValue([
        { to: "chapter_1_extra_info" },
      ]);

      const response = await fastify.inject({
        method: "GET",
        url: "/api/articles/random?chapter=chapter_1",
      });

      expect(response.statusCode).toBe(200);
    });

    it("should handle errors gracefully", async () => {
      mockGraph.getNodesByType.mockRejectedValue(new Error("DB error"));

      const response = await fastify.inject({
        method: "GET",
        url: "/api/articles/random",
      });

      expect(response.statusCode).toBe(500);
    });
  });
});
