import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GraphClient, createMockConn } from "./client-test-setup";

describe("GraphClient", () => {
  let client: GraphClient;
  let mockConn: any;

  beforeEach(() => {
    client = new GraphClient("/test/db");
    mockConn = createMockConn();
  });

  afterEach(async () => {
    if (client && (client as any).isInitialized) {
      await client.close();
    }
  });

  describe("getFullArticle", () => {
    beforeEach(async () => {
      await client.initialize();
      client.conn = mockConn;
    });

    it("should throw error when not initialized", async () => {
      const noConnClient = new GraphClient("/test/db");
      await expect(noConnClient.getFullArticle("article_1")).rejects.toThrow(
        "Connection not initialized",
      );
    });

    it("should return null for non-existent article", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([]),
        close: vi.fn(),
      });

      const result = await client.getFullArticle("article_999");
      expect(result).toBeNull();
    });

    it("should return article with clauses and points", async () => {
      const mockRows = [
        {
          a: {
            id: "article_1",
            article_number: 1,
            title: "Test Article",
            content: "Content",
            metadata: null,
            hierarchical_path: "P1 > C1",
            clause_count: 1,
          },
          part_name: "Part 1",
          chapter_name: "Chapter 1",
          clause: {
            id: "clause_1",
            clause_number: 1,
            text: "Clause text",
            article_id: "article_1",
          },
          point: {
            id: "point_1",
            point_letter: "a",
            text: "Point text",
            clause_id: "clause_1",
          },
        },
      ];

      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue(mockRows),
        close: vi.fn(),
      });

      const result = await client.getFullArticle("article_1");
      expect(result).toBeDefined();
      expect(result?.id).toBe("article_1");
      expect(result?.clauses).toHaveLength(1);
      expect(result?.clauses[0].points).toHaveLength(1);
    });

    it("should handle missing metadata", async () => {
      const mockRows = [
        {
          a: {
            id: "article_1",
            article_number: 1,
            title: "Test",
            content: "Content",
            metadata: null,
          },
          part_name: "Part 1",
          chapter_name: "Chapter 1",
          clause: null,
          point: null,
        },
      ];

      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue(mockRows),
        close: vi.fn(),
      });

      const result = await client.getFullArticle("article_1");
      expect(result?.metadata).toBeDefined();
    });

    it("should update metadata with part and chapter names", async () => {
      const mockRows = [
        {
          a: {
            id: "article_1",
            article_number: 1,
            title: "Test",
            content: "Content",
            metadata: { part: "", chapter: "" },
          },
          part_name: "Part 1",
          chapter_name: "Chapter 1",
          clause: null,
          point: null,
        },
      ];

      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue(mockRows),
        close: vi.fn(),
      });

      const result = await client.getFullArticle("article_1");
      expect(result?.metadata?.part).toBe("Part 1");
      expect(result?.metadata?.chapter).toBe("Chapter 1");
    });

    it("should handle query errors", async () => {
      mockConn.query.mockRejectedValue(new Error("Query failed"));

      const result = await client.getFullArticle("article_1");
      expect(result).toBeNull();
    });

    it("should handle article without hierarchical_path", async () => {
      const mockRows = [
        {
          a: {
            id: "article_1",
            article_number: 1,
            title: "Test",
            content: "Content",
            metadata: { part: "P1", chapter: "C1" },
          },
          part_name: "Part 1",
          chapter_name: "Chapter 1",
          clause: null,
          point: null,
        },
      ];

      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue(mockRows),
        close: vi.fn(),
      });

      const result = await client.getFullArticle("article_1");
      expect(result).toBeDefined();
    });
  });
});
