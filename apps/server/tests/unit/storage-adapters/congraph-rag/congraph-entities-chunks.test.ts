import { describe, it, expect, beforeEach } from "vitest";
import type { ConGraphStorageAdapter } from "../../../../src/storage-adapters/congraph-rag-adapter";
import { createMockContext } from "./congraph-fixtures";

describe("ConGraphStorageAdapter entities and chunks", () => {
  let mockGraph: any;
  let mockVectorStore: any;
  let adapter: ConGraphStorageAdapter;

  beforeEach(() => {
    const ctx = createMockContext();
    mockGraph = ctx.mockGraph;
    mockVectorStore = ctx.mockVectorStore;
    adapter = ctx.adapter;
  });

  describe("saveEntity", () => {
    it("should add entity as node in graph", async () => {
      await adapter.saveEntity({
        id: "e1",
        name: "Entity 1",
        type: "Article",
        description: "Desc",
        metadata: {},
      });
      expect(mockGraph.addNode).toHaveBeenCalledWith(
        "Article",
        "e1",
        expect.objectContaining({ name: "Entity 1" }),
      );
    });

    it("should throw on graph error", async () => {
      mockGraph.addNode.mockRejectedValue(new Error("Graph error"));
      await expect(
        adapter.saveEntity({ id: "e1", name: "E", type: "T", description: "" }),
      ).rejects.toThrow("Graph error");
    });
  });

  describe("getEntity", () => {
    it("should return entity from graph article", async () => {
      mockGraph.getFullArticle.mockResolvedValue({
        id: "article_1",
        title: "Điều 1",
        content: "Content",
        article_number: 1,
        keywords: ["kw"],
        metadata: { part: "P1" },
      });
      const entity = await adapter.getEntity("article_1");
      expect(entity).not.toBeNull();
      expect(entity!.id).toBe("article_1");
      expect(entity!.name).toBe("Điều 1");
      expect(entity!.type).toBe("Article");
    });

    it("should return null when article not found", async () => {
      mockGraph.getFullArticle.mockResolvedValue(null);
      const entity = await adapter.getEntity("nonexistent");
      expect(entity).toBeNull();
    });

    it("should return null on error", async () => {
      mockGraph.getFullArticle.mockRejectedValue(new Error("DB error"));
      const entity = await adapter.getEntity("error_id");
      expect(entity).toBeNull();
    });
  });

  describe("searchEntities", () => {
    it("should search and rank entities by keyword score", async () => {
      mockGraph.getNodesByType.mockResolvedValue([
        {
          id: "a1",
          title: "Hợp đồng mua bán",
          content: "hợp đồng chi tiết",
          keywords: "hợp đồng",
        },
        {
          id: "a2",
          title: "Thừa kế",
          content: "quy định thừa kế",
          keywords: "",
        },
      ]);
      const results = await adapter.searchEntities("hợp đồng", 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("a1");
    });

    it("should return empty array for empty keywords", async () => {
      const results = await adapter.searchEntities("", 10);
      expect(results).toHaveLength(0);
    });

    it("should return empty array on error", async () => {
      mockGraph.getNodesByType.mockRejectedValue(new Error("fail"));
      const results = await adapter.searchEntities("test", 10);
      expect(results).toHaveLength(0);
    });

    it("should respect limit", async () => {
      const nodes = Array.from({ length: 20 }, (_, i) => ({
        id: `a${i}`,
        title: `test article ${i}`,
        content: "test",
        keywords: "test",
      }));
      mockGraph.getNodesByType.mockResolvedValue(nodes);
      const results = await adapter.searchEntities("test", 5);
      expect(results).toHaveLength(5);
    });
  });

  describe("searchEntitiesByEmbedding", () => {
    it("should search vector store and normalize scores", async () => {
      mockVectorStore.searchArticles.mockResolvedValue([
        { article_id: "a1", title: "Article 1", content: "C1", score: 73.02 },
      ]);
      const results = await adapter.searchEntitiesByEmbedding([0.1, 0.2], 5);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("a1");
      // Score > 1 should be normalized to <= 1
      expect(results[0].metadata?.score).toBeLessThanOrEqual(1.0);
    });

    it("should handle scores <= 1 without normalization", async () => {
      mockVectorStore.searchArticles.mockResolvedValue([
        { article_id: "a1", title: "A1", content: "C", score: 0.85 },
      ]);
      const results = await adapter.searchEntitiesByEmbedding([0.1], 5);
      expect(results[0].metadata?.score).toBe(0.85);
    });

    it("should handle _score field", async () => {
      mockVectorStore.searchArticles.mockResolvedValue([
        { id: "a1", name: "A1", description: "D", _score: 0.9 },
      ]);
      const results = await adapter.searchEntitiesByEmbedding([0.1], 5);
      expect(results[0].metadata?.score).toBe(0.9);
    });

    it("should return empty on error", async () => {
      mockVectorStore.searchArticles.mockRejectedValue(new Error("fail"));
      const results = await adapter.searchEntitiesByEmbedding([0.1], 5);
      expect(results).toHaveLength(0);
    });
  });

  describe("saveChunk", () => {
    it("should add chunk as Clause node", async () => {
      await adapter.saveChunk({
        id: "c1",
        content: "Chunk text",
        sourceId: "article_1",
        sequenceOrder: 0,
      });
      expect(mockGraph.addNode).toHaveBeenCalledWith(
        "Clause",
        "c1",
        expect.objectContaining({ text: "Chunk text" }),
      );
    });

    it("should throw on error", async () => {
      mockGraph.addNode.mockRejectedValue(new Error("fail"));
      await expect(
        adapter.saveChunk({
          id: "c1",
          content: "",
          sourceId: "",
          sequenceOrder: 0,
        }),
      ).rejects.toThrow();
    });
  });

  describe("getChunksByEntity", () => {
    it("should return clauses as chunks", async () => {
      mockGraph.getFullArticle.mockResolvedValue({
        id: "article_1",
        clauses: [
          { id: "c1", text: "Clause 1 text", points: [] },
          { id: "c2", text: "Clause 2 text", points: [] },
        ],
      });
      const chunks = await adapter.getChunksByEntity("article_1");
      expect(chunks).toHaveLength(2);
      expect(chunks[0].content).toBe("Clause 1 text");
      expect(chunks[1].sequenceOrder).toBe(1);
    });

    it("should return empty array if article not found", async () => {
      mockGraph.getFullArticle.mockResolvedValue(null);
      const chunks = await adapter.getChunksByEntity("nonexistent");
      expect(chunks).toHaveLength(0);
    });

    it("should return empty array on error", async () => {
      mockGraph.getFullArticle.mockRejectedValue(new Error("fail"));
      const chunks = await adapter.getChunksByEntity("error");
      expect(chunks).toHaveLength(0);
    });
  });

  describe("getChunk", () => {
    it("should map a Clause node to a chunk", async () => {
      mockGraph.getNode.mockResolvedValue({
        id: "c1",
        text: "Clause text",
        article_id: "a1",
        sequence_order: 2,
      });
      await expect(adapter.getChunk("c1")).resolves.toEqual({
        id: "c1",
        content: "Clause text",
        sourceId: "a1",
        sequenceOrder: 2,
      });
      expect(mockGraph.getNode).toHaveBeenCalledWith("Clause", "c1");
    });

    it("should return null when the clause is missing", async () => {
      mockGraph.getNode.mockResolvedValue(null);
      await expect(adapter.getChunk("missing")).resolves.toBeNull();
    });
  });

  describe("searchChunks", () => {
    it("should rank clauses by keyword hits and respect the limit", async () => {
      mockGraph.getNodesByType.mockResolvedValue([
        {
          id: "c1",
          text: "hợp đồng mua bán",
          article_id: "a1",
          sequence_order: 0,
        },
        {
          id: "c2",
          text: "hợp đồng và thừa kế",
          article_id: "a2",
          sequence_order: 0,
        },
        {
          id: "c3",
          text: "không liên quan",
          article_id: "a3",
          sequence_order: 0,
        },
      ]);
      const results = await adapter.searchChunks("hợp đồng mua", 1);
      expect(results.map((c) => c.id)).toEqual(["c1"]);
    });

    it("should return empty for queries with no usable keywords", async () => {
      await expect(adapter.searchChunks("a", 5)).resolves.toEqual([]);
    });
  });

  describe("saveDocument", () => {
    it("should not throw (no-op)", async () => {
      await expect(
        adapter.saveDocument({ id: "d1", content: "doc" } as any),
      ).resolves.toBeUndefined();
    });
  });
});
