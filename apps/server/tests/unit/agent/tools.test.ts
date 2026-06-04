import { describe, it, expect, vi } from "vitest";
import {
  retrieveLegalContext,
  analyzeLegalEntities,
  extractLegalConcepts,
  formatArticleReference,
  getHierarchicalContext,
  agentTools,
} from "../../../src/agent/tools";
import { LegalContextBundle } from "../../../src/shared/types";

describe("Agent Tools", () => {
  describe("retrieveLegalContext", () => {
    it("should call retrieval.retrieve with correct arguments", async () => {
      const mockRetrieval = {
        retrieve: vi.fn().mockResolvedValue({ query: "test" } as any),
      };
      const result = await retrieveLegalContext(
        mockRetrieval as any,
        "test query",
        "local",
      );
      expect(mockRetrieval.retrieve).toHaveBeenCalledWith(
        "test query",
        "local",
      );
      expect(result).toEqual({ query: "test" });
    });
  });

  describe("analyzeLegalEntities", () => {
    it("should identify person entities", async () => {
      const text = "Người này là chồng của bà kia";
      const result = await analyzeLegalEntities(text);
      expect(
        result.entities.some((e) => e.type === "person" && e.name === "người"),
      ).toBe(true);
      expect(
        result.entities.some((e) => e.type === "person" && e.name === "chồng"),
      ).toBe(true);
      expect(result.summary).toContain("Phát hiện");
    });

    it("should identify organization entities", async () => {
      const text = "Công ty ABC là một doanh nghiệp";
      const result = await analyzeLegalEntities(text);
      expect(
        result.entities.some(
          (e) => e.type === "organization" && e.name === "công ty",
        ),
      ).toBe(true);
      expect(
        result.entities.some(
          (e) => e.type === "organization" && e.name === "doanh nghiệp",
        ),
      ).toBe(true);
    });

    it("should identify property entities", async () => {
      const text = "Nhà đất và tài sản";
      const result = await analyzeLegalEntities(text);
      expect(
        result.entities.some((e) => e.type === "property" && e.name === "nhà"),
      ).toBe(true);
      expect(
        result.entities.some((e) => e.type === "property" && e.name === "đất"),
      ).toBe(true);
    });

    it("should identify contract entities", async () => {
      const text = "Hợp đồng thỏa thuận";
      const result = await analyzeLegalEntities(text);
      expect(
        result.entities.some(
          (e) => e.type === "contract" && e.name === "hợp đồng",
        ),
      ).toBe(true);
    });

    it("should return default summary when no entities found", async () => {
      const result = await analyzeLegalEntities("xyz");
      expect(result.entities).toHaveLength(0);
      expect(result.summary).toBe("Không phát hiện thực thể pháp lý cụ thể");
    });
  });

  describe("extractLegalConcepts", () => {
    it("should extract concepts from context bundle", async () => {
      const mockContext = {
        relevant_concepts: [
          { name: "Concept 1", category: "Category 1" },
          { name: "Concept 2", category: "Category 2" },
        ],
      } as any;
      const result = await extractLegalConcepts(mockContext);
      expect(result.concepts).toHaveLength(2);
      expect(result.concepts[0].name).toBe("Concept 1");
      expect(result.concepts[0].relevance).toBe(1.0);
      expect(result.concepts[1].relevance).toBe(0.9);
      expect(result.summary).toContain("Phát hiện 2 khái niệm");
    });

    it("should return empty list when no concepts", async () => {
      const mockContext = { relevant_concepts: [] } as any;
      const result = await extractLegalConcepts(mockContext);
      expect(result.concepts).toHaveLength(0);
      expect(result.summary).toBe("Không phát hiện khái niệm pháp lý cụ thể");
    });
  });

  describe("formatArticleReference", () => {
    it("should format article reference with title", async () => {
      const result = await formatArticleReference(1, "Title 1");
      expect(result).toBe("**Điều 1**: Title 1");
    });

    it("should include snippet and truncate if needed", async () => {
      const snippet = "a".repeat(300);
      const result = await formatArticleReference(1, "Title 1", snippet);
      expect(result).toContain("**Điều 1**: Title 1");
      expect(result).toContain("...");
      expect(result.length).toBeLessThan(300);
    });
  });

  describe("getHierarchicalContext", () => {
    it("should extract hierarchical info from context", async () => {
      const mockContext = {
        community_context: {
          hierarchical_context: "P > C",
          part: { name: "Part" },
          chapter: { name: "Chapter" },
          section: { name: "Section" },
        },
      } as any;
      const result = await getHierarchicalContext(mockContext);
      expect(result.path).toBe("P > C");
      expect(result.part).toBe("Part");
      expect(result.chapter).toBe("Chapter");
      expect(result.section).toBe("Section");
      expect(result.subsection).toBe("");
    });
  });

  describe("agentTools registry", () => {
    it("should export all tools", () => {
      expect(agentTools.retrieveLegalContext).toBe(retrieveLegalContext);
      expect(agentTools.analyzeLegalEntities).toBe(analyzeLegalEntities);
      expect(agentTools.extractLegalConcepts).toBe(extractLegalConcepts);
      expect(agentTools.formatArticleReference).toBe(formatArticleReference);
      expect(agentTools.getHierarchicalContext).toBe(getHierarchicalContext);
    });
  });
});
