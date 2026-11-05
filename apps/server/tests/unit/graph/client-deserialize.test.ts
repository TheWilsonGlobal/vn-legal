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

  describe("deserializeNode", () => {
    beforeEach(async () => {
      await client.initialize();
      client.conn = mockConn;
    });

    it("should deserialize JSON string clauses", async () => {
      const mockNode = {
        id: "article_1",
        clauses: '[{"id":"c1"},{"id":"c2"}]',
      };
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ n: mockNode }]),
        close: vi.fn(),
      });

      const result = await client.getNode("Article", "article_1");
      expect(Array.isArray(result?.clauses)).toBe(true);
      expect(result?.clauses).toHaveLength(2);
    });

    it("should deserialize JSON string points", async () => {
      const mockNode = {
        id: "clause_1",
        points: '[{"id":"p1"},{"id":"p2"}]',
      };
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ n: mockNode }]),
        close: vi.fn(),
      });

      const result = await client.getNode("Clause", "clause_1");
      expect(Array.isArray(result?.points)).toBe(true);
    });

    it("should deserialize JSON string keywords", async () => {
      const mockNode = {
        id: "article_1",
        keywords: '["keyword1","keyword2"]',
      };
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ n: mockNode }]),
        close: vi.fn(),
      });

      const result = await client.getNode("Article", "article_1");
      expect(Array.isArray(result?.keywords)).toBe(true);
    });

    it("should deserialize JSON string metadata", async () => {
      const mockNode = {
        id: "article_1",
        metadata: '{"part":"P1","chapter":"C1"}',
      };
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ n: mockNode }]),
        close: vi.fn(),
      });

      const result = await client.getNode("Article", "article_1");
      expect(typeof result?.metadata).toBe("object");
      expect(result?.metadata.part).toBe("P1");
    });

    it("should handle invalid JSON gracefully", async () => {
      const mockNode = {
        id: "article_1",
        clauses: "invalid json",
      };
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ n: mockNode }]),
        close: vi.fn(),
      });

      const result = await client.getNode("Article", "article_1");
      expect(Array.isArray(result?.clauses)).toBe(true);
      expect(result?.clauses).toHaveLength(0);
    });

    it("should deserialize name_variants", async () => {
      const mockNode = {
        id: "concept_1",
        name_variants: '["variant1","variant2"]',
      };
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ n: mockNode }]),
        close: vi.fn(),
      });

      const result = await client.getNode("LegalConcept", "concept_1");
      expect(Array.isArray(result?.name_variants)).toBe(true);
    });

    it("should deserialize source_articles and source_clauses", async () => {
      const mockNode = {
        id: "concept_1",
        source_articles: '["a1","a2"]',
        source_clauses: '["c1","c2"]',
      };
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ n: mockNode }]),
        close: vi.fn(),
      });

      const result = await client.getNode("LegalConcept", "concept_1");
      expect(Array.isArray(result?.source_articles)).toBe(true);
      expect(Array.isArray(result?.source_clauses)).toBe(true);
    });

    it("should deserialize related_concepts", async () => {
      const mockNode = {
        id: "concept_1",
        related_concepts: '["concept2","concept3"]',
      };
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ n: mockNode }]),
        close: vi.fn(),
      });

      const result = await client.getNode("LegalConcept", "concept_1");
      expect(Array.isArray(result?.related_concepts)).toBe(true);
    });

    it("should handle invalid JSON for source_clauses", async () => {
      const mockNode = {
        id: "concept_1",
        source_clauses: "invalid json string",
      };
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ n: mockNode }]),
        close: vi.fn(),
      });

      const result = await client.getNode("LegalConcept", "concept_1");
      expect(Array.isArray(result?.source_clauses)).toBe(true);
      expect(result?.source_clauses).toEqual([]);
    });

    it("should handle invalid JSON for related_concepts", async () => {
      const mockNode = {
        id: "concept_1",
        related_concepts: "also invalid json",
      };
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ n: mockNode }]),
        close: vi.fn(),
      });

      const result = await client.getNode("LegalConcept", "concept_1");
      expect(Array.isArray(result?.related_concepts)).toBe(true);
      expect(result?.related_concepts).toEqual([]);
    });

    it("should not deserialize non-string properties", async () => {
      const mockNode = {
        id: "article_1",
        clauses: [{ id: "c1" }],
        keywords: ["keyword1"],
      };
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ n: mockNode }]),
        close: vi.fn(),
      });

      const result = await client.getNode("Article", "article_1");
      expect(result?.clauses).toEqual([{ id: "c1" }]);
      expect(result?.keywords).toEqual(["keyword1"]);
    });
  });
});
