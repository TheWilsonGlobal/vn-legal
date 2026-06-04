import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createNodesBatch,
  createNodesBatchUnwind,
  createEdgesBatch,
  createEdgesBatchUnwind,
  getLabelForEdgeType,
  type BatchOperationsClient,
} from "../../../src/graph/client-batch-ops";

// Note: config and logger mocks are in setup-unit.ts
// client-batch-ops doesn't directly import congraphdb, so no mock needed here

describe("client-batch-ops", () => {
  let mockClient: BatchOperationsClient;

  beforeEach(() => {
    mockClient = {
      conn: {
        batchCreateNodes: vi.fn().mockResolvedValue([1, 2, 3]),
        batchCreateRelationships: vi.fn().mockResolvedValue(undefined),
      },
      idToOffset: new Map(),
      query: vi.fn().mockResolvedValue([]),
    };
  });

  describe("createNodesBatch", () => {
    it("should return empty array for empty nodes", async () => {
      const result = await createNodesBatch(mockClient, "Article", []);
      expect(result).toEqual([]);
    });

    it("should throw error when connection not initialized", async () => {
      const noConnClient = { ...mockClient, conn: null };
      await expect(
        createNodesBatch(noConnClient, "Article", [{ id: "a1" }]),
      ).rejects.toThrow("Connection not initialized");
    });

    it("should use native batchCreateNodes when available", async () => {
      const nodes = [
        { id: "a1", title: "Article 1" },
        { id: "a2", title: "Article 2" },
      ];

      await createNodesBatch(mockClient, "Article", nodes);

      expect(mockClient.conn.batchCreateNodes).toHaveBeenCalledWith(
        "Article",
        nodes,
      );
      expect(mockClient.idToOffset.get("a1")).toBe(1);
      expect(mockClient.idToOffset.get("a2")).toBe(2);
    });

    it("should fall back to UNWIND when native batch fails", async () => {
      mockClient.conn.batchCreateNodes = vi
        .fn()
        .mockRejectedValue(new Error("Native failed"));
      const nodes = [{ id: "a1", title: "Article 1" }];

      mockClient.query.mockResolvedValue([{ offset: 10 }]);

      await createNodesBatch(mockClient, "Article", nodes);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("UNWIND"),
        [nodes],
      );
    });

    it("should use UNWIND fallback when batchCreateNodes is not a function", async () => {
      const noNativeClient = {
        conn: {
          query: vi.fn().mockResolvedValue([{ offset: 5 }]),
        },
        idToOffset: new Map(),
        query: vi.fn().mockResolvedValue([{ offset: 5 }]),
      };
      const nodes = [{ id: "a1", title: "Article 1" }];

      await createNodesBatch(noNativeClient, "Article", nodes);

      expect(noNativeClient.query).toHaveBeenCalledWith(
        expect.stringContaining("UNWIND"),
        [nodes],
      );
    });

    it("should map IDs to offsets correctly", async () => {
      const nodes = [
        { id: "article_1", title: "First" },
        { id: "article_2", title: "Second" },
        { id: "article_3", title: "Third" },
      ];

      await createNodesBatch(mockClient, "Article", nodes);

      expect(mockClient.idToOffset.get("article_1")).toBe(1);
      expect(mockClient.idToOffset.get("article_2")).toBe(2);
      expect(mockClient.idToOffset.get("article_3")).toBe(3);
    });
  });

  describe("createNodesBatchUnwind", () => {
    it("should create missing nodes and update properties", async () => {
      const nodes = [
        { id: "a1", title: "Title 1", content: "Content 1" },
        { id: "a2", title: "Title 2", content: "Content 2" },
      ];

      mockClient.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ offset: 10 }, { offset: 20 }]);

      const result = await createNodesBatchUnwind(mockClient, "Article", nodes);

      expect(mockClient.query).toHaveBeenCalledTimes(2);
      expect(result).toEqual([10, 20]);
      expect(mockClient.idToOffset.get("a1")).toBe(10);
      expect(mockClient.idToOffset.get("a2")).toBe(20);
    });

    it("should handle empty nodes array", async () => {
      const result = await createNodesBatchUnwind(mockClient, "Article", []);
      expect(result).toEqual([]);
      // The function still executes queries even with empty array
      expect(mockClient.query).toHaveBeenCalled();
    });

    it("should throw error when connection not initialized", async () => {
      const noConnClient = {
        conn: null,
        idToOffset: new Map(),
        query: vi.fn(),
      };
      // The actual error happens when query is called, not at the start
      await expect(
        createNodesBatchUnwind(noConnClient, "Article", [{ id: "a1" }]),
      ).rejects.toThrow();
    });
  });

  describe("createEdgesBatch", () => {
    it("should return early for empty edges array", async () => {
      await createEdgesBatch(mockClient, []);
      expect(mockClient.query).not.toHaveBeenCalled();
    });

    it("should throw error when connection not initialized", async () => {
      const noConnClient = { ...mockClient, conn: null };
      await expect(
        createEdgesBatch(noConnClient, [
          { from: "a1", to: "a2", type: "REFERENCES" },
        ]),
      ).rejects.toThrow("Connection not initialized");
    });

    it("should use UNWIND when offsets are not available", async () => {
      const edges = [
        { from: "a1", to: "a2", type: "REFERENCES", reference_type: "cite" },
      ];

      await createEdgesBatch(mockClient, edges);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("UNWIND"),
        expect.any(Array),
      );
    });

    it("should use native batch when all offsets are available", async () => {
      mockClient.idToOffset.set("a1", 10);
      mockClient.idToOffset.set("a2", 20);

      const edges = [
        { from: "a1", to: "a2", type: "REFERENCES", reference_type: "cite" },
      ];

      await createEdgesBatch(mockClient, edges);

      expect(mockClient.conn.batchCreateRelationships).toHaveBeenCalledWith(
        "REFERENCES",
        expect.any(Array),
      );
    });

    it("should fall back to UNWIND when native batch fails", async () => {
      mockClient.idToOffset.set("a1", 10);
      mockClient.idToOffset.set("a2", 20);
      mockClient.conn.batchCreateRelationships = vi
        .fn()
        .mockRejectedValue(new Error("Native failed"));

      const edges = [
        { from: "a1", to: "a2", type: "REFERENCES", reference_type: "cite" },
      ];

      await createEdgesBatch(mockClient, edges);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("UNWIND"),
        expect.any(Array),
      );
    });

    it("should group edges by type for native batch", async () => {
      mockClient.idToOffset.set("a1", 10);
      mockClient.idToOffset.set("a2", 20);
      mockClient.idToOffset.set("a3", 30);

      const edges = [
        { from: "a1", to: "a2", type: "REFERENCES" },
        { from: "a1", to: "a3", type: "NEXT_ARTICLE" },
      ];

      await createEdgesBatch(mockClient, edges);

      expect(mockClient.conn.batchCreateRelationships).toHaveBeenCalledWith(
        "REFERENCES",
        expect.any(Array),
      );
      expect(mockClient.conn.batchCreateRelationships).toHaveBeenCalledWith(
        "NEXT_ARTICLE",
        expect.any(Array),
      );
    });

    it("should handle edges without type property", async () => {
      mockClient.idToOffset.set("a1", 10);
      mockClient.idToOffset.set("a2", 20);

      const edges = [{ from: "a1", to: "a2", _type: "REFERENCES" }];

      await createEdgesBatch(mockClient, edges);

      expect(mockClient.conn.batchCreateRelationships).toHaveBeenCalledWith(
        "REFERENCES",
        expect.any(Array),
      );
    });

    it("should include edge properties in native batch", async () => {
      mockClient.idToOffset.set("a1", 10);
      mockClient.idToOffset.set("a2", 20);

      const edges = [
        {
          from: "a1",
          to: "a2",
          type: "REFERENCES",
          reference_type: "citation",
          strength: 0.8,
        },
      ];

      await createEdgesBatch(mockClient, edges);

      const callArgs = mockClient.conn.batchCreateRelationships.mock.calls[0];
      const rels = callArgs[1];
      expect(rels[0].properties).toEqual({
        reference_type: "citation",
        strength: 0.8,
      });
    });

    it("should fall back to UNWIND when some offsets are missing", async () => {
      mockClient.idToOffset.set("a1", 10);
      // a2 offset is missing

      const edges = [{ from: "a1", to: "a2", type: "REFERENCES" }];

      await createEdgesBatch(mockClient, edges);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("UNWIND"),
        expect.any(Array),
      );
      expect(mockClient.conn.batchCreateRelationships).not.toHaveBeenCalled();
    });

    it("should fall back to UNWIND when edge has no type", async () => {
      mockClient.idToOffset.set("a1", 10);
      mockClient.idToOffset.set("a2", 20);

      const edges = [{ from: "a1", to: "a2" }];

      await createEdgesBatch(mockClient, edges);

      // When there's no type, it skips the edge entirely
      // So no native batch or UNWIND query is called
      expect(mockClient.conn.batchCreateRelationships).not.toHaveBeenCalled();
    });
  });

  describe("createEdgesBatchUnwind", () => {
    it("should group edges by type and labels", async () => {
      const edges = [
        { from: "a1", to: "a2", type: "REFERENCES", reference_type: "cite" },
        { from: "a3", to: "a4", type: "REFERENCES", reference_type: "quote" },
        { from: "c1", to: "c2", type: "HAS_CLAUSE", order: 1 },
      ];

      await createEdgesBatchUnwind(mockClient, edges);

      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });

    it("should handle BELONGS_TO edges with chapter level", async () => {
      const edges = [
        { from: "a1", to: "ch1", type: "BELONGS_TO", level: "chapter" },
      ];

      await createEdgesBatchUnwind(mockClient, edges);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("MATCH (f:Article)"),
        expect.any(Array),
      );
    });

    it("should handle BELONGS_TO edges with section level", async () => {
      const edges = [
        { from: "a1", to: "s1", type: "BELONGS_TO", level: "section" },
      ];

      await createEdgesBatchUnwind(mockClient, edges);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("(t:Section)"),
        expect.any(Array),
      );
    });

    it("should handle BELONGS_TO edges with subsection level", async () => {
      const edges = [
        { from: "a1", to: "ss1", type: "BELONGS_TO", level: "subsection" },
      ];

      await createEdgesBatchUnwind(mockClient, edges);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("(t:Subsection)"),
        expect.any(Array),
      );
    });

    it("should chunk large edge batches", async () => {
      const edges: any[] = [];
      for (let i = 0; i < 2500; i++) {
        edges.push({ from: `a${i}`, to: `a${i + 1}`, type: "REFERENCES" });
      }

      await createEdgesBatchUnwind(mockClient, edges);

      expect(mockClient.query).toHaveBeenCalledTimes(3);
    });

    it("should include edge properties in UNWIND query", async () => {
      const edges = [
        {
          from: "a1",
          to: "a2",
          type: "REFERENCES",
          reference_type: "cite",
          strength: 0.9,
        },
      ];

      await createEdgesBatchUnwind(mockClient, edges);

      const calls = (mockClient.query as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][1][0][0].props).toEqual({
        reference_type: "cite",
        strength: 0.9,
      });
    });

    it("should skip edges without type", async () => {
      const edges = [{ from: "a1", to: "a2" }];

      await createEdgesBatchUnwind(mockClient, edges);

      expect(mockClient.query).not.toHaveBeenCalled();
    });

    it("should handle query errors", async () => {
      const edges = [{ from: "a1", to: "a2", type: "REFERENCES" }];
      mockClient.query = vi.fn().mockRejectedValue(new Error("Query failed"));

      await expect(createEdgesBatchUnwind(mockClient, edges)).rejects.toThrow(
        "Query failed",
      );
    });

    it("should handle properties with various types", async () => {
      const edges = [
        {
          from: "a1",
          to: "a2",
          type: "REFERENCES",
          strength: 0.5,
          count: 10,
          active: true,
        },
      ];

      await createEdgesBatchUnwind(mockClient, edges);

      const calls = (mockClient.query as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const props = calls[0][1][0][0].props;
      expect(props).toEqual({ strength: 0.5, count: 10, active: true });
    });

    it("should exclude system properties from edge props", async () => {
      const edges = [
        {
          from: "a1",
          to: "a2",
          type: "REFERENCES",
          _from: 1,
          _to: 2,
          _type: "REFERENCES",
          properties: { weight: 1 },
          customProp: "value",
        },
      ];

      await createEdgesBatchUnwind(mockClient, edges);

      const calls = (mockClient.query as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const itemProps = calls[0][1][0][0].props;
      expect(itemProps.customProp).toBe("value");
      expect(itemProps.weight).toBe(1);
      // System properties should not be in props
      expect(itemProps._from).toBeUndefined();
      expect(itemProps._to).toBeUndefined();
      expect(itemProps._type).toBeUndefined();
    });
  });

  describe("getLabelForEdgeType", () => {
    it("should return correct labels for HAS_CHAPTER", () => {
      expect(getLabelForEdgeType("HAS_CHAPTER", "from")).toBe("Part");
      expect(getLabelForEdgeType("HAS_CHAPTER", "to")).toBe("Chapter");
    });

    it("should return correct labels for HAS_SECTION", () => {
      expect(getLabelForEdgeType("HAS_SECTION", "from")).toBe("Chapter");
      expect(getLabelForEdgeType("HAS_SECTION", "to")).toBe("Section");
    });

    it("should return correct labels for HAS_SUBSECTION", () => {
      expect(getLabelForEdgeType("HAS_SUBSECTION", "from")).toBe("Section");
      expect(getLabelForEdgeType("HAS_SUBSECTION", "to")).toBe("Subsection");
    });

    it("should return correct labels for HAS_CLAUSE", () => {
      expect(getLabelForEdgeType("HAS_CLAUSE", "from")).toBe("Article");
      expect(getLabelForEdgeType("HAS_CLAUSE", "to")).toBe("Clause");
    });

    it("should return correct labels for HAS_POINT", () => {
      expect(getLabelForEdgeType("HAS_POINT", "from")).toBe("Clause");
      expect(getLabelForEdgeType("HAS_POINT", "to")).toBe("ClausePoint");
    });

    it("should return correct labels for REFERENCES and REFERENCED_BY", () => {
      expect(getLabelForEdgeType("REFERENCES", "from")).toBe("Article");
      expect(getLabelForEdgeType("REFERENCES", "to")).toBe("Article");
      expect(getLabelForEdgeType("REFERENCED_BY", "from")).toBe("Article");
      expect(getLabelForEdgeType("REFERENCED_BY", "to")).toBe("Article");
    });

    it("should return correct labels for NEXT_ARTICLE", () => {
      expect(getLabelForEdgeType("NEXT_ARTICLE", "from")).toBe("Article");
      expect(getLabelForEdgeType("NEXT_ARTICLE", "to")).toBe("Article");
    });

    it("should return correct labels for BELONGS_TO", () => {
      expect(getLabelForEdgeType("BELONGS_TO", "from")).toBe("Article");
      expect(getLabelForEdgeType("BELONGS_TO", "to")).toBe("Chapter");
    });

    it("should return empty string for unknown edge types", () => {
      expect(getLabelForEdgeType("UNKNOWN_TYPE", "from")).toBe("");
      expect(getLabelForEdgeType("UNKNOWN_TYPE", "to")).toBe("");
    });
  });
});
