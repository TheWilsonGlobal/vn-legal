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

  describe("getStats", () => {
    beforeEach(async () => {
      await client.initialize();
      client.conn = mockConn;
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ count: 10 }]),
        close: vi.fn(),
      });
    });

    it("should throw error when not initialized", async () => {
      const noConnClient = new GraphClient("/test/db");
      await expect(noConnClient.getStats()).rejects.toThrow(
        "Connection not initialized",
      );
    });

    it("should return stats for all node types", async () => {
      const stats = await client.getStats();
      expect(stats["Article"]).toBe(10);
      expect(stats["Clause"]).toBe(10);
    });

    it("should return stats for all edge types", async () => {
      const stats = await client.getStats();
      expect(stats["edge:HAS_CHAPTER"]).toBe(10);
      expect(stats["edge:REFERENCES"]).toBe(10);
    });

    it("should include all node types", async () => {
      const stats = await client.getStats();
      const nodeTypes = [
        "Part",
        "Chapter",
        "Section",
        "Subsection",
        "Article",
        "Clause",
        "ClausePoint",
        "LegalConcept",
      ];
      for (const type of nodeTypes) {
        expect(stats).toHaveProperty(type);
      }
    });
  });
});
