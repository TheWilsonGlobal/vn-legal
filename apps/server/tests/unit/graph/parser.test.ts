import { describe, it, expect, vi } from "vitest";
import {
  extractHierarchy,
  parsePartNumber,
  cleanHierarchyName,
  parseChapterInfo,
  parseSectionInfo,
  parseSubsectionInfo,
  loadLegalData,
  parseLegalData,
  loadCommunityReports,
} from "../../../src/graph/parser";
import type { RawArticleJson } from "../../../src/shared/types";

// Mock fs and path
vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

import { readdir, readFile } from "node:fs/promises";
const mockReaddir = vi.mocked(readdir);
const mockReadFile = vi.mocked(readFile);

// Mock logger
vi.mock("../../../src/shared/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

function makeRawArticle(
  overrides: Partial<RawArticleJson> = {},
): RawArticleJson {
  return {
    article_number: 1,
    title: "Điều 1",
    content: "Test content",
    metadata: {
      part: "Phần thứ nhất: Quy định chung",
      chapter: "Chương I: Quy định chung",
      section: "",
      subsection: "",
    },
    clauses: [],
    keywords: [],
    references: [],
    ...overrides,
  };
}

describe("Graph Parser", () => {
  describe("parsePartNumber", () => {
    it("should parse Vietnamese ordinals", () => {
      expect(parsePartNumber("Phần thứ nhất")).toBe(1);
      expect(parsePartNumber("Phần thứ hai")).toBe(2);
      expect(parsePartNumber("Phần thứ ba")).toBe(3);
      expect(parsePartNumber("Phần thứ tư")).toBe(4);
      expect(parsePartNumber("Phần thứ năm")).toBe(5);
      expect(parsePartNumber("Phần thứ sáu")).toBe(6);
      expect(parsePartNumber("Phần thứ bảy")).toBe(7);
    });

    it("should parse numeric parts", () => {
      expect(parsePartNumber("Phần thứ 1")).toBe(1);
      expect(parsePartNumber("Phần 2")).toBe(2);
    });

    it("should return 0 for empty string", () => {
      expect(parsePartNumber("")).toBe(0);
    });

    it("should return 0 for unrecognized format", () => {
      expect(parsePartNumber("Something else")).toBe(0);
    });
  });

  describe("cleanHierarchyName", () => {
    it("should clean valid part names", () => {
      expect(cleanHierarchyName("Phần thứ nhất: Quy định chung", "part")).toBe(
        "Phần thứ nhất: Quy định chung",
      );
    });

    it("should reject invalid part names", () => {
      expect(cleanHierarchyName("Chương I", "part")).toBe("");
    });

    it("should clean valid chapter names", () => {
      expect(cleanHierarchyName("Chương I: Quy định chung", "chapter")).toBe(
        "Chương I: Quy định chung",
      );
    });

    it("should reject invalid chapter names", () => {
      expect(cleanHierarchyName("Phần thứ nhất", "chapter")).toBe("");
    });

    it("should clean valid section names", () => {
      expect(cleanHierarchyName("Mục 1: Giao dịch dân sự", "section")).toBe(
        "Mục 1: Giao dịch dân sự",
      );
    });

    it("should reject invalid section names", () => {
      expect(cleanHierarchyName("Chương I", "section")).toBe("");
    });

    it("should clean valid subsection names", () => {
      expect(cleanHierarchyName("Tiểu mục 1: Chi tiết", "subsection")).toBe(
        "Tiểu mục 1: Chi tiết",
      );
    });

    it("should reject invalid subsection names", () => {
      expect(cleanHierarchyName("Mục 1", "subsection")).toBe("");
    });

    it("should return empty for empty input", () => {
      expect(cleanHierarchyName("", "part")).toBe("");
    });

    it("should reject names longer than 150 chars", () => {
      const longName = "Phần " + "a".repeat(200);
      expect(cleanHierarchyName(longName, "part")).toBe("");
    });

    it("should trim whitespace", () => {
      expect(cleanHierarchyName("  Phần thứ nhất  ", "part")).toBe(
        "Phần thứ nhất",
      );
    });
  });

  describe("parseChapterInfo", () => {
    it("should parse chapter with roman numeral", () => {
      const result = parseChapterInfo("Chương I: Quy định chung");
      expect(result).not.toBeNull();
      expect(result!.chapterNumber).toBe(1);
      expect(result!.chapterRoman).toBe("I");
    });

    it("should parse chapter with complex roman numeral", () => {
      const result = parseChapterInfo("Chương XXVIII: Nội dung");
      expect(result).not.toBeNull();
      expect(result!.chapterNumber).toBe(28);
      expect(result!.chapterRoman).toBe("XXVIII");
    });

    it("should return null for non-chapter strings", () => {
      expect(parseChapterInfo("Phần thứ nhất")).toBeNull();
    });

    it("should return null for missing roman numeral", () => {
      expect(parseChapterInfo("Chương: Nội dung")).toBeNull();
    });

    it("should handle unknown roman numerals with 0", () => {
      const result = parseChapterInfo("Chương XLIX: Nội dung");
      expect(result).not.toBeNull();
      expect(result!.chapterNumber).toBe(0);
    });
  });

  describe("parseSectionInfo", () => {
    it("should parse section name with number and name", () => {
      const result = parseSectionInfo("Mục 1: Giao dịch dân sự");
      expect(result.sectionNumber).toBe(1);
      expect(result.nameShort).toBe("Giao dịch dân sự");
    });

    it("should handle trailing commas", () => {
      const result = parseSectionInfo("Mục 2: Nội dung,,,");
      expect(result.nameShort).toBe("Nội dung");
    });

    it("should return 0 and full name for unmatched format", () => {
      const result = parseSectionInfo("Something else");
      expect(result.sectionNumber).toBe(0);
      expect(result.nameShort).toBe("Something else");
    });
  });

  describe("parseSubsectionInfo", () => {
    it("should parse subsection name", () => {
      const result = parseSubsectionInfo("Tiểu mục 1: Chi tiết");
      expect(result.subsectionNumber).toBe(1);
      expect(result.nameShort).toBe("Chi tiết");
    });

    it("should return 0 and full name for unmatched format", () => {
      const result = parseSubsectionInfo("Other text");
      expect(result.subsectionNumber).toBe(0);
      expect(result.nameShort).toBe("Other text");
    });
  });

  describe("extractHierarchy", () => {
    it("should extract unique parts, chapters, sections, subsections", () => {
      const articles = [
        makeRawArticle({
          metadata: {
            part: "Phần thứ nhất",
            chapter: "Chương I",
            section: "Mục 1",
            subsection: "",
          },
        }),
        makeRawArticle({
          metadata: {
            part: "Phần thứ nhất",
            chapter: "Chương II",
            section: "",
            subsection: "",
          },
        }),
        makeRawArticle({
          metadata: {
            part: "Phần thứ hai",
            chapter: "Chương III",
            section: "Mục 1",
            subsection: "Tiểu mục 1",
          },
        }),
      ];

      const hierarchy = extractHierarchy(articles);
      expect(hierarchy.parts.size).toBe(2);
      expect(hierarchy.chapters.size).toBe(3);
      expect(hierarchy.sections.size).toBe(1);
      expect(hierarchy.subsections.size).toBe(1);
    });

    it("should handle empty articles array", () => {
      const hierarchy = extractHierarchy([]);
      expect(hierarchy.parts.size).toBe(0);
      expect(hierarchy.chapters.size).toBe(0);
    });

    it("should skip empty metadata fields", () => {
      const articles = [
        makeRawArticle({
          metadata: { part: "", chapter: "", section: "", subsection: "" },
        }),
      ];
      const hierarchy = extractHierarchy(articles);
      expect(hierarchy.parts.size).toBe(0);
      expect(hierarchy.chapters.size).toBe(0);
    });
  });

  describe("loadLegalData", () => {
    it("should load articles from json files", async () => {
      mockReaddir.mockResolvedValue(["data1.json", "data2.json"] as any);
      mockReadFile.mockResolvedValue(
        JSON.stringify([makeRawArticle({ article_number: 1 })]),
      );

      const result = await loadLegalData();
      expect(result).toHaveLength(2);
      expect(mockReaddir).toHaveBeenCalled();
    });

    it("should throw and log error on failure", async () => {
      mockReaddir.mockRejectedValue(new Error("Read error"));
      await expect(loadLegalData()).rejects.toThrow("Read error");
    });

    it("should ignore community_reports.json", async () => {
      mockReaddir.mockResolvedValue([
        "community_reports.json",
        "legal.json",
      ] as any);
      mockReadFile.mockResolvedValue(JSON.stringify([makeRawArticle()]));
      const result = await loadLegalData();
      expect(result).toHaveLength(1);
    });
  });

  describe("loadCommunityReports", () => {
    it("should load reports from community_reports.json", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify([{ id: "r1", title: "Report" }]),
      );
      const result = await loadCommunityReports();
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Report");
    });

    it("should return empty array and log error if file missing", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      const result = await loadCommunityReports();
      expect(result).toEqual([]);
    });
  });

  describe("parseLegalData", () => {
    it("should transform raw json to ParsedLegalData", async () => {
      const articles = [
        makeRawArticle({
          article_number: 21,
          metadata: {
            part: "Phần thứ nhất: Quy định chung",
            chapter: "Chương I: Quy định chung",
            section: "Mục 1: Giao dịch",
            subsection: "",
          },
          content: "1. Nội dung điều 21",
        }),
      ];
      const result = await parseLegalData(articles);
      expect(result.articles.has("article_21")).toBe(true);
      expect(result.parts.has("part_1")).toBe(true);
    });

    it("should handle articles with subsection metadata", async () => {
      const articles = [
        makeRawArticle({
          article_number: 100,
          metadata: {
            part: "Phần 1",
            chapter: "Chương 1",
            section: "Mục 1",
            subsection: "Tiểu mục 1",
          },
        }),
      ];
      const result = await parseLegalData(articles);
      expect(result.subsections.size).toBeGreaterThan(0);
    });

    it("should handle articles without hierarchy metadata", async () => {
      const articles = [
        makeRawArticle({
          metadata: { part: "", chapter: "", section: "", subsection: "" },
        }),
      ];
      const result = await parseLegalData(articles);
      // It should create at least the default "Phần chưa phân loại"
      expect(result.parts.size).toBe(1);
      expect(result.parts.get("part_0")?.name).toBe("Phần chưa phân loại");
    });
  });
});
