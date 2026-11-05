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

  describe("query", () => {
    beforeEach(async () => {
      await client.initialize();
      client.conn = mockConn;
    });

    it("should throw error when not initialized", async () => {
      const noConnClient = new GraphClient("/test/db");
      await expect(noConnClient.query("MATCH (n) RETURN n")).rejects.toThrow(
        "Connection not initialized",
      );
    });

    it("should execute query without params", async () => {
      const mockRows = [{ id: "1" }, { id: "2" }];
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue(mockRows),
        close: vi.fn(),
      });

      const result = await client.query("MATCH (n) RETURN n");
      expect(result).toEqual(mockRows);
    });

    it("should execute query with params", async () => {
      const mockRows = [{ id: "1" }];
      mockConn.queryWithParams.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue(mockRows),
        close: vi.fn(),
      });

      const result = await client.query("MATCH (n) WHERE n.id = $id", ["id"]);
      expect(mockConn.queryWithParams).toHaveBeenCalledWith(
        "MATCH (n) WHERE n.id = $id",
        ["id"],
      );
      expect(result).toEqual(mockRows);
    });

    it("should handle query errors", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([]),
        close: vi.fn(),
        err: new Error("Query error"),
      });

      await expect(client.query("INVALID QUERY")).rejects.toThrow();
    });

    it("should close result when close function exists", async () => {
      const closeSpy = vi.fn();
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([]),
        close: closeSpy,
      });

      await client.query("MATCH (n) RETURN n");
      expect(closeSpy).toHaveBeenCalled();
    });

    it("should handle getAll returning null", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue(null),
        close: vi.fn(),
      });

      const result = await client.query("MATCH (n) RETURN n");
      expect(result).toEqual([]);
    });
  });

  describe("countNodes", () => {
    beforeEach(async () => {
      await client.initialize();
      client.conn = mockConn;
    });

    it("should throw error when not initialized", async () => {
      const noConnClient = new GraphClient("/test/db");
      await expect(noConnClient.countNodes()).rejects.toThrow(
        "Connection not initialized",
      );
    });

    it("should count all nodes when type not provided", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ count: 100 }]),
        close: vi.fn(),
      });

      const result = await client.countNodes();
      expect(result).toBe(100);
    });

    it("should count nodes by type", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ count: 50 }]),
        close: vi.fn(),
      });

      const result = await client.countNodes("Article");
      expect(result).toBe(50);
      expect(mockConn.query).toHaveBeenCalledWith(
        expect.stringContaining("(n:Article)"),
      );
    });

    it("should handle missing count in result", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{}]),
        close: vi.fn(),
      });

      const result = await client.countNodes("Article");
      expect(result).toBe(0);
    });
  });

  describe("countEdges", () => {
    beforeEach(async () => {
      await client.initialize();
      client.conn = mockConn;
    });

    it("should throw error when not initialized", async () => {
      const noConnClient = new GraphClient("/test/db");
      await expect(noConnClient.countEdges()).rejects.toThrow(
        "Connection not initialized",
      );
    });

    it("should count all edges when type not provided", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ count: 200 }]),
        close: vi.fn(),
      });

      const result = await client.countEdges();
      expect(result).toBe(200);
    });

    it("should count known edge types with schema", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ count: 25 }]),
        close: vi.fn(),
      });

      const result = await client.countEdges("HAS_CHAPTER");
      expect(result).toBe(25);
      expect(mockConn.query).toHaveBeenCalledWith(
        expect.stringContaining("(:Part)-[r:HAS_CHAPTER]->(:Chapter)"),
      );
    });

    it("should count BELONGS_TO edges as sum of variants", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ count: 10 }]),
        close: vi.fn(),
      });

      const result = await client.countEdges("BELONGS_TO");
      expect(result).toBe(30); // 10 * 3 variants
    });

    it("should count generic edge types", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ count: 15 }]),
        close: vi.fn(),
      });

      const result = await client.countEdges("CUSTOM_EDGE");
      expect(result).toBe(15);
    });

    it("should handle bigint counts", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ count: BigInt(100) }]),
        close: vi.fn(),
      });

      const result = await client.countEdges("HAS_CHAPTER");
      expect(result).toBe(100);
    });

    it("should handle null counts", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ count: null }]),
        close: vi.fn(),
      });

      const result = await client.countEdges("CUSTOM_EDGE");
      expect(result).toBe(0);
    });

    it("should handle empty result", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([]),
        close: vi.fn(),
      });

      const result = await client.countEdges("CUSTOM_EDGE");
      expect(result).toBe(0);
    });
  });
});
