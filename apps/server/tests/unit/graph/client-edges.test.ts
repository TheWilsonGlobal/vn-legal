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

  describe("getOutgoingEdges", () => {
    beforeEach(async () => {
      await client.initialize();
      client.conn = mockConn;
    });

    it("should throw error when not initialized", async () => {
      const noConnClient = new GraphClient("/test/db");
      await expect(noConnClient.getOutgoingEdges("article_1")).rejects.toThrow(
        "Connection not initialized",
      );
    });

    it("should return outgoing edges", async () => {
      const mockEdges = [
        { r: { _type: "REFERENCES", _to: "article_2" }, toId: "article_2" },
      ];
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue(mockEdges),
        close: vi.fn(),
      });

      const result = await client.getOutgoingEdges("article_1");
      expect(result).toHaveLength(1);
      expect(result[0].from).toBe("article_1");
      expect(result[0].to).toBe("article_2");
    });

    it("should filter by edge type when provided", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([]),
        close: vi.fn(),
      });

      await client.getOutgoingEdges("article_1", "REFERENCES");
      expect(mockConn.query).toHaveBeenCalledWith(
        expect.stringContaining("[r:REFERENCES]"),
      );
    });

    it("should handle missing toId", async () => {
      const mockEdges = [{ r: { _type: "REFERENCES", _to: "article_2" } }];
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue(mockEdges),
        close: vi.fn(),
      });

      const result = await client.getOutgoingEdges("article_1");
      expect(result[0].to).toBe("article_2");
    });

    it("should handle query errors gracefully", async () => {
      mockConn.query.mockRejectedValue(new Error("Query failed"));

      const result = await client.getOutgoingEdges("article_1");
      expect(result).toEqual([]);
    });

    it("should set default weight", async () => {
      const mockEdges = [{ r: { _type: "REFERENCES" }, toId: "article_2" }];
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue(mockEdges),
        close: vi.fn(),
      });

      const result = await client.getOutgoingEdges("article_1");
      expect(result[0].weight).toBe(1.0);
    });
  });

  describe("getIncomingEdges", () => {
    beforeEach(async () => {
      await client.initialize();
      client.conn = mockConn;
    });

    it("should throw error when not initialized", async () => {
      const noConnClient = new GraphClient("/test/db");
      await expect(noConnClient.getIncomingEdges("article_1")).rejects.toThrow(
        "Connection not initialized",
      );
    });

    it("should return incoming edges", async () => {
      const mockEdges = [
        { r: { _type: "REFERENCES", _from: "article_2" }, fromId: "article_2" },
      ];
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue(mockEdges),
        close: vi.fn(),
      });

      const result = await client.getIncomingEdges("article_1");
      expect(result).toHaveLength(1);
      expect(result[0].to).toBe("article_1");
      expect(result[0].from).toBe("article_2");
    });

    it("should filter by edge type when provided", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([]),
        close: vi.fn(),
      });

      await client.getIncomingEdges("article_1", "REFERENCED_BY");
      expect(mockConn.query).toHaveBeenCalledWith(
        expect.stringContaining("[r:REFERENCED_BY]"),
      );
    });

    it("should handle missing fromId", async () => {
      const mockEdges = [{ r: { _type: "REFERENCED_BY", _from: "article_2" } }];
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue(mockEdges),
        close: vi.fn(),
      });

      const result = await client.getIncomingEdges("article_1");
      expect(result[0].from).toBe("article_2");
    });

    it("should handle query errors gracefully", async () => {
      mockConn.query.mockRejectedValue(new Error("Query failed"));

      const result = await client.getIncomingEdges("article_1");
      expect(result).toEqual([]);
    });
  });
});
