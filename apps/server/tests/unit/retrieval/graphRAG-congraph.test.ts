import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  GraphRAG,
  createGraphRAG,
} from "../../../src/retrieval/graphRAG-congraph";

// Mock ConGraphRAG MSGraphRAG
const mockQuery = vi.fn();
const mockQueryStream = vi.fn();

vi.mock("congraph-rag/engines", () => ({
  MSGraphRAG: vi.fn().mockImplementation((storage) => ({
    query: mockQuery,
    queryStream: mockQueryStream,
    storage: storage, // Pass through storage for getArticle
  })),
}));

// Mock cache manager to avoid cross-test contamination
vi.mock("../../../src/shared/cache", () => ({
  getCacheManager: vi.fn().mockReturnValue({
    communityContext: {
      getOrCompute: vi.fn().mockImplementation((id, lvl, fn) => fn()),
    },
  }),
}));

describe("GraphRAG", () => {
  let storage: any;
  let llm: any;
  let graphRAG: GraphRAG;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = {
      searchEntities: vi.fn().mockResolvedValue([]),
      searchEntitiesByEmbedding: vi.fn().mockResolvedValue([]),
      getCommunitiesByLevel: vi.fn().mockResolvedValue([]),
      getEntity: vi.fn().mockImplementation(async (id) => {
        if (id === "article_1") {
          return {
            id: "article_1",
            name: "Điều 1",
            description: "Content Điều 1",
            metadata: { article_number: 1 },
          };
        }
        return null;
      }),
      getNeighbors: vi.fn().mockResolvedValue({ entities: [], relations: [] }),
    };
    llm = {
      generate: vi.fn().mockResolvedValue({ content: "mocked response" }),
      stream: vi.fn().mockImplementation(async function* () {
        yield "chunk1";
      }),
    };
    graphRAG = createGraphRAG(storage, llm);
  });

  describe("getCommunityContext", () => {
    it("should return empty for invalid article ID", async () => {
      const result = await graphRAG.getCommunityContext("");
      expect(result.hierarchical_context).toBe("");
    });

    it("should handle missing article", async () => {
      const result = await graphRAG.getCommunityContext("nonexistent");
      expect(result.principles).toBe("");
    });

    it("should compute context and extract info from response text", async () => {
      mockQuery.mockResolvedValue({
        content:
          "Phần 1: Chung.\nChương 1: Quy định.\nMục 1: Chi tiết.\nTiểu mục 1: Nhỏ.",
      });

      const result = await graphRAG.getCommunityContext("article_1");
      expect(result.part.name).toContain("Chung");
      expect(result.chapter.name).toContain("Quy định");
      expect(result.section?.name).toContain("Chi tiết");
      expect(result.subsection?.name).toContain("Nhỏ");
      expect(result.hierarchical_context).toContain("Chung");
    });

    it("should use structured communities from metadata if available", async () => {
      mockQuery.mockResolvedValue({
        content: "Response text",
        metadata: {
          communities: [
            {
              id: "c1",
              title: "Part Title",
              level: 0,
              summary: "Part Summary",
              entityIds: ["a1"],
            },
          ],
        },
      });
      const result = await graphRAG.getCommunityContext("article_1", 0);
      expect(result.part.name).toBe("Part Title");
      expect(result.principles).toBe("Part Summary");
    });

    it("should handle structured chapter community", async () => {
      mockQuery.mockResolvedValue({
        content: "Response",
        metadata: {
          communities: [
            {
              id: "ch1",
              title: "Chapter Title",
              level: 1,
              summary: "Chap Summary",
            },
          ],
        },
      });
      const result = await graphRAG.getCommunityContext("article_1", 1);
      expect(result.chapter.name).toBe("Chapter Title");
    });

    it("should handle engine errors", async () => {
      mockQuery.mockRejectedValue(new Error("Engine fail"));
      const result = await graphRAG.getCommunityContext("article_error_path");
      expect(result.hierarchical_context).toBe("");
    });
  });

  describe("getCommunityArticles", () => {
    it("should extract articles from seeds metadata", async () => {
      mockQuery.mockResolvedValue({
        content: "",
        metadata: {
          seeds: [
            {
              id: "article_2",
              name: "Điều 2",
              description: "Desc 2",
              metadata: {},
            },
          ],
        },
      });
      const articles = await graphRAG.getCommunityArticles("article_1", 5);
      expect(articles).toHaveLength(1);
      expect(articles[0].id).toBe("article_2");
    });

    it("should fallback to text parsing for articles", async () => {
      mockQuery.mockResolvedValue({ content: "Xem thêm Điều 3 và Điều 4" });
      const articles = await graphRAG.getCommunityArticles("article_1");
      expect(articles.length).toBeGreaterThanOrEqual(2);
      expect(articles.some((a) => a.id === "article_3")).toBe(true);
    });

    it("should handle errors in getCommunityArticles", async () => {
      mockQuery.mockRejectedValue(new Error("fail"));
      const articles = await graphRAG.getCommunityArticles("article_1");
      expect(articles).toEqual([]);
    });
  });

  describe("queryStream", () => {
    it("should yield chunks from engine stream", async () => {
      mockQueryStream.mockImplementation(async function* () {
        yield "chunk1";
        yield "chunk2";
      });

      const stream = graphRAG.queryStream("test");
      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual(["chunk1", "chunk2"]);
    });

    it("should handle stream errors", async () => {
      mockQueryStream.mockImplementation(async function* () {
        throw new Error("Stream fail");
        yield "";
      });
      const stream = graphRAG.queryStream("test");
      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      expect(chunks[0]).toContain("Lỗi");
    });
  });

  describe("generateChapterSummary", () => {
    it("should return content from query", async () => {
      mockQuery.mockResolvedValue({ content: "summary text" });
      const result = await graphRAG.generateChapterSummary("c1");
      expect(result).toBe("summary text");
    });

    it("should return empty string on error", async () => {
      mockQuery.mockRejectedValue(new Error("fail"));
      const result = await graphRAG.generateChapterSummary("c1");
      expect(result).toBe("");
    });
  });

  describe("globalQuery", () => {
    it("should call engine with global mode", async () => {
      mockQuery.mockResolvedValue({ content: "global result" });
      const result = await graphRAG.globalQuery("q");
      expect(result).toBe("global result");
      expect(mockQuery).toHaveBeenCalledWith(
        "q",
        expect.objectContaining({ mode: "global" }),
      );
    });

    it("should return empty string on error", async () => {
      mockQuery.mockRejectedValue(new Error("fail"));
      const result = await graphRAG.globalQuery("q");
      expect(result).toBe("");
    });
  });

  describe("query", () => {
    it("should return result from engine", async () => {
      mockQuery.mockResolvedValue({ content: "res", metadata: { m: 1 } });
      const result = await graphRAG.query("q");
      expect(result.content).toBe("res");
    });

    it("should handle errors in general query", async () => {
      mockQuery.mockRejectedValue(new Error("fail"));
      const result = await graphRAG.query("q");
      expect(result.content).toBe("");
    });
  });
});
