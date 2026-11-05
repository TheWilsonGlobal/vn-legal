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

  describe("addNode", () => {
    beforeEach(async () => {
      await client.initialize();
      client.conn = mockConn;
    });

    it("should throw error when not initialized", async () => {
      const noConnClient = new GraphClient("/test/db");
      await expect(
        noConnClient.addNode("Article", "a1", { title: "Test" }),
      ).rejects.toThrow("Connection not initialized");
    });

    it("should create a node with properties", async () => {
      await client.addNode("Article", "article_1", { title: "Test Article" });
      expect(mockConn.query).toHaveBeenCalledWith(
        expect.stringContaining("CREATE (n:Article"),
      );
    });

    it("should serialize array properties", async () => {
      await client.addNode("Article", "article_1", {
        clauses: [{ id: "c1" }],
        keywords: ["test", "keyword"],
      });

      const query = mockConn.query.mock.calls[0][0];
      expect(query).toContain("clauses:");
      expect(query).toContain('[{"id":"c1"}]');
    });

    it("should serialize object properties", async () => {
      await client.addNode("Article", "article_1", {
        metadata: { part: "P1", chapter: "C1" },
      });

      const query = mockConn.query.mock.calls[0][0];
      expect(query).toContain("metadata:");
      expect(query).toContain('{"part":"P1","chapter":"C1"}');
    });

    it("should handle node creation errors gracefully", async () => {
      mockConn.query = vi.fn().mockRejectedValue(new Error("Node exists"));
      await expect(
        client.addNode("Article", "a1", { title: "Test" }),
      ).resolves.not.toThrow();
    });

    it("should escape single quotes in property values", async () => {
      await client.addNode("Article", "article_1", { title: "Test's Article" });
      const query = mockConn.query.mock.calls[0][0];
      expect(query).toContain("Test\\'s Article");
    });

    it("should handle undefined properties", async () => {
      await client.addNode("Article", "article_1", {
        title: "Test",
        undefined: undefined,
      });

      const query = mockConn.query.mock.calls[0][0];
      expect(query).not.toContain("undefined");
    });
  });

  describe("addEdge", () => {
    beforeEach(async () => {
      await client.initialize();
      client.conn = mockConn;
    });

    it("should throw error when not initialized", async () => {
      const noConnClient = new GraphClient("/test/db");
      await expect(
        noConnClient.addEdge({ from: "a1", to: "a2", type: "REFERENCES" }),
      ).rejects.toThrow("Connection not initialized");
    });

    it("should create HAS_CHAPTER edge", async () => {
      await client.addEdge({ from: "p1", to: "c1", type: "HAS_CHAPTER" });
      expect(mockConn.query).toHaveBeenCalledWith(
        expect.stringContaining("(from:Part"),
      );
    });

    it("should create HAS_CLAUSE edge", async () => {
      await client.addEdge({
        from: "a1",
        to: "c1",
        type: "HAS_CLAUSE",
        order: 1,
      });
      expect(mockConn.query).toHaveBeenCalledWith(
        expect.stringContaining("(from:Article"),
      );
    });

    it("should create REFERENCES edge with properties", async () => {
      await client.addEdge({
        from: "a1",
        to: "a2",
        type: "REFERENCES",
        reference_type: "cite",
        strength: 0.8,
      });

      const query = mockConn.query.mock.calls[0][0];
      expect(query).toContain("reference_type");
      expect(query).toContain("cite");
    });

    it("should create BELONGS_TO edge", async () => {
      await client.addEdge({ from: "a1", to: "s1", type: "BELONGS_TO" });
      expect(mockConn.query).toHaveBeenCalledWith(
        expect.stringContaining("(to:Subsection"),
      );
    });

    it("should create edge without specific labels", async () => {
      await client.addEdge({ from: "x1", to: "y1", type: "CUSTOM_EDGE" });
      expect(mockConn.query).toHaveBeenCalledWith(
        expect.stringContaining("MATCH (from {id:"),
      );
    });

    it("should handle edge creation errors gracefully", async () => {
      mockConn.query = vi.fn().mockRejectedValue(new Error("Edge exists"));
      await expect(
        client.addEdge({ from: "a1", to: "a2", type: "REFERENCES" }),
      ).resolves.not.toThrow();
    });

    it("should exclude system properties from edge props", async () => {
      await client.addEdge({
        from: "a1",
        to: "a2",
        type: "REFERENCES",
        _from: 1,
        _to: 2,
        _type: "REFERENCES",
        customProp: "value",
      });

      const query = mockConn.query.mock.calls[0][0];
      expect(query).toContain("customProp");
      expect(query).not.toContain("_from");
    });

    it("should handle boolean properties", async () => {
      await client.addEdge({
        from: "a1",
        to: "a2",
        type: "NEXT_ARTICLE",
        same_context: true,
      });

      const query = mockConn.query.mock.calls[0][0];
      expect(query).toContain("same_context: true");
    });

    it("should handle number properties", async () => {
      await client.addEdge({
        from: "a1",
        to: "c1",
        type: "HAS_CLAUSE",
        order: 5,
      });

      const query = mockConn.query.mock.calls[0][0];
      expect(query).toContain("order: 5");
    });
  });

  describe("createNodesBatch", () => {
    beforeEach(async () => {
      await client.initialize();
      client.conn = mockConn;
    });

    it("should delegate to createNodesBatch function", async () => {
      mockConn.batchCreateNodes = vi.fn().mockResolvedValue([1, 2]);
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([]),
        close: vi.fn(),
      });

      const nodes = [
        { id: "a1", title: "Article 1" },
        { id: "a2", title: "Article 2" },
      ];

      await client.createNodesBatch("Article", nodes);
      expect(mockConn.batchCreateNodes).toHaveBeenCalled();
    });
  });

  describe("createEdgesBatch", () => {
    beforeEach(async () => {
      await client.initialize();
      client.conn = mockConn;
    });

    it("should delegate to createEdgesBatch function", async () => {
      mockConn.batchCreateRelationships = vi.fn().mockResolvedValue(undefined);
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([]),
        close: vi.fn(),
      });

      client.idToOffset.set("a1", 10);
      client.idToOffset.set("a2", 20);

      const edges = [{ from: "a1", to: "a2", type: "REFERENCES" }];

      await client.createEdgesBatch(edges);
      expect(mockConn.batchCreateRelationships).toHaveBeenCalled();
    });
  });
});
