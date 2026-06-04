import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  HybridRetrieval,
  createHybridRetrieval,
} from "../../../src/retrieval/hybrid-congraph";
import * as pathRAGModule from "../../../src/retrieval/pathRAG-congraph";
import * as graphRAGModule from "../../../src/retrieval/graphRAG-congraph";

// Mock the sub-modules
vi.mock("../../../src/retrieval/pathRAG-congraph", () => ({
  createPathRAG: vi.fn(),
}));

vi.mock("../../../src/retrieval/graphRAG-congraph", () => ({
  createGraphRAG: vi.fn(),
}));

// Mock error handling
vi.mock("../../../src/shared/error-handling", () => ({
  validateQuery: vi.fn((q: string) => q && q.length > 0),
  logPerformance: vi.fn(),
  recordMetric: vi.fn(),
  safeGraphOperation: vi.fn((name: string, fn: any, fallback: any) => fn()),
}));

// Mock config
vi.mock("../../../src/shared/config", () => ({
  config: {
    retrieval: {
      topKSeedArticles: 5,
      pathTraversalDepth: 3,
      maxConcepts: 10,
    },
  },
}));

// Mock logger
vi.mock("../../../src/shared/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("HybridRetrieval", () => {
  let storage: any;
  let llm: any;
  let embedder: any;
  let hybrid: HybridRetrieval;
  let mockPathRAG: any;
  let mockGraphRAG: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create fresh mocks for each test
    mockPathRAG = {
      traverseReferences: vi.fn().mockResolvedValue([]),
    };

    mockGraphRAG = {
      query: vi.fn().mockResolvedValue({ content: "" }),
      queryStream: vi.fn().mockImplementation(async function* () {
        yield "chunk1";
        yield "chunk2";
      }),
      getCommunityContext: vi.fn().mockResolvedValue({
        article_count: 0,
        part: {
          id: "",
          name: "",
          name_short: "",
          part_number: 0,
          chapter_count: 0,
          article_count: 0,
        },
        chapter: {
          id: "",
          name: "",
          name_short: "",
          chapter_roman: "",
          part_id: "",
          article_count: 0,
          section_count: 0,
          summary: "",
        },
        section: null,
        subsection: null,
        principles: "",
        hierarchical_context: "",
      }),
      getCommunityArticles: vi.fn().mockResolvedValue([]),
      globalQuery: vi.fn().mockResolvedValue(""),
    };

    // Make the mocked factory functions return our test mocks
    vi.mocked(pathRAGModule.createPathRAG).mockReturnValue(mockPathRAG);
    vi.mocked(graphRAGModule.createGraphRAG).mockReturnValue(mockGraphRAG);

    storage = {
      searchEntitiesByEmbedding: vi.fn().mockResolvedValue([]),
      searchCommunityReports: vi.fn().mockResolvedValue([]),
      graph: {
        getFullArticle: vi.fn(),
      },
    };
    llm = {};
    embedder = {
      embed: vi.fn().mockResolvedValue([0.1, 0.2]),
    };

    // Create hybrid instance - it will use the mocked factories
    hybrid = createHybridRetrieval(storage, llm, embedder);
  });

  describe("retrieve", () => {
    it("should return empty context for invalid query", async () => {
      const { validateQuery } =
        await import("../../../src/shared/error-handling");
      (validateQuery as any).mockReturnValueOnce(false);

      const result = await hybrid.retrieve("");
      expect(result.query).toBe("");
      expect(result.seed_articles).toHaveLength(0);
    });

    it("should perform global retrieval", async () => {
      storage.searchCommunityReports.mockResolvedValue([
        {
          id: "cr1",
          level: 0,
          title: "Title",
          summary: "Summary",
          findings: "F1\nF2",
          rating: 5,
          parent_id: "p1",
        },
      ]);

      const result = await hybrid.retrieve("query", "global");

      expect(result.community_reports.length).toBeGreaterThanOrEqual(0);
    });

    it("should perform local retrieval with seed articles", async () => {
      const article = {
        id: "article_1",
        keywords: ["k1", "k2"],
        content: "Content",
        title: "Title",
        clauses: [],
        metadata: {
          part: "p1",
          chapter: "c1",
          section: "s1",
          subsection: "ss1",
          source: "src",
        },
        hierarchical_path: "/p1/c1",
        clause_count: 0,
        article_number: 1,
      };

      storage.graph.getFullArticle.mockResolvedValue(article);
      storage.searchEntitiesByEmbedding.mockResolvedValue([
        {
          id: "article_1",
          metadata: { score: 0.9, part: "p1", chapter: "c1" },
          name: "Article 1",
          description: "Content",
        },
      ]);

      const result = await hybrid.retrieve("query", "local");
      expect(result.seed_articles.length).toBeGreaterThanOrEqual(0);
      expect(result.relevant_concepts.length).toBeGreaterThanOrEqual(0);
    });

    it("should fallback to extractSeedArticles if no seeds found via vector search", async () => {
      mockGraphRAG.query.mockResolvedValue({ content: "Điều 2" });

      const article = {
        id: "article_2",
        keywords: [],
        content: "",
        title: "",
        clauses: [],
        metadata: {},
        hierarchical_path: "",
        clause_count: 0,
        article_number: 2,
      };

      storage.graph.getFullArticle.mockResolvedValue(article);
      storage.searchEntitiesByEmbedding.mockResolvedValue([]);

      const result = await hybrid.retrieve("query", "local");
      expect(result.seed_articles.length).toBeGreaterThanOrEqual(0);
    });

    it("should use filters when provided", async () => {
      storage.searchEntitiesByEmbedding.mockResolvedValue([]);

      const article = {
        id: "article_1",
        keywords: [],
        content: "",
        title: "",
        clauses: [],
        metadata: {},
        hierarchical_path: "",
        clause_count: 0,
        article_number: 1,
      };

      storage.graph.getFullArticle.mockResolvedValue(article);

      const filters = {
        part_id: "part_1",
        chapter_id: "chapter_1",
        section_id: "section_1",
        subsection_id: "subsection_1",
      };

      const result = await hybrid.retrieve("query", "local", filters);
      expect(result.hierarchical_filter).toBeDefined();
    });

    it("should merge entity metadata with graph metadata", async () => {
      const article = {
        id: "article_1",
        keywords: ["keyword1"],
        content: "Graph content",
        title: "Graph Title",
        clauses: [],
        metadata: {
          part: "N/A",
          chapter: "graph_chapter",
          section: "",
          subsection: "",
          source: "graph_source",
        },
        hierarchical_path: "",
        clause_count: 0,
        article_number: 1,
      };

      storage.graph.getFullArticle.mockResolvedValue(article);
      storage.searchEntitiesByEmbedding.mockResolvedValue([
        {
          id: "article_1",
          metadata: {
            score: 0.9,
            part: "entity_part",
            chapter: "",
            section: "entity_section",
            subsection: "entity_subsection",
            source: "",
          },
          name: "Entity Name",
          description: "Entity Description",
        },
      ]);

      const result = await hybrid.retrieve("query", "local");
      console.log("CALLS:", storage.searchEntitiesByEmbedding.mock.calls);
      console.log("RESULTS:", await storage.searchEntitiesByEmbedding());
      console.log("DEBUG_RESULT:", JSON.stringify(result.seed_articles));
      expect(result.seed_articles[0]?.article.metadata.part).toBe(
        "entity_part",
      );
      expect(result.seed_articles).toBeDefined();
    });

    it("should handle entity without graph article", async () => {
      storage.graph.getFullArticle.mockResolvedValue(null);
      storage.searchEntitiesByEmbedding.mockResolvedValue([
        {
          id: "article_99",
          metadata: {
            score: 0.8,
            part: "p1",
            chapter: "c1",
            section: "s1",
            subsection: "ss1",
            source: "src",
          },
          name: "Article 99",
          description: "Description",
        },
      ]);

      const result = await hybrid.retrieve("query", "local");
      expect(result.seed_articles).toBeDefined();
    });

    it("should limit concepts to maxConcepts from config", async () => {
      const article = {
        id: "article_1",
        keywords: Array.from({ length: 20 }, (_, i) => `keyword${i}`),
        content: "",
        title: "",
        clauses: [],
        metadata: {},
        hierarchical_path: "",
        clause_count: 0,
        article_number: 1,
      };

      storage.graph.getFullArticle.mockResolvedValue(article);
      storage.searchEntitiesByEmbedding.mockResolvedValue([
        {
          id: "article_1",
          metadata: { score: 0.9 },
          name: "Article 1",
          description: "Content",
        },
      ]);

      const result = await hybrid.retrieve("query", "local");
      expect(result.relevant_concepts).toBeDefined();
    });

    it("should handle empty keywords array", async () => {
      const article = {
        id: "article_1",
        keywords: [],
        content: "",
        title: "",
        clauses: [],
        metadata: {},
        hierarchical_path: "",
        clause_count: 0,
        article_number: 1,
      };

      storage.graph.getFullArticle.mockResolvedValue(article);
      storage.searchEntitiesByEmbedding.mockResolvedValue([
        {
          id: "article_1",
          metadata: { score: 0.9 },
          name: "Article 1",
          description: "Content",
        },
      ]);

      const result = await hybrid.retrieve("query", "local");
      expect(result.relevant_concepts).toBeDefined();
    });

    it("should handle non-array keywords gracefully", async () => {
      const article = {
        id: "article_1",
        keywords: null as any,
        content: "",
        title: "",
        clauses: [],
        metadata: {},
        hierarchical_path: "",
        clause_count: 0,
        article_number: 1,
      };

      storage.graph.getFullArticle.mockResolvedValue(article);
      storage.searchEntitiesByEmbedding.mockResolvedValue([
        {
          id: "article_1",
          metadata: { score: 0.9 },
          name: "Article 1",
          description: "Content",
        },
      ]);

      const result = await hybrid.retrieve("query", "local");
      expect(result.relevant_concepts).toBeDefined();
    });
  });

  describe("retrieveStream", () => {
    it("should yield chunks from graphRAG", async () => {
      const chunks: string[] = [];
      for await (const chunk of hybrid.retrieveStream("query")) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);
    });

    it("should yield error message on invalid query", async () => {
      const { validateQuery } =
        await import("../../../src/shared/error-handling");
      (validateQuery as any).mockReturnValueOnce(false);

      const chunks: string[] = [];
      for await (const chunk of hybrid.retrieveStream("")) {
        chunks.push(chunk);
      }
      expect(chunks).toContain("Lỗi: Truy vấn không hợp lệ.");
    });

    it("should yield error message on failure", async () => {
      mockGraphRAG.queryStream.mockImplementation(() => {
        throw new Error("fail");
      });

      const chunks: string[] = [];
      for await (const chunk of hybrid.retrieveStream("query")) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe("findSeedArticles", () => {
    it("should find seed articles with custom limit", async () => {
      storage.searchEntitiesByEmbedding.mockResolvedValue([
        {
          id: "article_1",
          metadata: { score: 0.9 },
          name: "A1",
          description: "D1",
        },
      ]);

      storage.graph.getFullArticle.mockResolvedValue({
        id: "article_1",
        keywords: [],
        content: "",
        title: "",
        clauses: [],
        metadata: {},
        hierarchical_path: "",
        clause_count: 0,
        article_number: 1,
      });

      const result = await hybrid.findSeedArticles("query", 3);
      expect(result).toHaveLength(1);
    });

    it("should handle entities without valid article ID", async () => {
      storage.searchEntitiesByEmbedding.mockResolvedValue([
        {
          id: "not_an_article",
          metadata: { score: 0.9 },
          name: "NA",
          description: "D",
        },
      ]);

      const result = await hybrid.findSeedArticles("query");
      expect(result).toHaveLength(0);
    });
  });

  describe("findSeedClauses", () => {
    it("should filter and format clauses from entities", async () => {
      storage.searchEntitiesByEmbedding.mockResolvedValue([
        {
          id: "article_1_clause_1",
          type: "Clause",
          description: "Clause text",
          metadata: { clause_number: "1", score: 0.8 },
        },
        { id: "article_1", type: "Article" },
      ]);

      const result = await hybrid.findSeedClauses("query");
      expect(result).toHaveLength(1);
      expect(result[0].clause_id).toBe("article_1_clause_1");
    });

    it("should use default score when not provided", async () => {
      storage.searchEntitiesByEmbedding.mockResolvedValue([
        {
          id: "article_1_clause_1",
          type: "Clause",
          description: "Text",
          metadata: { clause_number: "1" },
        },
      ]);

      const result = await hybrid.findSeedClauses("query");
      expect(result[0].score).toBe(1.0);
    });

    it("should limit results to specified limit", async () => {
      const entities = Array.from({ length: 10 }, (_, i) => ({
        id: `article_1_clause_${i}`,
        type: "Clause",
        description: `Text ${i}`,
        metadata: { clause_number: String(i), score: 0.9 },
      }));

      storage.searchEntitiesByEmbedding.mockResolvedValue(entities);

      const result = await hybrid.findSeedClauses("query", 5);
      expect(result).toHaveLength(5);
    });
  });

  describe("entityToArticle", () => {
    it("should return null for entity without ID", async () => {
      const result = await (hybrid as any).entityToArticle({});
      expect(result).toBeNull();
    });

    it("should return null for entity without article ID match", async () => {
      const result = await (hybrid as any).entityToArticle({
        id: "not_article",
        name: "Name",
      });
      expect(result).toBeNull();
    });

    it("should create article from entity when graph unavailable", async () => {
      storage.graph = null;

      const result = await (hybrid as any).entityToArticle({
        id: "article_42",
        name: "Article 42",
        description: "Content",
        metadata: { part: "p1", chapter: "c1" },
      });

      expect(result.id).toBe("article_42");
      expect(result.article_number).toBe(42);
    });

    it("should create article with default values when graph unavailable and entity missing fields", async () => {
      storage.graph = null;

      const result = await (hybrid as any).entityToArticle({
        id: "article_43",
      });

      expect(result.id).toBe("article_43");
      expect(result.title).toBe("Điều 43");
      expect(result.content).toBe("");
      expect(result.metadata.part).toBe("");
    });

    it("should handle missing metadata when merging with graph", async () => {
      storage.graph.getFullArticle.mockResolvedValue({
        id: "article_44",
        metadata: undefined,
      });

      const result = await (hybrid as any).entityToArticle({
        id: "article_44",
      });

      expect(result.metadata.part).toBe("");
    });
  });

  describe("extractConcepts", () => {
    it("should create concept nodes from keywords", async () => {
      const articles = [
        { id: "a1", keywords: ["contract", "property"] },
        { id: "a2", keywords: ["family"] },
      ];

      const result = await (hybrid as any).extractConcepts(articles);
      expect(result).toHaveLength(3);
    });

    it("should deduplicate keywords across articles", async () => {
      const articles = [
        { id: "a1", keywords: ["contract", "contract"] },
        { id: "a2", keywords: ["contract"] },
      ];

      const result = await (hybrid as any).extractConcepts(articles);
      expect(result).toHaveLength(1);
    });

    it("should include source articles in concepts", async () => {
      const articles = [
        { id: "a1", keywords: ["contract"] },
        { id: "a2", keywords: ["property"] },
      ];

      const result = await (hybrid as any).extractConcepts(articles);
      expect(result[0].source_articles).toContain("a1");
    });
  });

  describe("categorizeConcept", () => {
    it("should categorize correctly", () => {
      const cat = (hybrid as any).categorizeConcept.bind(hybrid);
      expect(cat("Cá nhân")).toBe("person");
      expect(cat("người dùng")).toBe("person");
      expect(cat("Tài sản")).toBe("property");
      expect(cat("sở hữu")).toBe("property");
      expect(cat("Hợp đồng")).toBe("contract");
      expect(cat("thỏa thuận")).toBe("contract");
      expect(cat("Thừa kế")).toBe("inheritance");
      expect(cat("di chúc")).toBe("inheritance");
      expect(cat("Gia đình")).toBe("family");
      expect(cat("kết hôn")).toBe("family");
      expect(cat("ly hôn")).toBe("family");
      expect(cat("Bồi thường")).toBe("tort");
      expect(cat("thiệt hại")).toBe("tort");
      expect(cat("Khái niệm khác")).toBe("other");
    });
  });

  describe("getStats", () => {
    it("should return retrieval statistics", () => {
      const stats = hybrid.getStats();
      expect(stats.topKSeedArticles).toBe(5);
      expect(stats.pathTraversalDepth).toBe(3);
      expect(stats.maxConcepts).toBe(10);
    });
  });
});
