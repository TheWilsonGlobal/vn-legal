import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LegalConsultationAgent,
  createLegalConsultationAgent,
} from "../../../src/agent/setup";
import type { LegalContextBundle } from "../../../src/shared/types";

function makeEmptyContext(query: string): LegalContextBundle {
  return {
    query,
    seed_articles: [],
    path_context: [],
    community_context: {
      part: {} as any,
      chapter: {} as any,
      section: null,
      subsection: null,
      article_count: 0,
      principles: "",
      hierarchical_context: "",
    },
    community_reports: [],
    relevant_concepts: [],
    hierarchical_filter: {},
    timestamp: new Date(),
  };
}

function makeArticle(id: string, num: number, title: string, content: string) {
  return {
    id,
    article_number: num,
    title,
    content,
    metadata: { part: "", chapter: "", section: "", subsection: "" },
    keywords: [],
    hierarchical_path: "",
    clause_count: 0,
    clauses: [],
  };
}

function makeContextWithArticles(query: string): LegalContextBundle {
  const article = makeArticle(
    "article_21",
    21,
    "Điều 21. Năng lực hành vi dân sự",
    "Năng lực hành vi dân sự của cá nhân...",
  );
  return {
    ...makeEmptyContext(query),
    seed_articles: [{ article_id: "article_21", score: 0.9, article }],
    path_context: [
      { article, depth: 0, path: ["article_21"], relationship: "seed" },
      {
        article: makeArticle(
          "article_22",
          22,
          "Điều 22. Mất năng lực",
          "Nội dung điều 22 chi tiết đầy đủ nhiều ký tự hơn 500 ký tự lặp lại nội dung để đảm bảo test substr hoạt động đúng. ".repeat(
            5,
          ),
        ),
        depth: 1,
        path: ["article_21", "article_22"],
        relationship: "REFERENCES",
      },
    ],
    community_context: {
      part: {
        id: "part_1",
        name: "Phần thứ nhất",
        name_short: "Quy định chung",
        part_number: 1,
        chapter_count: 5,
        article_count: 30,
      },
      chapter: {
        id: "ch1",
        name: "Chương I",
        name_short: "Quy định chung",
        chapter_roman: "I",
        part_id: "part_1",
        article_count: 10,
        section_count: 2,
        summary: "",
      },
      section: null,
      subsection: null,
      article_count: 10,
      principles: "",
      hierarchical_context: "Phần 1 > Chương I",
    },
  };
}

describe("LegalConsultationAgent", () => {
  let mockRetrieval: any;
  let agent: LegalConsultationAgent;

  beforeEach(() => {
    mockRetrieval = {
      retrieve: vi.fn(),
    };
    agent = new LegalConsultationAgent(mockRetrieval);
  });

  describe("consult", () => {
    it("should return no-results response when no articles found", async () => {
      mockRetrieval.retrieve.mockResolvedValue(makeEmptyContext("test query"));
      const result = await agent.consult("test query");
      expect(result.response).toContain("Không tìm thấy");
      expect(result.context.seed_articles).toHaveLength(0);
    });

    it("should generate template response with articles", async () => {
      const ctx = makeContextWithArticles("Năng lực hành vi dân sự là gì?");
      mockRetrieval.retrieve.mockResolvedValue(ctx);
      const result = await agent.consult("Năng lực hành vi dân sự là gì?");
      expect(result.response).toContain("Điều 21");
      expect(result.response).toContain("Tư vấn pháp luật dân sự");
    });

    it("should handle error gracefully", async () => {
      mockRetrieval.retrieve.mockRejectedValue(
        new Error("DB connection failed"),
      );
      const result = await agent.consult("test");
      expect(result.response).toContain("DB connection failed");
      expect(result.context.seed_articles).toHaveLength(0);
    });

    it("should classify and route auto mode to local for specific questions", async () => {
      const ctx = makeContextWithArticles("điều 21 quy định gì?");
      mockRetrieval.retrieve.mockResolvedValue(ctx);
      await agent.consult("điều 21 quy định gì?", undefined, "auto");
      expect(mockRetrieval.retrieve).toHaveBeenCalledWith(
        "điều 21 quy định gì?",
        "local",
        undefined,
      );
    });

    it("should classify and route auto mode to global for summary questions", async () => {
      const ctx = makeContextWithArticles("tóm tắt phần quy định chung");
      mockRetrieval.retrieve.mockResolvedValue(ctx);
      await agent.consult("tóm tắt phần quy định chung", undefined, "auto");
      expect(mockRetrieval.retrieve).toHaveBeenCalledWith(
        "tóm tắt phần quy định chung",
        "global",
        undefined,
      );
    });

    it("should fallback from global to local when no community reports", async () => {
      const emptyGlobal = makeEmptyContext("tổng quan");
      emptyGlobal.community_reports = [];
      const localCtx = makeContextWithArticles("tổng quan");
      mockRetrieval.retrieve
        .mockResolvedValueOnce(emptyGlobal)
        .mockResolvedValueOnce(localCtx);
      const result = await agent.consult("tổng quan", undefined, "auto");
      expect(mockRetrieval.retrieve).toHaveBeenCalledTimes(2);
      expect(result.response).toContain("Điều 21");
    });

    it("should use retrieval-only mode when option is set", async () => {
      const ctx = makeContextWithArticles("Quyền sở hữu");
      mockRetrieval.retrieve.mockResolvedValue(ctx);
      const result = await agent.consult("Quyền sở hữu", undefined, "local", {
        retrievalOnly: true,
      });
      expect(result.response).toContain("truy xuất nhanh");
    });

    it("should pass filters to retrieval", async () => {
      const ctx = makeContextWithArticles("test");
      mockRetrieval.retrieve.mockResolvedValue(ctx);
      const filters = { part_id: "part_1", chapter_id: "ch1" };
      await agent.consult("test", filters, "local");
      expect(mockRetrieval.retrieve).toHaveBeenCalledWith(
        "test",
        "local",
        filters,
      );
    });

    it("should handle non-Error exceptions", async () => {
      mockRetrieval.retrieve.mockRejectedValue("string error");
      const result = await agent.consult("test");
      expect(result.response).toContain("string error");
    });
  });

  describe("classifyQuery (via consult auto mode)", () => {
    beforeEach(() => {
      mockRetrieval.retrieve.mockResolvedValue(makeContextWithArticles(""));
    });

    it('should route "sở hữu chung" to local (specific chung term)', async () => {
      await agent.consult("sở hữu chung", undefined, "auto");
      expect(mockRetrieval.retrieve).toHaveBeenCalledWith(
        "sở hữu chung",
        "local",
        undefined,
      );
    });

    it('should route "khái quát" to global', async () => {
      await agent.consult("khái quát về hợp đồng", undefined, "auto");
      expect(mockRetrieval.retrieve).toHaveBeenCalledWith(
        "khái quát về hợp đồng",
        "global",
        undefined,
      );
    });

    it('should route general "chung" to global when no local keywords', async () => {
      await agent.consult("nguyên tắc chung", undefined, "auto");
      expect(mockRetrieval.retrieve).toHaveBeenCalledWith(
        "nguyên tắc chung",
        "global",
        undefined,
      );
    });

    it("should default to local for ambiguous queries", async () => {
      await agent.consult("hợp đồng mua bán", undefined, "auto");
      expect(mockRetrieval.retrieve).toHaveBeenCalledWith(
        "hợp đồng mua bán",
        "local",
        undefined,
      );
    });
  });

  describe("streamConsultation", () => {
    it("should stream chunks of the response", async () => {
      const ctx = makeContextWithArticles("test");
      mockRetrieval.retrieve.mockResolvedValue(ctx);
      const chunks: string[] = [];
      for await (const chunk of agent.streamConsultation("test")) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join("")).toContain("Tư vấn pháp luật dân sự");
    });

    it("should yield no-results response when no seed articles", async () => {
      mockRetrieval.retrieve.mockResolvedValue(makeEmptyContext("test"));
      const chunks: string[] = [];
      for await (const chunk of agent.streamConsultation("test")) {
        chunks.push(chunk);
      }
      expect(chunks.join("")).toContain("Không tìm thấy");
    });

    it("should handle errors during streaming", async () => {
      mockRetrieval.retrieve.mockRejectedValue(new Error("Stream error"));
      const chunks: string[] = [];
      for await (const chunk of agent.streamConsultation("test")) {
        chunks.push(chunk);
      }
      expect(chunks.join("")).toContain("Stream error");
    });
  });

  describe("createLegalConsultationAgent", () => {
    it("should create an agent instance", () => {
      const agent = createLegalConsultationAgent(mockRetrieval);
      expect(agent).toBeInstanceOf(LegalConsultationAgent);
    });
  });
});
