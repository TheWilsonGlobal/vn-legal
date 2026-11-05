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

  describe("getNode", () => {
    beforeEach(async () => {
      await client.initialize();
      client.conn = mockConn;
    });

    it("should throw error when not initialized", async () => {
      const noConnClient = new GraphClient("/test/db");
      await expect(
        noConnClient.getNode("Article", "article_1"),
      ).rejects.toThrow("Connection not initialized");
    });

    it("should return null for non-existent node", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([]),
        close: vi.fn(),
      });

      const result = await client.getNode("Article", "article_999");
      expect(result).toBeNull();
    });

    it("should return node by type and id", async () => {
      const mockNode = { id: "article_1", title: "Test Article" };
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ n: mockNode }]),
        close: vi.fn(),
      });

      const result = await client.getNode("Article", "article_1");
      expect(result).toEqual(mockNode);
    });

    it("should query without type filter when type not provided", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ n: { id: "test" } }]),
        close: vi.fn(),
      });

      await client.getNode("", "test_id");
      expect(mockConn.query).toHaveBeenCalledWith(
        expect.not.stringContaining(":"),
      );
    });

    it("should handle query errors gracefully", async () => {
      mockConn.query.mockRejectedValue(new Error("Query failed"));

      const result = await client.getNode("Article", "article_1");
      expect(result).toBeNull();
    });

    it("should handle missing n property in result", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ id: "article_1" }]),
        close: vi.fn(),
      });

      const result = await client.getNode("Article", "article_1");
      expect(result).toEqual({ id: "article_1" });
    });
  });

  describe("getNodesByType", () => {
    beforeEach(async () => {
      await client.initialize();
      client.conn = mockConn;
    });

    it("should throw error when not initialized", async () => {
      const noConnClient = new GraphClient("/test/db");
      await expect(noConnClient.getNodesByType("Article")).rejects.toThrow(
        "Connection not initialized",
      );
    });

    it("should return all nodes of a type", async () => {
      const mockNodes = [
        { id: "article_1", title: "Article 1" },
        { id: "article_2", title: "Article 2" },
      ];
      mockConn.query.mockResolvedValue({
        getAll: vi
          .fn()
          .mockResolvedValue([{ n: mockNodes[0] }, { n: mockNodes[1] }]),
        close: vi.fn(),
      });

      const result = await client.getNodesByType("Article");
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("article_1");
    });

    it("should handle query errors gracefully", async () => {
      mockConn.query.mockRejectedValue(new Error("Query failed"));

      const result = await client.getNodesByType("Article");
      expect(result).toEqual([]);
    });

    it("should handle missing n property in results", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi
          .fn()
          .mockResolvedValue([{ id: "article_1" }, { id: "article_2" }]),
        close: vi.fn(),
      });

      const result = await client.getNodesByType("Article");
      expect(result).toHaveLength(2);
    });
  });
});
