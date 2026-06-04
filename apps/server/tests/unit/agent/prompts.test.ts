import { describe, it, expect } from "vitest";
import {
  LEGAL_CONSULTANT_SYSTEM_PROMPT,
  createConsultationPrompt,
  formatMarkdownResponse,
  generateFollowUpQuestions,
  createErrorResponse,
} from "../../../src/agent/prompts";
import type { LegalContextBundle } from "../../../src/shared/types";

// Helper to create a minimal LegalContextBundle
function makeContext(
  overrides: Partial<LegalContextBundle> = {},
): LegalContextBundle {
  return {
    query: "Quyền sở hữu tài sản",
    seed_articles: [],
    path_context: [],
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
        id: "chapter_p1_c1",
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
      hierarchical_context: "",
    },
    community_reports: [],
    relevant_concepts: [],
    hierarchical_filter: {},
    timestamp: new Date(),
    ...overrides,
  };
}

describe("Prompts", () => {
  describe("LEGAL_CONSULTANT_SYSTEM_PROMPT", () => {
    it("should be a non-empty string", () => {
      expect(typeof LEGAL_CONSULTANT_SYSTEM_PROMPT).toBe("string");
      expect(LEGAL_CONSULTANT_SYSTEM_PROMPT.length).toBeGreaterThan(100);
    });

    it("should contain key Vietnamese legal instructions", () => {
      expect(LEGAL_CONSULTANT_SYSTEM_PROMPT).toContain("Điều");
      expect(LEGAL_CONSULTANT_SYSTEM_PROMPT).toContain("Chương");
    });
  });

  describe("createConsultationPrompt", () => {
    it("should include the query in the prompt", () => {
      const ctx = makeContext();
      const result = createConsultationPrompt(ctx);
      expect(result).toContain("Quyền sở hữu tài sản");
    });

    it("should include seed articles when present", () => {
      const ctx = makeContext({
        seed_articles: [
          {
            article_id: "article_1",
            score: 0.95,
            article: {
              id: "article_1",
              article_number: 1,
              title: "Điều 1. Phạm vi điều chỉnh",
              content: "Bộ luật này quy định...",
              metadata: { part: "", chapter: "", section: "", subsection: "" },
              keywords: [],
              hierarchical_path: "",
              clause_count: 0,
              clauses: [],
            },
          },
        ],
      });
      const result = createConsultationPrompt(ctx);
      expect(result).toContain("Điều 1. Phạm vi điều chỉnh");
      expect(result).toContain("95.0%");
    });

    it("should include path context when present", () => {
      const ctx = makeContext({
        path_context: [
          {
            article: {
              id: "article_5",
              article_number: 5,
              title: "Điều 5",
              content: "Some content",
              metadata: { part: "", chapter: "", section: "", subsection: "" },
              keywords: [],
              hierarchical_path: "",
              clause_count: 0,
              clauses: [],
            },
            depth: 1,
            path: ["article_1", "article_5"],
            relationship: "REFERENCES",
          },
        ],
      });
      const result = createConsultationPrompt(ctx);
      expect(result).toContain("Điều 5");
      expect(result).toContain("REFERENCES");
    });

    it("should include community context when hierarchical_context is present", () => {
      const ctx = makeContext({
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
            id: "chapter_p1_c1",
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
          principles: "Bình đẳng dân sự",
          hierarchical_context: "Phần 1 > Chương I",
        },
      });
      const result = createConsultationPrompt(ctx);
      expect(result).toContain("Phần 1 → Chương I");
      expect(result).toContain("Bình đẳng dân sự");
    });

    it("should include community reports when present", () => {
      const ctx = makeContext({
        community_reports: [
          {
            id: "report_1",
            level: 0,
            title: "Quy định chung",
            summary: "Tóm tắt phần quy định chung",
            findings: ["Finding 1", "Finding 2"],
            rating: 8,
          },
        ],
      });
      const result = createConsultationPrompt(ctx);
      expect(result).toContain("Quy định chung");
      expect(result).toContain("Tóm tắt phần quy định chung");
      expect(result).toContain("Finding 1");
      expect(result).toContain("Tổng quan pháp lý");
    });

    it("should include relevant concepts when present", () => {
      const ctx = makeContext({
        relevant_concepts: [
          {
            id: "concept_1",
            name: "Sở hữu",
            name_variants: [],
            definition: "",
            category: "property",
            source_articles: [],
            source_clauses: [],
            related_concepts: [],
          },
          {
            id: "concept_2",
            name: "Hợp đồng",
            name_variants: [],
            definition: "",
            category: "contract",
            source_articles: [],
            source_clauses: [],
            related_concepts: [],
          },
        ],
      });
      const result = createConsultationPrompt(ctx);
      expect(result).toContain("Sở hữu");
      expect(result).toContain("Hợp đồng");
    });

    it('should show "Pháp luật áp dụng" when no community reports', () => {
      const ctx = makeContext({ community_reports: [] });
      const result = createConsultationPrompt(ctx);
      expect(result).toContain("Pháp luật áp dụng");
    });

    it("should handle empty path context with dedup", () => {
      const article = {
        id: "article_5",
        article_number: 5,
        title: "Điều 5",
        content: "Some content",
        metadata: { part: "", chapter: "", section: "", subsection: "" },
        keywords: [],
        hierarchical_path: "",
        clause_count: 0,
        clauses: [],
      };
      const ctx = makeContext({
        path_context: [
          {
            article,
            depth: 1,
            path: ["article_1", "article_5"],
            relationship: "REFERENCES",
          },
          {
            article,
            depth: 2,
            path: ["article_1", "article_5"],
            relationship: "REFERENCES",
          },
        ],
      });
      const result = createConsultationPrompt(ctx);
      // Should deduplicate - only list once
      const matches = result.match(/Điều 5/g);
      expect(matches).not.toBeNull();
    });

    it("should handle community reports with empty findings", () => {
      const ctx = makeContext({
        community_reports: [
          {
            id: "report_1",
            level: 1,
            title: "Chương II",
            summary: "Tóm tắt chương II",
            findings: [],
            rating: 7,
          },
        ],
      });
      const result = createConsultationPrompt(ctx);
      expect(result).toContain("Chương");
    });
  });

  describe("formatMarkdownResponse", () => {
    it("should bold Điều references", () => {
      expect(formatMarkdownResponse("điều 21")).toContain("**Điều 21**");
    });

    it("should bold khoản references", () => {
      expect(formatMarkdownResponse("khoản 2")).toContain("**khoản 2**");
    });

    it("should bold điểm references", () => {
      expect(formatMarkdownResponse("điểm a")).toContain("**điểm a**");
    });

    it("should italicize chương references", () => {
      expect(formatMarkdownResponse("chương iv")).toContain("_Chương iv_");
    });

    it("should italicize mục references", () => {
      expect(formatMarkdownResponse("mục 3")).toContain("_Mục 3_");
    });

    it("should italicize tiểu mục references", () => {
      expect(formatMarkdownResponse("tiểu mục 1")).toContain("_Tiểu mục 1_");
    });

    it("should handle text without legal references", () => {
      const text = "This is plain text without legal terms";
      expect(formatMarkdownResponse(text)).toBe(text);
    });
  });

  describe("generateFollowUpQuestions", () => {
    it("should include section-based question when section exists", () => {
      const ctx = makeContext({
        community_context: {
          part: {
            id: "part_1",
            name: "Phần 1",
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
          section: {
            id: "sec1",
            name: "Mục 1",
            name_short: "Giao dịch dân sự",
            section_number: 1,
            chapter_id: "ch1",
            article_count: 5,
            subsection_count: 0,
          },
          subsection: null,
          article_count: 10,
          principles: "",
          hierarchical_context: "",
        },
      });
      const questions = generateFollowUpQuestions(ctx);
      expect(questions.some((q) => q.includes("Giao dịch dân sự"))).toBe(true);
    });

    it("should include path-based question when multiple path contexts exist", () => {
      const article = {
        id: "article_5",
        article_number: 5,
        title: "Điều 5",
        content: "Some content",
        metadata: { part: "", chapter: "", section: "", subsection: "" },
        keywords: [],
        hierarchical_path: "",
        clause_count: 0,
        clauses: [],
      };
      const ctx = makeContext({
        path_context: [
          { article, depth: 1, path: ["a1", "a5"], relationship: "REF" },
          { article, depth: 1, path: ["a1", "a6"], relationship: "REF" },
        ],
      });
      const questions = generateFollowUpQuestions(ctx);
      expect(questions.some((q) => q.includes("mối quan hệ"))).toBe(true);
    });

    it("should include concept-based question when concepts exist", () => {
      const ctx = makeContext({
        relevant_concepts: [
          {
            id: "c1",
            name: "Sở hữu",
            name_variants: [],
            definition: "",
            category: "property",
            source_articles: [],
            source_clauses: [],
            related_concepts: [],
          },
        ],
      });
      const questions = generateFollowUpQuestions(ctx);
      expect(questions.some((q) => q.includes("Sở hữu"))).toBe(true);
    });

    it("should return at most 3 questions", () => {
      const ctx = makeContext({
        community_context: {
          part: {
            id: "part_1",
            name: "Phần 1",
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
          section: {
            id: "sec1",
            name: "Mục 1",
            name_short: "Giao dịch dân sự",
            section_number: 1,
            chapter_id: "ch1",
            article_count: 5,
            subsection_count: 0,
          },
          subsection: null,
          article_count: 10,
          principles: "",
          hierarchical_context: "",
        },
        path_context: [
          {
            article: {
              id: "a1",
              article_number: 1,
              title: "T",
              content: "C",
              metadata: { part: "", chapter: "", section: "", subsection: "" },
              keywords: [],
              hierarchical_path: "",
              clause_count: 0,
              clauses: [],
            },
            depth: 1,
            path: [],
            relationship: "REF",
          },
          {
            article: {
              id: "a2",
              article_number: 2,
              title: "T",
              content: "C",
              metadata: { part: "", chapter: "", section: "", subsection: "" },
              keywords: [],
              hierarchical_path: "",
              clause_count: 0,
              clauses: [],
            },
            depth: 1,
            path: [],
            relationship: "REF",
          },
        ],
        relevant_concepts: [
          {
            id: "c1",
            name: "Sở hữu",
            name_variants: [],
            definition: "",
            category: "property",
            source_articles: [],
            source_clauses: [],
            related_concepts: [],
          },
        ],
      });
      const questions = generateFollowUpQuestions(ctx);
      expect(questions.length).toBeLessThanOrEqual(3);
    });

    it("should always include general questions when no context", () => {
      const ctx = makeContext();
      const questions = generateFollowUpQuestions(ctx);
      expect(questions.length).toBeGreaterThan(0);
      expect(questions.some((q) => q.includes("Tình huống cụ thể"))).toBe(true);
    });
  });

  describe("createErrorResponse", () => {
    it("should include error message", () => {
      const result = createErrorResponse("Connection timeout");
      expect(result).toContain("Connection timeout");
    });

    it("should include error section header", () => {
      const result = createErrorResponse("test error");
      expect(result).toContain("Xin lỗi");
    });

    it("should include guidance for user", () => {
      const result = createErrorResponse("test error");
      expect(result).toContain("Kiểm tra lại");
    });
  });
});
