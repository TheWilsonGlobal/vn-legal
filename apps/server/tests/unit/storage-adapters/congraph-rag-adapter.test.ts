import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ConGraphStorageAdapter,
  createStorageAdapter,
} from "../../../src/storage-adapters/congraph-rag-adapter";

// Mock logger
vi.mock("../../../src/shared/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("ConGraphStorageAdapter", () => {
  let mockGraph: any;
  let mockVectorStore: any;
  let adapter: ConGraphStorageAdapter;

  beforeEach(() => {
    mockGraph = {
      addNode: vi.fn().mockResolvedValue(undefined),
      getFullArticle: vi.fn(),
      getNode: vi.fn(),
      getNodesByType: vi.fn().mockResolvedValue([]),
      addEdge: vi.fn().mockResolvedValue(undefined),
      getOutgoingEdges: vi.fn().mockResolvedValue([]),
      getIncomingEdges: vi.fn().mockResolvedValue([]),
    };
    mockVectorStore = {
      searchArticles: vi.fn().mockResolvedValue([]),
      searchClauses: vi.fn().mockResolvedValue([]),
      searchCommunityReports: vi.fn().mockResolvedValue([]),
    };
    adapter = new ConGraphStorageAdapter(mockGraph, mockVectorStore);
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
      expect(results[0].metadata.score).toBeLessThanOrEqual(1.0);
    });

    it("should handle scores <= 1 without normalization", async () => {
      mockVectorStore.searchArticles.mockResolvedValue([
        { article_id: "a1", title: "A1", content: "C", score: 0.85 },
      ]);
      const results = await adapter.searchEntitiesByEmbedding([0.1], 5);
      expect(results[0].metadata.score).toBe(0.85);
    });

    it("should handle _score field", async () => {
      mockVectorStore.searchArticles.mockResolvedValue([
        { id: "a1", name: "A1", description: "D", _score: 0.9 },
      ]);
      const results = await adapter.searchEntitiesByEmbedding([0.1], 5);
      expect(results[0].metadata.score).toBe(0.9);
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

  describe("saveFact", () => {
    it("should not throw (no-op)", async () => {
      await expect(
        adapter.saveFact({
          id: "f1",
          chunkId: "c1",
          content: "fact",
          metadata: {},
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("saveCommunity", () => {
    it("should add community as node", async () => {
      await adapter.saveCommunity({
        id: "comm_1",
        level: 0,
        title: "Community",
        summary: "Summary",
        parentId: undefined,
        entityIds: ["e1", "e2"],
      });
      expect(mockGraph.addNode).toHaveBeenCalledWith(
        "Community",
        "comm_1",
        expect.objectContaining({
          title: "Community",
          findings: "e1,e2",
        }),
      );
    });

    it("should throw on error", async () => {
      mockGraph.addNode.mockRejectedValue(new Error("fail"));
      await expect(
        adapter.saveCommunity({
          id: "c",
          level: 0,
          title: "",
          summary: "",
          entityIds: [],
        }),
      ).rejects.toThrow();
    });
  });

  describe("getCommunity", () => {
    it("should return community from node", async () => {
      mockGraph.getNode.mockResolvedValue({
        id: "comm_1",
        level: 0,
        title: "Community",
        summary: "S",
        parent_id: "p1",
        findings: "e1,e2",
      });
      const community = await adapter.getCommunity("comm_1");
      expect(community).not.toBeNull();
      expect(community!.entityIds).toEqual(["e1", "e2"]);
    });

    it("should return null when not found", async () => {
      mockGraph.getNode.mockResolvedValue(null);
      expect(await adapter.getCommunity("x")).toBeNull();
    });

    it("should return null on error", async () => {
      mockGraph.getNode.mockRejectedValue(new Error("fail"));
      expect(await adapter.getCommunity("x")).toBeNull();
    });
  });

  describe("getCommunitiesByLevel", () => {
    it("should filter communities by level", async () => {
      mockGraph.getNodesByType.mockResolvedValue([
        { id: "c1", level: 0, title: "L0", summary: "S", findings: "e1" },
        { id: "c2", level: 1, title: "L1", summary: "S", findings: "e2" },
        { id: "c3", level: 0, title: "L0-2", summary: "S", findings: "e3" },
      ]);
      const communities = await adapter.getCommunitiesByLevel(0);
      expect(communities).toHaveLength(2);
    });

    it("should return empty on error", async () => {
      mockGraph.getNodesByType.mockRejectedValue(new Error("fail"));
      expect(await adapter.getCommunitiesByLevel(0)).toHaveLength(0);
    });
  });

  describe("searchCommunityReports", () => {
    it("should search and map results", async () => {
      mockVectorStore.searchCommunityReports.mockResolvedValue([
        {
          id: "r1",
          level: 0,
          title: "Report",
          summary: "S",
          findings: "F",
          rating: 8,
          score: 0.9,
        },
      ]);
      const results = await adapter.searchCommunityReports([0.1], 5);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Report");
    });

    it("should return empty on error", async () => {
      mockVectorStore.searchCommunityReports.mockRejectedValue(
        new Error("fail"),
      );
      expect(await adapter.searchCommunityReports([0.1], 5)).toHaveLength(0);
    });
  });

  describe("saveDocument", () => {
    it("should not throw (no-op)", async () => {
      await expect(
        adapter.saveDocument({ id: "d1", content: "doc" } as any),
      ).resolves.toBeUndefined();
    });
  });

  describe("linkEntities", () => {
    it("should add edge between entities", async () => {
      await adapter.linkEntities("e1", "e2", "REFERENCES", 1.0, {
        context: "test",
      });
      expect(mockGraph.addEdge).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "e1",
          to: "e2",
          type: "REFERENCES",
          weight: 1.0,
          context: "test",
        }),
      );
    });

    it("should throw on error", async () => {
      mockGraph.addEdge.mockRejectedValue(new Error("fail"));
      await expect(
        adapter.linkEntities("e1", "e2", "R", 1.0),
      ).rejects.toThrow();
    });
  });

  describe("linkChunkToEntity", () => {
    it("should add HAS_CLAUSE edge", async () => {
      await adapter.linkChunkToEntity("c1", "e1");
      expect(mockGraph.addEdge).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "e1",
          to: "c1",
          type: "HAS_CLAUSE",
        }),
      );
    });

    it("should not throw on error", async () => {
      mockGraph.addEdge.mockRejectedValue(new Error("fail"));
      await expect(
        adapter.linkChunkToEntity("c1", "e1"),
      ).resolves.toBeUndefined();
    });
  });

  describe("linkCommunityToEntity", () => {
    it("should add BELONGS_TO_COMMUNITY edge", async () => {
      await adapter.linkCommunityToEntity("comm1", "e1");
      expect(mockGraph.addEdge).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "BELONGS_TO_COMMUNITY",
        }),
      );
    });

    it("should not throw on error", async () => {
      mockGraph.addEdge.mockRejectedValue(new Error("fail"));
      await expect(
        adapter.linkCommunityToEntity("c", "e"),
      ).resolves.toBeUndefined();
    });
  });

  describe("linkCommunityToCommunity", () => {
    it("should add CONTAINS edge", async () => {
      await adapter.linkCommunityToCommunity("child", "parent");
      expect(mockGraph.addEdge).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "child",
          to: "parent",
          type: "CONTAINS",
        }),
      );
    });
  });

  describe("linkChunkToFact", () => {
    it("should not throw (no-op)", async () => {
      await expect(
        adapter.linkChunkToFact("c1", "f1"),
      ).resolves.toBeUndefined();
    });
  });

  describe("getNeighbors", () => {
    it("should return neighbors and relations", async () => {
      mockGraph.getOutgoingEdges.mockResolvedValue([
        { from: "e1", to: "e2", _type: "REFERENCES", weight: 1.0 },
      ]);
      mockGraph.getFullArticle.mockResolvedValue({
        id: "e2",
        title: "Điều 2",
        content: "Content",
        article_number: 2,
        keywords: [],
        metadata: {},
      });
      const result = await adapter.getNeighbors("e1", 1);
      expect(result.entities).toHaveLength(1);
      expect(result.relations).toHaveLength(1);
      expect(result.relations[0].type).toBe("REFERENCES");
    });

    it("should handle missing neighbor entity", async () => {
      mockGraph.getOutgoingEdges.mockResolvedValue([
        { from: "e1", to: "e_missing", _type: "REF", weight: 1.0 },
      ]);
      mockGraph.getFullArticle.mockResolvedValue(null);
      const result = await adapter.getNeighbors("e1", 1);
      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(1);
    });

    it("should return empty on error", async () => {
      mockGraph.getOutgoingEdges.mockRejectedValue(new Error("fail"));
      const result = await adapter.getNeighbors("e1", 1);
      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(0);
    });
  });

  describe("searchRelationships", () => {
    it("should return empty array (not implemented)", async () => {
      const results = await adapter.searchRelationships("test", 10);
      expect(results).toHaveLength(0);
    });
  });

  describe("searchRelationshipsByEmbedding", () => {
    it("should return empty array (not implemented)", async () => {
      const results = await adapter.searchRelationshipsByEmbedding([0.1], 10);
      expect(results).toHaveLength(0);
    });
  });

  describe("getHierarchicalParent", () => {
    it("should return parent from incoming edges", async () => {
      mockGraph.getIncomingEdges.mockResolvedValue([
        { from: "parent_1", to: "child_1" },
      ]);
      const parent = await adapter.getHierarchicalParent("child_1", "entity");
      expect(parent).toBe("parent_1");
    });

    it("should return null when no incoming edges", async () => {
      mockGraph.getIncomingEdges.mockResolvedValue([]);
      const parent = await adapter.getHierarchicalParent("orphan", "entity");
      expect(parent).toBeNull();
    });

    it("should return null on error", async () => {
      mockGraph.getIncomingEdges.mockRejectedValue(new Error("fail"));
      const parent = await adapter.getHierarchicalParent("x", "entity");
      expect(parent).toBeNull();
    });
  });

  describe("findPaths", () => {
    it("should find paths via BFS", async () => {
      mockGraph.getOutgoingEdges
        .mockResolvedValueOnce([{ to: "b", _type: "REF" }])
        .mockResolvedValueOnce([{ to: "c", _type: "REF" }])
        .mockResolvedValue([]);
      const paths = await adapter.findPaths(["a"], { maxHops: 2 });
      expect(paths.length).toBeGreaterThan(0);
      expect(paths[0].path).toContain("a");
    });

    it("should return empty for empty source nodes", async () => {
      const paths = await adapter.findPaths([], { maxHops: 2 });
      expect(paths).toHaveLength(0);
    });

    it("should return empty on error", async () => {
      mockGraph.getOutgoingEdges.mockRejectedValue(new Error("fail"));
      const paths = await adapter.findPaths(["a"], { maxHops: 2 });
      expect(paths).toHaveLength(0);
    });

    it("should use default maxHops of 2", async () => {
      mockGraph.getOutgoingEdges.mockResolvedValue([]);
      const paths = await adapter.findPaths(["a"], {});
      expect(paths).toHaveLength(0);
    });
  });

  describe("runPageRank", () => {
    it("should return empty map (not implemented)", async () => {
      const result = await adapter.runPageRank();
      expect(result.size).toBe(0);
    });
  });

  describe("createStorageAdapter", () => {
    it("should create adapter instance", () => {
      const adapter = createStorageAdapter(mockGraph, mockVectorStore);
      expect(adapter).toBeInstanceOf(ConGraphStorageAdapter);
      expect(adapter.graph).toBe(mockGraph);
      expect(adapter.vectorStore).toBe(mockVectorStore);
    });
  });
});
