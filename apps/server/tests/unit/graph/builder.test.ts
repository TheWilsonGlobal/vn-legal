import { describe, it, expect, vi, beforeEach } from "vitest";
import { GraphBuilder, createGraphBuilder } from "../../../src/graph/builder";
import type { ParsedLegalData } from "../../../src/shared/types";

// Mock logger
vi.mock("../../../src/shared/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("GraphBuilder", () => {
  let mockClient: any;
  let builder: GraphBuilder;

  beforeEach(() => {
    mockClient = {
      createNodesBatch: vi.fn().mockResolvedValue([1, 2, 3, 4, 5]),
      createEdgesBatch: vi.fn().mockResolvedValue(undefined),
      getNode: vi.fn().mockResolvedValue(null),
      idToOffset: new Map(),
    };
    builder = new GraphBuilder(mockClient);
  });

  const makeEmptyParsedData = (): ParsedLegalData => ({
    parts: new Map(),
    chapters: new Map(),
    sections: new Map(),
    subsections: new Map(),
    articles: new Map(),
    partToChapters: new Map(),
    chapterToSections: new Map(),
    sectionToSubsections: new Map(),
    articleToParent: new Map(),
    communityReports: [],
  });

  describe("buildGraph", () => {
    it("should build a full graph with hierarchy and articles", async () => {
      const data = makeEmptyParsedData();
      data.parts.set("p1", {
        id: "p1",
        name: "Part 1",
        name_short: "P1",
        part_number: 1,
        chapter_count: 1,
        article_count: 1,
      });
      data.chapters.set("c1", {
        id: "c1",
        name: "Chapter 1",
        name_short: "C1",
        chapter_roman: "I",
        part_id: "p1",
        article_count: 1,
        section_count: 0,
        summary: "",
      });
      data.partToChapters.set("p1", ["c1"]);

      const article = {
        id: "article_1",
        article_number: 1,
        title: "Article 1",
        content: "Content references Điều 2",
        metadata: { part: "P1", chapter: "C1", section: "", subsection: "" },
        keywords: ["test"],
        hierarchical_path: "P1 > C1",
        clause_count: 1,
        clauses: [
          {
            id: "c1",
            clause_number: 1,
            text: "Clause 1",
            article_id: "article_1",
            points: [
              { id: "p1", point_letter: "a", text: "Point a", clause_id: "c1" },
            ],
            point_count: 1,
          },
        ],
      };
      data.articles.set("article_1", article);
      data.articleToParent.set("article_1", { type: "chapter", id: "c1" });

      // Mock Article 2 existing in DB for reference
      mockClient.getNode.mockImplementation((type, id) => {
        if (type === "Article" && id === "article_2")
          return { id: "article_2" };
        return null;
      });

      await builder.buildGraph(data);

      expect(mockClient.createNodesBatch).toHaveBeenCalledWith(
        "Part",
        expect.any(Array),
      );
      expect(mockClient.createNodesBatch).toHaveBeenCalledWith(
        "Chapter",
        expect.any(Array),
      );
      expect(mockClient.createNodesBatch).toHaveBeenCalledWith(
        "Article",
        expect.any(Array),
      );
      expect(mockClient.createNodesBatch).toHaveBeenCalledWith(
        "Clause",
        expect.any(Array),
      );
      expect(mockClient.createNodesBatch).toHaveBeenCalledWith(
        "ClausePoint",
        expect.any(Array),
      );
      expect(mockClient.createEdgesBatch).toHaveBeenCalled();
    });

    it("should handle complex hierarchy (sections/subsections)", async () => {
      const data = makeEmptyParsedData();
      data.sections.set("s1", {
        id: "s1",
        name: "Section 1",
        name_short: "S1",
        section_number: 1,
        chapter_id: "c1",
        article_count: 1,
        subsection_count: 1,
      });
      data.subsections.set("ss1", {
        id: "ss1",
        name: "Sub 1",
        name_short: "SS1",
        subsection_number: 1,
        section_id: "s1",
        article_count: 1,
      });
      data.chapterToSections.set("c1", ["s1"]);
      data.sectionToSubsections.set("s1", ["ss1"]);

      data.articleToParent.set("a1", { type: "subsection", id: "ss1" });
      data.articles.set("a1", {
        id: "a1",
        article_number: 1,
        clauses: [],
      } as any);

      await builder.buildGraph(data);

      expect(mockClient.createNodesBatch).toHaveBeenCalledWith(
        "Section",
        expect.any(Array),
      );
      expect(mockClient.createNodesBatch).toHaveBeenCalledWith(
        "Subsection",
        expect.any(Array),
      );
    });

    it("should handle community reports", async () => {
      const data = makeEmptyParsedData();
      data.communityReports = [
        {
          id: "comm1",
          community_id: "comm1",
          level: 0,
          title: "Part Comm",
          summary: "S",
          findings: [],
          rating: 5,
        },
        {
          id: "comm2",
          community_id: "comm2",
          level: 1,
          title: "Chap Comm",
          summary: "S",
          findings: ["f"],
          rating: 7,
          parent_id: "comm1",
        },
      ];
      // Articles belonging to sections/subsections that need to map to chapters
      data.articleToParent.set("a1", { type: "section", id: "s1" });
      data.sections.set("s1", { id: "s1", chapter_id: "comm2" } as any);
      data.articles.set("a1", { id: "a1", clauses: [] } as any);

      mockClient.idToOffset.set("comm2", 123);

      await builder.buildGraph(data);
      expect(mockClient.createNodesBatch).toHaveBeenCalledWith(
        "Community",
        expect.any(Array),
      );
    });

    it("should handle community reports with subsection parents", async () => {
      const data = makeEmptyParsedData();
      data.communityReports = [
        {
          id: "chap1",
          level: 1,
          title: "Chap",
          summary: "S",
          findings: [],
          rating: 5,
        },
      ];
      data.articleToParent.set("a1", { type: "subsection", id: "ss1" });
      data.subsections.set("ss1", { id: "ss1", section_id: "s1" } as any);
      data.sections.set("s1", { id: "s1", chapter_id: "chap1" } as any);
      data.articles.set("a1", { id: "a1", clauses: [] } as any);

      mockClient.idToOffset.set("chap1", 456);

      await builder.buildGraph(data);
      expect(mockClient.createEdgesBatch).toHaveBeenCalled();
    });
  });

  describe("addGraph", () => {
    it("should call runBuildPipeline with isFullRebuild=false", async () => {
      const spy = vi.spyOn(builder as any, "runBuildPipeline");
      const data = makeEmptyParsedData();
      await builder.addGraph(data);
      expect(spy).toHaveBeenCalledWith(data, false);
    });
  });

  describe("createGraphBuilder", () => {
    it("should create an instance", async () => {
      const instance = await createGraphBuilder(mockClient);
      expect(instance).toBeInstanceOf(GraphBuilder);
    });
  });
});
