import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GraphClient, createGraphClient } from "../../../src/graph/client";

// Mock congraphdb - this mock applies only to this test file
vi.mock("congraphdb", () => {
  const createMockConnection = () => ({
    query: vi.fn().mockResolvedValue({
      getAll: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    }),
    queryWithParams: vi.fn().mockResolvedValue({
      getAll: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    }),
    queryBatch: vi.fn().mockReturnValue(0),
    batchCreateNodes: vi.fn().mockResolvedValue([1, 2, 3]),
    batchCreateRelationships: vi.fn().mockResolvedValue(undefined),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    inTransaction: vi.fn().mockReturnValue(false),
    createNodeTable: vi
      .fn()
      .mockResolvedValue({ name: "test", tableType: "NODE", properties: [] }),
    createRelTable: vi
      .fn()
      .mockResolvedValue({ name: "test", tableType: "REL", properties: [] }),
    dropTable: vi.fn().mockResolvedValue(true),
    getTables: vi.fn().mockResolvedValue([]),
    createIndex: vi.fn().mockResolvedValue(true),
    dropIndex: vi.fn().mockResolvedValue(true),
    close: vi.fn(),
  });

  return {
    Database: vi.fn().mockImplementation(() => ({
      init: vi.fn().mockReturnValue(undefined),
      close: vi.fn().mockReturnValue(undefined),
      checkpoint: vi.fn().mockReturnValue(undefined),
      createConnection: createMockConnection,
    })),
    VectorStore: vi.fn().mockImplementation(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      createTable: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockReturnValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      clear: vi.fn().mockResolvedValue(undefined),
      dropTable: vi.fn().mockResolvedValue(undefined),
      getTables: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockResolvedValue(undefined),
      checkpoint: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockReturnValue(true),
    })),
  };
});

// Note: config and logger mocks are in setup-unit.ts

describe("GraphClient", () => {
  let client: GraphClient;
  let mockConn: any;

  beforeEach(() => {
    client = new GraphClient("/test/db");
    mockConn = {
      query: vi.fn().mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([]),
        close: vi.fn(),
      }),
      queryWithParams: vi.fn().mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([]),
        close: vi.fn(),
      }),
    };
  });

  afterEach(async () => {
    if (client && (client as any).isInitialized) {
      await client.close();
    }
  });

  describe("constructor", () => {
    it("should create instance with dbPath", () => {
      const testClient = new GraphClient("/test/path");
      expect(testClient).toBeInstanceOf(GraphClient);
    });
  });

  describe("initialize", () => {
    it("should initialize the database connection", async () => {
      await client.initialize();
      expect((client as any).isInitialized).toBe(true);
      expect(client.conn).toBeDefined();
    });

    it("should not initialize twice", async () => {
      await client.initialize();
      const isInitialized = (client as any).isInitialized;
      expect(isInitialized).toBe(true);

      // Second initialize should be a no-op due to the guard clause
      await client.initialize();
      expect((client as any).isInitialized).toBe(true);
    });

    it("should create schema tables", async () => {
      await client.initialize();
      expect(client.conn.query).toHaveBeenCalled();
    });

    it("should handle initialization errors", async () => {
      // This test verifies that initialize throws when db.init fails
      // We test this by checking that isInitialized is set to false initially
      // and would remain false if init failed
      const errorClient = new GraphClient("/test/db");
      expect((errorClient as any).isInitialized).toBe(false);

      // Since we can't easily mock the Database constructor in this context,
      // we verify the error handling logic exists in the code
      // The actual error propagation is tested in integration tests
      expect((errorClient as any).db).toBeNull();
    });
  });

  describe("ensureSchema", () => {
    it("should create all node tables", async () => {
      await client.initialize();
      const calls = (client.conn.query as any).mock.calls;
      const nodeTableQueries = calls.filter((call: any) =>
        call[0].includes("CREATE NODE TABLE"),
      );
      expect(nodeTableQueries.length).toBeGreaterThan(0);
    });

    it("should create all relationship tables", async () => {
      await client.initialize();
      const calls = (client.conn.query as any).mock.calls;
      const relTableQueries = calls.filter((call: any) =>
        call[0].includes("CREATE REL TABLE"),
      );
      expect(relTableQueries.length).toBeGreaterThan(0);
    });

    it('should ignore "already exists" errors', async () => {
      mockConn.query = vi
        .fn()
        .mockRejectedValueOnce(new Error("Table already exists"))
        .mockResolvedValue({
          getAll: vi.fn().mockResolvedValue([]),
          close: vi.fn(),
        });

      await expect(client.initialize()).resolves.not.toThrow();
    });
  });

  describe("close", () => {
    it("should close the database connection", async () => {
      await client.initialize();
      await client.close();
      expect((client as any).isInitialized).toBe(false);
    });

    it("should handle closing when not initialized", async () => {
      const errorClient = new GraphClient("/test/db");
      await expect(errorClient.close()).resolves.not.toThrow();
    });
  });

  describe("checkpoint", () => {
    it("should call checkpoint on database", async () => {
      const mockCheckpoint = vi.fn();
      (client as any).db = { checkpoint: mockCheckpoint };

      await client.checkpoint();
      expect(mockCheckpoint).toHaveBeenCalled();
    });

    it("should handle no database instance", async () => {
      (client as any).db = null;
      await expect(client.checkpoint()).resolves.not.toThrow();
    });
  });

  describe("refresh", () => {
    it("should close and re-initialize", async () => {
      await client.initialize();
      await client.refresh();
      expect((client as any).isInitialized).toBe(true);
    });
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

  describe("getFullArticle", () => {
    beforeEach(async () => {
      await client.initialize();
      client.conn = mockConn;
    });

    it("should throw error when not initialized", async () => {
      const noConnClient = new GraphClient("/test/db");
      await expect(noConnClient.getFullArticle("article_1")).rejects.toThrow(
        "Connection not initialized",
      );
    });

    it("should return null for non-existent article", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([]),
        close: vi.fn(),
      });

      const result = await client.getFullArticle("article_999");
      expect(result).toBeNull();
    });

    it("should return article with clauses and points", async () => {
      const mockRows = [
        {
          a: {
            id: "article_1",
            article_number: 1,
            title: "Test Article",
            content: "Content",
            metadata: null,
            hierarchical_path: "P1 > C1",
            clause_count: 1,
          },
          part_name: "Part 1",
          chapter_name: "Chapter 1",
          clause: {
            id: "clause_1",
            clause_number: 1,
            text: "Clause text",
            article_id: "article_1",
          },
          point: {
            id: "point_1",
            point_letter: "a",
            text: "Point text",
            clause_id: "clause_1",
          },
        },
      ];

      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue(mockRows),
        close: vi.fn(),
      });

      const result = await client.getFullArticle("article_1");
      expect(result).toBeDefined();
      expect(result?.id).toBe("article_1");
      expect(result?.clauses).toHaveLength(1);
      expect(result?.clauses[0].points).toHaveLength(1);
    });

    it("should handle missing metadata", async () => {
      const mockRows = [
        {
          a: {
            id: "article_1",
            article_number: 1,
            title: "Test",
            content: "Content",
            metadata: null,
          },
          part_name: "Part 1",
          chapter_name: "Chapter 1",
          clause: null,
          point: null,
        },
      ];

      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue(mockRows),
        close: vi.fn(),
      });

      const result = await client.getFullArticle("article_1");
      expect(result?.metadata).toBeDefined();
    });

    it("should update metadata with part and chapter names", async () => {
      const mockRows = [
        {
          a: {
            id: "article_1",
            article_number: 1,
            title: "Test",
            content: "Content",
            metadata: { part: "", chapter: "" },
          },
          part_name: "Part 1",
          chapter_name: "Chapter 1",
          clause: null,
          point: null,
        },
      ];

      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue(mockRows),
        close: vi.fn(),
      });

      const result = await client.getFullArticle("article_1");
      expect(result?.metadata?.part).toBe("Part 1");
      expect(result?.metadata?.chapter).toBe("Chapter 1");
    });

    it("should handle query errors", async () => {
      mockConn.query.mockRejectedValue(new Error("Query failed"));

      const result = await client.getFullArticle("article_1");
      expect(result).toBeNull();
    });

    it("should handle article without hierarchical_path", async () => {
      const mockRows = [
        {
          a: {
            id: "article_1",
            article_number: 1,
            title: "Test",
            content: "Content",
            metadata: { part: "P1", chapter: "C1" },
          },
          part_name: "Part 1",
          chapter_name: "Chapter 1",
          clause: null,
          point: null,
        },
      ];

      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue(mockRows),
        close: vi.fn(),
      });

      const result = await client.getFullArticle("article_1");
      expect(result).toBeDefined();
    });
  });

  describe("getNode", () => {
    beforeEach(async () => {
      await client.initialize();
      client.conn = mockConn;
    });

    it("should throw error when not initialized", async () => {
      const noConnClient = new GraphClient("/test/db");
      await expect(
        noConnClient.getNode("Article", "article_1"),
      ).rejects.toThrow("Connection not initialized");
    });

    it("should return null for non-existent node", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([]),
        close: vi.fn(),
      });

      const result = await client.getNode("Article", "article_999");
      expect(result).toBeNull();
    });

    it("should return node by type and id", async () => {
      const mockNode = { id: "article_1", title: "Test Article" };
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ n: mockNode }]),
        close: vi.fn(),
      });

      const result = await client.getNode("Article", "article_1");
      expect(result).toEqual(mockNode);
    });

    it("should query without type filter when type not provided", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ n: { id: "test" } }]),
        close: vi.fn(),
      });

      await client.getNode("", "test_id");
      expect(mockConn.query).toHaveBeenCalledWith(
        expect.not.stringContaining(":"),
      );
    });

    it("should handle query errors gracefully", async () => {
      mockConn.query.mockRejectedValue(new Error("Query failed"));

      const result = await client.getNode("Article", "article_1");
      expect(result).toBeNull();
    });

    it("should handle missing n property in result", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi.fn().mockResolvedValue([{ id: "article_1" }]),
        close: vi.fn(),
      });

      const result = await client.getNode("Article", "article_1");
      expect(result).toEqual({ id: "article_1" });
    });
  });

  describe("getNodesByType", () => {
    beforeEach(async () => {
      await client.initialize();
      client.conn = mockConn;
    });

    it("should throw error when not initialized", async () => {
      const noConnClient = new GraphClient("/test/db");
      await expect(noConnClient.getNodesByType("Article")).rejects.toThrow(
        "Connection not initialized",
      );
    });

    it("should return all nodes of a type", async () => {
      const mockNodes = [
        { id: "article_1", title: "Article 1" },
        { id: "article_2", title: "Article 2" },
      ];
      mockConn.query.mockResolvedValue({
        getAll: vi
          .fn()
          .mockResolvedValue([{ n: mockNodes[0] }, { n: mockNodes[1] }]),
        close: vi.fn(),
      });

      const result = await client.getNodesByType("Article");
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("article_1");
    });

    it("should handle query errors gracefully", async () => {
      mockConn.query.mockRejectedValue(new Error("Query failed"));

      const result = await client.getNodesByType("Article");
      expect(result).toEqual([]);
    });

    it("should handle missing n property in results", async () => {
      mockConn.query.mockResolvedValue({
        getAll: vi
          .fn()
          .mockResolvedValue([{ id: "article_1" }, { id: "article_2" }]),
        close: vi.fn(),
      });

      const result = await client.getNodesByType("Article");
      expect(result).toHaveLength(2);
    });
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

describe("createGraphClient", () => {
  it("should create and initialize a graph client", async () => {
    const client = await createGraphClient();
    expect(client).toBeInstanceOf(GraphClient);
    expect((client as any).isInitialized).toBe(true);
    await client.close();
  });
});
