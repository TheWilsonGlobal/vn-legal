import { describe, it, expect, vi } from "vitest";
import {
  ResponseFormatter,
  createResponseFormatter,
} from "../../../src/agent/formatter";
import { LegalContextBundle } from "../../../src/shared/types";

describe("ResponseFormatter", () => {
  const formatter = createResponseFormatter();

  const mockContext: LegalContextBundle = {
    query: "test query",
    timestamp: new Date("2024-01-01T00:00:00Z"),
    seed_articles: [
      {
        article_id: "article_1",
        score: 0.9,
        article: {
          id: "article_1",
          article_number: 1,
          title: "Title 1",
          content: "Content 1",
          metadata: {
            part: "Part 1",
            chapter: "Chapter 1",
            section: "Section 1",
            subsection: "Subsection 1",
          },
          keywords: [],
          hierarchical_path: "",
          clause_count: 0,
          clauses: [],
        },
      },
    ],
    path_context: [],
    community_context: {
      part: {
        id: "part_1",
        name: "Part 1",
        name_short: "P1",
        part_number: 1,
        chapter_count: 1,
        article_count: 1,
      },
      chapter: {
        id: "chap_1",
        name: "Chapter 1",
        name_short: "C1",
        chapter_roman: "I",
        part_id: "part_1",
        article_count: 1,
        section_count: 1,
        summary: "",
      },
      section: null,
      subsection: null,
      article_count: 1,
      principles: "",
      hierarchical_context: "Part 1 > Chapter 1",
    },
    community_reports: [],
    relevant_concepts: [
      {
        id: "c1",
        name: "Concept 1",
        name_variants: [],
        definition: "",
        category: "person",
        source_articles: [],
        source_clauses: [],
        related_concepts: [],
      },
    ],
    hierarchical_filter: {},
  };

  describe("formatResponse", () => {
    it("should format response with markdown, html, text and metadata", () => {
      const response = "# Header\n**Bold** *Italic*";
      const result = formatter.formatResponse(response, mockContext);

      expect(result.markdown).toBe(response);
      expect(result.html).toContain("<h1>Header</h1>");
      expect(result.html).toContain("<strong>Bold</strong>");
      expect(result.html).toContain("<em>Italic</em>");
      expect(result.text).toBe("Header\n\nBold Italic");
      expect(result.metadata.query).toBe(mockContext.query);
      expect(result.metadata.articlesCited).toBe(1);
      expect(result.metadata.conceptsFound).toBe(1);
    });
  });

  describe("formatArticleCitation", () => {
    it("should format article citation correctly", () => {
      const citation = formatter.formatArticleCitation(
        "article_1",
        1,
        "Title 1",
      );
      expect(citation).toBe("**Điều 1**: Title 1");
    });
  });

  describe("formatClauseCitation", () => {
    it("should format clause citation and truncate text", () => {
      const longText = "a".repeat(150);
      const citation = formatter.formatClauseCitation(1, 2, longText);
      expect(citation).toContain("**Khoản 2, Điều 1**:");
      expect(citation).toContain("...");
      expect(citation.length).toBeLessThan(150 + 30);
    });

    it("should format clause citation without truncation for short text", () => {
      const shortText = "Short text";
      const citation = formatter.formatClauseCitation(1, 2, shortText);
      expect(citation).toBe("**Khoản 2, Điều 1**: Short text");
    });
  });

  describe("formatHierarchicalPath", () => {
    it("should replace > with →", () => {
      const path = formatter.formatHierarchicalPath(mockContext);
      expect(path).toBe("Part 1 → Chapter 1");
    });

    it("should return empty string if no hierarchical context", () => {
      const emptyContext = {
        ...mockContext,
        community_context: {
          ...mockContext.community_context,
          hierarchical_context: "",
        },
      };
      const path = formatter.formatHierarchicalPath(emptyContext);
      expect(path).toBe("");
    });
  });

  describe("formatConceptTags", () => {
    it("should format concepts with categories", () => {
      const concepts = [
        { name: "Concept 1", category: "Category 1" },
        { name: "Concept 2" },
      ];
      const tags = formatter.formatConceptTags(concepts);
      expect(tags).toEqual(["Concept 1 (Category 1)", "Concept 2"]);
    });
  });
});
