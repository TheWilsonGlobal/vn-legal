import { describe, it, expect, vi } from "vitest";
import {
  NodeType,
  EdgeType,
  generatePartId,
  generateChapterId,
  generateSectionId,
  generateSubsectionId,
  generateArticleId,
  generateClauseId,
  generatePointId,
  generateConceptId,
  parseArticleClauses,
  parseClausePoints,
  extractKeywords,
  detectArticleReferences,
  detectClauseReferences,
  detectPointReferences,
} from "../../../src/graph/schema";

describe("Graph Schema", () => {
  describe("NodeType constants", () => {
    it("should define all node types", () => {
      expect(NodeType.ARTICLE).toBe("Article");
      expect(NodeType.CLAUSE).toBe("Clause");
      expect(NodeType.POINT).toBe("ClausePoint");
      expect(NodeType.PART).toBe("Part");
      expect(NodeType.CHAPTER).toBe("Chapter");
      expect(NodeType.SECTION).toBe("Section");
      expect(NodeType.SUBSECTION).toBe("Subsection");
      expect(NodeType.CONCEPT).toBe("LegalConcept");
    });
  });

  describe("EdgeType constants", () => {
    it("should define hierarchy edges", () => {
      expect(EdgeType.HAS_CHAPTER).toBe("HAS_CHAPTER");
      expect(EdgeType.HAS_SECTION).toBe("HAS_SECTION");
      expect(EdgeType.HAS_SUBSECTION).toBe("HAS_SUBSECTION");
      expect(EdgeType.BELONGS_TO).toBe("BELONGS_TO");
      expect(EdgeType.HAS_CLAUSE).toBe("HAS_CLAUSE");
      expect(EdgeType.HAS_POINT).toBe("HAS_POINT");
    });

    it("should define reference edges", () => {
      expect(EdgeType.REFERENCES).toBe("REFERENCES");
      expect(EdgeType.REFERENCED_BY).toBe("REFERENCED_BY");
    });

    it("should define other edges", () => {
      expect(EdgeType.NEXT_ARTICLE).toBe("NEXT_ARTICLE");
      expect(EdgeType.DEFINES).toBe("DEFINES");
      expect(EdgeType.RELATED_TO).toBe("RELATED_TO");
      expect(EdgeType.REQUIRES).toBe("REQUIRES");
      expect(EdgeType.CONTRADICTS).toBe("CONTRADICTS");
      expect(EdgeType.SUPERSEDES).toBe("SUPERSEDES");
    });
  });

  describe("ID generation functions", () => {
    it("generatePartId", () => {
      expect(generatePartId(1)).toBe("part_1");
      expect(generatePartId(5)).toBe("part_5");
    });

    it("generateChapterId", () => {
      expect(generateChapterId(1, 3)).toBe("chapter_p1_c3");
      expect(generateChapterId("2", "10")).toBe("chapter_p2_c10");
    });

    it("generateSectionId", () => {
      expect(generateSectionId("chapter_p1_c3", 2)).toBe(
        "section_chapter_p1_c3_s2",
      );
    });

    it("generateSubsectionId", () => {
      expect(generateSubsectionId("section_chapter_p1_c3_s2", 1)).toBe(
        "subsection_section_chapter_p1_c3_s2_ss1",
      );
    });

    it("generateArticleId", () => {
      expect(generateArticleId(21)).toBe("article_21");
    });

    it("generateClauseId", () => {
      expect(generateClauseId("article_21", 1)).toBe("article_21_clause_1");
    });

    it("generatePointId", () => {
      expect(generatePointId("article_21_clause_1", "a")).toBe(
        "article_21_clause_1_point_a",
      );
    });

    it("generateConceptId", () => {
      expect(generateConceptId("Quyền Sở Hữu")).toBe("concept_quyền_sở_hữu");
    });
  });

  describe("parseArticleClauses", () => {
    it("should parse numbered clauses", () => {
      const content =
        "1. Clause one text.\n2. Clause two text.\n3. Clause three text.";
      const clauses = parseArticleClauses("article_1", content);
      expect(clauses).toHaveLength(3);
      expect(clauses[0].clause_number).toBe(1);
      expect(clauses[0].text).toContain("Clause one text");
      expect(clauses[1].clause_number).toBe(2);
      expect(clauses[2].clause_number).toBe(3);
    });

    it("should treat content without numbered clauses as single clause", () => {
      const content = "This is a simple article without numbered clauses.";
      const clauses = parseArticleClauses("article_2", content);
      expect(clauses).toHaveLength(1);
      expect(clauses[0].clause_number).toBe(1);
      expect(clauses[0].text).toBe(content);
    });

    it("should prepend preamble text to first clause", () => {
      const content = "Preamble text.\n1. First clause.\n2. Second clause.";
      const clauses = parseArticleClauses("article_3", content);
      expect(clauses[0].text).toContain("Preamble text");
      expect(clauses[0].text).toContain("First clause");
    });

    it("should handle array content", () => {
      const content = ["Line 1", "Line 2", "1. Clause one."];
      const clauses = parseArticleClauses("article_4", content);
      expect(clauses.length).toBeGreaterThan(0);
    });

    it("should handle object content", () => {
      const content = { key1: "value1", key2: "1. Clause one." };
      const clauses = parseArticleClauses("article_5", content);
      expect(clauses.length).toBeGreaterThan(0);
    });

    it("should handle null/undefined content", () => {
      const clauses = parseArticleClauses("article_6", null);
      expect(clauses).toHaveLength(1);
    });

    it("should generate correct clause IDs", () => {
      const content = "1. First.\n2. Second.";
      const clauses = parseArticleClauses("article_7", content);
      expect(clauses[0].id).toBe("article_7_clause_1");
      expect(clauses[1].id).toBe("article_7_clause_2");
    });

    it("should parse points within clauses", () => {
      const content =
        "1. Clause with points:\na) Point a text\nb) Point b text";
      const clauses = parseArticleClauses("article_8", content);
      expect(clauses[0].points.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("parseClausePoints", () => {
    it("should parse lettered points", () => {
      const text =
        "1. Clause text:\na) First point\nb) Second point\nc) Third point";
      const points = parseClausePoints("clause_1", text);
      expect(points).toHaveLength(3);
      expect(points[0].point_letter).toBe("a");
      expect(points[0].text).toBe("First point");
      expect(points[1].point_letter).toBe("b");
    });

    it("should return empty array when no points", () => {
      const text = "Simple clause without points.";
      const points = parseClausePoints("clause_2", text);
      expect(points).toHaveLength(0);
    });

    it("should handle non-string input", () => {
      const points = parseClausePoints("clause_3", null);
      expect(points).toHaveLength(0);
    });

    it("should generate correct point IDs", () => {
      const text = "a) Point a\nb) Point b";
      const points = parseClausePoints("clause_4", text);
      expect(points[0].id).toContain("clause_4");
      expect(points[0].id).toContain("point_a");
    });
  });

  describe("extractKeywords", () => {
    it("should extract matching legal terms", () => {
      const keywords = extractKeywords(
        "Quyền dân sự",
        "Cá nhân có quyền dân sự",
      );
      expect(keywords).toContain("quyền dân sự");
      expect(keywords).toContain("cá nhân");
    });

    it("should deduplicate keywords", () => {
      const keywords = extractKeywords(
        "Hợp đồng",
        "Hợp đồng mua bán là hợp đồng",
      );
      const hoptongCount = keywords.filter((k) => k === "hợp đồng").length;
      expect(hoptongCount).toBeLessThanOrEqual(1);
    });

    it("should handle non-string content", () => {
      const keywords = extractKeywords("Title", null as any);
      expect(Array.isArray(keywords)).toBe(true);
    });

    it("should extract terms from title and content", () => {
      const keywords = extractKeywords(
        "Thừa kế theo pháp luật",
        "Nghĩa vụ của người thừa kế",
      );
      expect(keywords).toContain("thừa kế");
      expect(keywords).toContain("nghĩa vụ");
    });
  });

  describe("detectArticleReferences", () => {
    it("should detect article references", () => {
      const refs = detectArticleReferences(
        "theo quy định tại Điều 21 và Điều 22",
      );
      expect(refs).toContain(21);
      expect(refs).toContain(22);
    });

    it("should deduplicate references", () => {
      const refs = detectArticleReferences("Điều 21, xem thêm Điều 21");
      expect(refs.filter((r) => r === 21)).toHaveLength(1);
    });

    it("should handle non-string input", () => {
      const refs = detectArticleReferences(null);
      expect(refs).toHaveLength(0);
    });

    it("should be case-insensitive", () => {
      const refs = detectArticleReferences("điều 10");
      expect(refs).toContain(10);
    });
  });

  describe("detectClauseReferences", () => {
    it("should detect clause references", () => {
      const refs = detectClauseReferences("khoản 2, khoản 3");
      expect(refs).toContain("khoản 2");
      expect(refs).toContain("khoản 3");
    });

    it("should deduplicate clause references", () => {
      const refs = detectClauseReferences("khoản 2, khoản 2");
      expect(refs.filter((r) => r === "khoản 2")).toHaveLength(1);
    });

    it("should handle non-string input", () => {
      const refs = detectClauseReferences(undefined);
      expect(refs).toHaveLength(0);
    });
  });

  describe("detectPointReferences", () => {
    it("should detect point references", () => {
      const refs = detectPointReferences("điểm a, điểm b");
      expect(refs.length).toBeGreaterThanOrEqual(2);
    });

    it("should deduplicate", () => {
      const refs = detectPointReferences("điểm a, điểm a");
      expect(refs.filter((r) => r.includes("a")).length).toBe(1);
    });

    it("should handle non-string input", () => {
      const refs = detectPointReferences(null);
      expect(refs).toHaveLength(0);
    });
  });
});
