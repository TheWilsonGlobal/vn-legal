import { describe, it, expect, beforeEach } from "vitest";
import {
  ConGraphStorageAdapter,
  createStorageAdapter,
} from "../../../../src/storage-adapters/congraph-rag-adapter";
import { createMockContext } from "./congraph-fixtures";

describe("ConGraphStorageAdapter graph traversal and relations", () => {
  let mockGraph: any;
  let mockVectorStore: any;
  let adapter: ConGraphStorageAdapter;

  beforeEach(() => {
    const ctx = createMockContext();
    mockGraph = ctx.mockGraph;
    mockVectorStore = ctx.mockVectorStore;
    adapter = ctx.adapter;
  });

  describe("loadEntityGraph", () => {
    it("should return article nodes and undirected reference edges once each", async () => {
      mockGraph.getNodesByType.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
      mockGraph.getOutgoingEdges.mockImplementation(async (id: string) =>
        id === "a1"
          ? [
              { from: "a1", to: "a2", weight: 2 },
              { from: "a1", to: "x9", weight: 1 },
            ]
          : [{ from: "a2", to: "a1", weight: 2 }],
      );
      const graph = await adapter.loadEntityGraph();
      expect(graph.nodes).toEqual(["a1", "a2"]);
      expect(graph.edges).toEqual([{ source: "a1", target: "a2", weight: 2 }]);
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
