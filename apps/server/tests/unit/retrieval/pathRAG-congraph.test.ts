import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PathRAG,
  createPathRAG,
} from "../../../src/retrieval/pathRAG-congraph";

describe("PathRAG", () => {
  let mockGraph: any;
  let mockStorage: any;
  let storage: any;
  let pathRAG: PathRAG;

  beforeEach(() => {
    mockGraph = {
      getFullArticle: vi.fn(),
      getNodesByType: vi.fn().mockResolvedValue([]),
      getOutgoingEdges: vi.fn().mockResolvedValue([]),
      getIncomingEdges: vi.fn().mockResolvedValue([]),
      query: vi.fn(),
    };
    mockStorage = {
      graph: mockGraph,
      searchEntities: vi.fn().mockResolvedValue([]),
      findPaths: vi.fn().mockResolvedValue([]),
    };
    storage = mockStorage;
    pathRAG = createPathRAG(storage);
  });

  describe("traverseReferences", () => {
    it("should find seeds and traverse BFS", async () => {
      // Mock getNodesByType to return articles matching keyword "test"
      mockGraph.getNodesByType.mockResolvedValue([
        {
          id: "a1",
          title: "Test keyword",
          content: "some content",
          keywords: "",
        },
        { id: "a3", title: "unrelated", content: "nothing here", keywords: "" },
      ]);
      // Mock REFERENCES edges from a1 -> a2
      mockGraph.getOutgoingEdges.mockImplementation(
        (id: string, type: string) => {
          if (id === "a1" && type === "REFERENCES") return [{ to: "a2" }];
          return [];
        },
      );

      mockGraph.getFullArticle.mockImplementation((id: string) => {
        if (id === "a1")
          return {
            id: "a1",
            article_number: 1,
            title: "Test keyword",
            content: "",
            clauses: [],
            metadata: {},
            keywords: [],
            hierarchical_path: "",
            clause_count: 0,
          };
        if (id === "a2")
          return {
            id: "a2",
            article_number: 2,
            title: "Referenced",
            content: "",
            clauses: [],
            metadata: {},
            keywords: [],
            hierarchical_path: "",
            clause_count: 0,
          };
        return null;
      });

      const result = await pathRAG.traverseReferences("Test keyword article");
      expect(result).toHaveLength(2);
      expect(result[0].article.id).toBe("a1");
      expect(result[1].article.id).toBe("a2");
      expect(result[1].depth).toBe(1);
    });

    it("should return empty for no seeds", async () => {
      const result = await pathRAG.traverseReferences("nonexistent");
      expect(result).toHaveLength(0);
    });
  });

  describe("findPath", () => {
    it("should find shortest path", async () => {
      mockGraph.getOutgoingEdges.mockImplementation(
        (id: string, type: string) => {
          if (id === "a1") return [{ to: "a2" }];
          if (id === "a2") return [{ to: "a3" }];
          return [];
        },
      );

      const path = await pathRAG.findPath("a1", "a3");
      expect(path).toEqual(["a1", "a2", "a3"]);
    });

    it("should use incoming edges for backward search", async () => {
      mockGraph.getIncomingEdges.mockImplementation(
        (id: string, type: string) => {
          if (id === "a2") return [{ from: "a1" }];
          return [];
        },
      );
      const path = await pathRAG.findPath("a2", "a1");
      expect(path).toEqual(["a2", "a1"]);
    });
  });

  describe("getReferencingArticles", () => {
    it("should return articles that reference the given ID", async () => {
      mockGraph.getIncomingEdges.mockResolvedValue([{ from: "a1" }]);
      mockGraph.getFullArticle.mockResolvedValue({ id: "a1" });
      const result = await pathRAG.getReferencingArticles("a2");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a1");
    });
  });

  describe("getReferenceContext", () => {
    it("should return formatted context", async () => {
      mockGraph.getIncomingEdges.mockResolvedValue([
        { from: "a1", context: "ctx", reference_text: "text" },
      ]);
      mockGraph.getFullArticle.mockResolvedValue({ id: "a1" });
      const result = await pathRAG.getReferenceContext("a2");
      expect(result[0].context).toBe("ctx");
      expect(result[0].fromArticle.id).toBe("a1");
    });
  });

  describe("traverseReferencesStream", () => {
    it("should yield article strings", async () => {
      vi.spyOn(pathRAG, "traverseReferences").mockResolvedValue([
        { article: { article_number: 1, title: "T1" } } as any,
      ]);
      const chunks = [];
      for await (const chunk of pathRAG.traverseReferencesStream("q")) {
        chunks.push(chunk);
      }
      expect(chunks[0]).toContain("Điều 1: T1");
    });
  });
});
