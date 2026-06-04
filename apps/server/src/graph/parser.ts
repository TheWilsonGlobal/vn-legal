// ============================================================================
// JSON Parser for Vietnam Legal Data
// ============================================================================

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  RawArticleJson,
  ArticleNode,
  ParsedLegalData,
} from "../shared/types";
import {
  generatePartId,
  generateChapterId,
  generateSectionId,
  generateSubsectionId,
  generateArticleId,
  parseArticleClauses,
  extractKeywords,
} from "./schema";
import logger from "../shared/logger";

// ----------------------------------------------------------------------------
// Parsed Data Structures
// ----------------------------------------------------------------------------

export interface HierarchyInfo {
  parts: Set<string>;
  chapters: Set<string>;
  sections: Set<string>;
  subsections: Set<string>;
}

// ----------------------------------------------------------------------------
// Parser Implementation
// ----------------------------------------------------------------------------

/**
 * Load and parse the Vietnam Civil Law JSON file
 */
export async function loadLegalData(): Promise<RawArticleJson[]> {
  try {
    const dataDir = join(process.cwd(), "data");
    const files = await readdir(dataDir);
    if (!files) {
      logger.warn(`No files found in data directory: ${dataDir}`);
      return [];
    }
    const jsonFiles = files.filter(
      (f) => f.endsWith(".json") && f !== "community_reports.json",
    );

    logger.info(`Found ${jsonFiles.length} legal data files in ${dataDir}`);

    const allArticles: RawArticleJson[] = [];
    for (const file of jsonFiles) {
      const filePath = join(dataDir, file);
      logger.info(`Loading legal data from ${filePath}`);
      const content = await readFile(filePath, "utf-8");
      const data = JSON.parse(content) as RawArticleJson[];

      if (Array.isArray(data)) {
        allArticles.push(...data);
      }
    }

    logger.info(
      `Total loaded ${allArticles.length} articles from ${jsonFiles.length} files`,
    );
    return allArticles;
  } catch (error) {
    logger.error("Failed to load legal data", error);
    throw error;
  }
}

/**
 * Load community reports from data directory
 */
export async function loadCommunityReports(): Promise<any[]> {
  try {
    const filePath = join(process.cwd(), "data", "community_reports.json");
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    logger.warn(
      `Failed to load community reports: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

/**
 * Extract unique hierarchy information from articles
 */
export function extractHierarchy(articles: RawArticleJson[]): HierarchyInfo {
  const hierarchy: HierarchyInfo = {
    parts: new Set(),
    chapters: new Set(),
    sections: new Set(),
    subsections: new Set(),
  };

  for (const article of articles) {
    if (article.metadata.part) {
      hierarchy.parts.add(article.metadata.part);
    }
    if (article.metadata.chapter) {
      hierarchy.chapters.add(article.metadata.chapter);
    }
    if (article.metadata.section) {
      hierarchy.sections.add(article.metadata.section);
    }
    if (article.metadata.subsection) {
      hierarchy.subsections.add(article.metadata.subsection);
    }
  }

  logger.info("Extracted hierarchy:", {
    parts: hierarchy.parts.size,
    chapters: hierarchy.chapters.size,
    sections: hierarchy.sections.size,
    subsections: hierarchy.subsections.size,
  });

  return hierarchy;
}

/**
 * Parse part names to extract part number
 */
export function parsePartNumber(partName: string): number {
  if (!partName) return 0;

  // Try digits first
  const match = partName.match(/phần thứ (\d+)|phần (\d+)/i);
  if (match) {
    return parseInt(match[1] || match[2], 10);
  }

  // Handle common Vietnamese ordinals
  const lower = partName.toLowerCase();
  if (lower.includes("thứ nhất")) return 1;
  if (lower.includes("thứ hai")) return 2;
  if (lower.includes("thứ ba")) return 3;
  if (lower.includes("thứ tư")) return 4;
  if (lower.includes("thứ năm")) return 5;
  if (lower.includes("thứ sáu")) return 6;
  if (lower.includes("thứ bảy")) return 7;

  return 0;
}

/**
 * Clean hierarchy name by removing junk and fixing encoding if possible
 */
export function cleanHierarchyName(
  name: string,
  type: "part" | "chapter" | "section" | "subsection",
): string {
  if (!name) return "";

  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();

  // Basic validation based on type
  if (type === "part" && !lower.startsWith("phần")) return "";
  if (type === "chapter" && !lower.startsWith("chương")) return "";
  if (type === "section" && !lower.startsWith("mục")) return "";
  if (type === "subsection" && !lower.startsWith("tiểu mục")) return "";

  // Length check to avoid full sentences
  if (trimmed.length > 150) return "";

  return trimmed;
}

/**
 * Parse chapter names to extract chapter number and roman numeral
 */
export function parseChapterInfo(chapterName: string): {
  chapterNumber: number;
  chapterRoman: string;
} | null {
  // Try roman numeral first
  const romanMatch = chapterName.match(/chương\s+([IVXLCM]+)/i);
  if (romanMatch) {
    const chapterRoman = romanMatch[1].toUpperCase();

    // Convert to number for ordering
    const romanValues: Record<string, number> = {
      I: 1,
      II: 2,
      III: 3,
      IV: 4,
      V: 5,
      VI: 6,
      VII: 7,
      VIII: 8,
      IX: 9,
      X: 10,
      XI: 11,
      XII: 12,
      XIII: 13,
      XIV: 14,
      XV: 15,
      XVI: 16,
      XVII: 17,
      XVIII: 18,
      XIX: 19,
      XX: 20,
      XXI: 21,
      XXII: 22,
      XXIII: 23,
      XXIV: 24,
      XXV: 25,
      XXVI: 26,
      XXVII: 27,
      XXVIII: 28,
      XXIX: 29,
      XXX: 30,
      XXXI: 31,
      XXXII: 32,
      XXXIII: 33,
      XXXIV: 34,
      XXXV: 35,
      XXXVI: 36,
      XXXVII: 37,
      XXXVIII: 38,
      XXXIX: 39,
      XL: 40,
    };

    const chapterNumber = romanValues[chapterRoman] || 0;
    return { chapterNumber, chapterRoman };
  }

  // Try numeric
  const numMatch = chapterName.match(/chương\s+(\d+)/i);
  if (numMatch) {
    const chapterNumber = parseInt(numMatch[1], 10);
    return { chapterNumber, chapterRoman: numMatch[1] };
  }

  return null;
}

/**
 * Parse section names to extract section number and short name
 */
export function parseSectionInfo(sectionName: string): {
  sectionNumber: number;
  nameShort: string;
} {
  const match = sectionName.match(/mục\s+(\d+):\s*(.+)/i);
  if (match) {
    return {
      sectionNumber: parseInt(match[1], 10),
      nameShort: match[2].trim().replace(/,+$/, ""),
    };
  }
  return { sectionNumber: 0, nameShort: sectionName };
}

/**
 * Parse subsection names to extract subsection number and short name
 */
export function parseSubsectionInfo(subsectionName: string): {
  subsectionNumber: number;
  nameShort: string;
} {
  const match = subsectionName.match(/tiểu mục\s+(\d+):\s*(.+)/i);
  if (match) {
    return {
      subsectionNumber: parseInt(match[1], 10),
      nameShort: match[2].trim(),
    };
  }
  return { subsectionNumber: 0, nameShort: subsectionName };
}

/**
 * Normalize article content to string
 */
function normalizeArticleContent(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.join("\n");
  if (content && typeof content === "object")
    return Object.values(content).join("\n");
  return String(content || "");
}

/**
 * Parse a specific legal data file
 */
export async function parseLegalFile(
  filePath: string,
): Promise<ParsedLegalData> {
  const content = await readFile(filePath, "utf-8");
  const data = JSON.parse(content) as RawArticleJson[];
  return processRawArticles(data);
}

/**
 * Build complete parsed data structure from raw articles
 */
export async function parseLegalData(
  rawArticles?: RawArticleJson[],
): Promise<ParsedLegalData> {
  const articles = rawArticles || (await loadLegalData());
  return processRawArticles(articles);
}

/**
 * Shared internal logic to process raw articles into ParsedLegalData
 */
function processRawArticles(rawArticles: RawArticleJson[]): ParsedLegalData {
  const parsed: ParsedLegalData = {
    parts: new Map(),
    chapters: new Map(),
    sections: new Map(),
    subsections: new Map(),
    articles: new Map(),
    partToChapters: new Map(),
    chapterToSections: new Map(),
    sectionToSubsections: new Map(),
    articleToParent: new Map(),
  };

  let currentPartName = "Phần chưa phân loại";
  let currentChapterName = "Chương chưa phân loại";
  let currentSectionName = "";
  let currentSubsectionName = "";

  for (const rawArticle of rawArticles) {
    // Update current hierarchy state from metadata if available
    if (rawArticle.metadata.part) {
      const cleanedPart = cleanHierarchyName(rawArticle.metadata.part, "part");
      if (cleanedPart && cleanedPart !== currentPartName) {
        currentPartName = cleanedPart;
        currentChapterName = "Chương chưa phân loại";
        currentSectionName = "";
        currentSubsectionName = "";
      }
    }

    if (rawArticle.metadata.chapter) {
      const cleanedChapter = cleanHierarchyName(
        rawArticle.metadata.chapter,
        "chapter",
      );
      if (cleanedChapter && cleanedChapter !== currentChapterName) {
        currentChapterName = cleanedChapter;
        currentSectionName = "";
        currentSubsectionName = "";
      }
    }

    if (rawArticle.metadata.section !== undefined) {
      currentSectionName = cleanHierarchyName(
        rawArticle.metadata.section,
        "section",
      );
    }

    if (rawArticle.metadata.subsection !== undefined) {
      currentSubsectionName = cleanHierarchyName(
        rawArticle.metadata.subsection,
        "subsection",
      );
    }

    // 1. Process Part
    const partName = currentPartName;
    const partNumber = parsePartNumber(partName);
    const partId = generatePartId(partNumber);

    if (!parsed.parts.has(partId)) {
      parsed.parts.set(partId, {
        id: partId,
        name: partName,
        name_short: partName.replace(/^Phần thứ \d+:\s*/i, "").trim(),
        part_number: partNumber,
        chapter_count: 0,
        article_count: 0,
      });
    }

    // 2. Process Chapter
    const chapterName = currentChapterName;
    const chapterInfo = parseChapterInfo(chapterName);
    const chapterNum = chapterInfo ? chapterInfo.chapterNumber : 0;
    const chapterRoman = chapterInfo ? chapterInfo.chapterRoman : "0";
    const chapterId = generateChapterId(partNumber, chapterNum);

    if (chapterNum > 0 && !parsed.chapters.has(chapterId)) {
      parsed.chapters.set(chapterId, {
        id: chapterId,
        name: chapterName,
        name_short: chapterName.replace(/^Chương\s+[IVXLCM]+:\s*/i, "").trim(),
        chapter_roman: chapterRoman,
        part_id: partId,
        article_count: 0,
        section_count: 0,
        summary: "",
      });

      // Link chapter to part
      if (!parsed.partToChapters.has(partId)) {
        parsed.partToChapters.set(partId, []);
      }
      parsed.partToChapters.get(partId)!.push(chapterId);
      parsed.parts.get(partId)!.chapter_count++;
    }

    // 3. Process Section
    let currentParentId = chapterNum > 0 ? chapterId : partId;
    let currentParentType = chapterNum > 0 ? "chapter" : "part";

    if (currentSectionName) {
      const sectionName = currentSectionName;
      const { sectionNumber, nameShort } = parseSectionInfo(sectionName);
      const sectionId = generateSectionId(chapterId, sectionNumber);

      if (!parsed.sections.has(sectionId)) {
        parsed.sections.set(sectionId, {
          id: sectionId,
          name: sectionName,
          name_short: nameShort,
          section_number: sectionNumber,
          chapter_id: chapterId,
          article_count: 0,
          subsection_count: 0,
        });

        // Link section to chapter
        if (!parsed.chapterToSections.has(chapterId)) {
          parsed.chapterToSections.set(chapterId, []);
        }
        parsed.chapterToSections.get(chapterId)!.push(sectionId);
        parsed.chapters.get(chapterId)!.section_count++;
      }

      currentParentId = sectionId;
      currentParentType = "section";

      // 4. Process Subsection
      if (currentSubsectionName) {
        const subsectionName = currentSubsectionName;
        const { subsectionNumber, nameShort: subNameShort } =
          parseSubsectionInfo(subsectionName);
        const subsectionId = generateSubsectionId(sectionId, subsectionNumber);

        if (!parsed.subsections.has(subsectionId)) {
          parsed.subsections.set(subsectionId, {
            id: subsectionId,
            name: subsectionName,
            name_short: subNameShort,
            subsection_number: subsectionNumber,
            section_id: sectionId,
            article_count: 0,
          });

          // Link subsection to section
          if (!parsed.sectionToSubsections.has(sectionId)) {
            parsed.sectionToSubsections.set(sectionId, []);
          }
          parsed.sectionToSubsections.get(sectionId)!.push(subsectionId);
          parsed.sections.get(sectionId)!.subsection_count++;
        }

        currentParentId = subsectionId;
        currentParentType = "subsection";
      }
    }

    // 5. Process Article
    const articleId = generateArticleId(rawArticle.article_number);
    const content = normalizeArticleContent(rawArticle.content);
    const clauses = parseArticleClauses(articleId, content);
    const keywords = extractKeywords(rawArticle.title, content);

    // Clean up content (remove trailing headers if any)
    // Article 15 has headers like "CÁ NHÂN" at the end.
    // We keep them for now as they are part of the raw content,
    // but we could trim them if they match known hierarchy names.

    const articleNode: ArticleNode = {
      id: articleId,
      article_number: rawArticle.article_number,
      title: rawArticle.title,
      content: content,
      clauses,
      metadata: rawArticle.metadata,
      keywords,
      hierarchical_path: buildHierarchicalPath(rawArticle),
      clause_count: clauses.length,
    };

    parsed.articles.set(articleId, articleNode);
    parsed.articleToParent.set(articleId, {
      type: currentParentType,
      id: currentParentId,
    });

    // Update article counts
    parsed.parts.get(partId)!.article_count++;
    if (chapterNum > 0) {
      parsed.chapters.get(chapterId)!.article_count++;
    }

    if (currentParentType === "section") {
      parsed.sections.get(currentParentId)!.article_count++;
    } else if (currentParentType === "subsection") {
      parsed.subsections.get(currentParentId)!.article_count++;
      // Also update section count
      const sub = parsed.subsections.get(currentParentId)!;
      parsed.sections.get(sub.section_id)!.article_count++;
    }
  }

  // Calculate total clauses and points for logging
  let totalClauses = 0;
  let totalPoints = 0;
  for (const article of parsed.articles.values()) {
    totalClauses += article.clauses.length;
    for (const clause of article.clauses) {
      totalPoints += clause.points.length;
    }
  }

  logger.info("Parsed legal data (Robust Path):", {
    parts: parsed.parts.size,
    chapters: parsed.chapters.size,
    sections: parsed.sections.size,
    subsections: parsed.subsections.size,
    articles: parsed.articles.size,
    clauses: totalClauses,
    points: totalPoints,
  });

  return parsed;
}

// ----------------------------------------------------------------------------
// Helper Functions
// ----------------------------------------------------------------------------

function buildHierarchicalPath(article: RawArticleJson): string {
  const parts: string[] = [];

  if (article.metadata.part) {
    const partNumber = parsePartNumber(article.metadata.part);
    parts.push(generatePartId(partNumber));
  }

  if (article.metadata.chapter) {
    const chapterInfo = parseChapterInfo(article.metadata.chapter);
    const chapterNumber = chapterInfo ? chapterInfo.chapterNumber : 0;
    const partNumber = parsePartNumber(article.metadata.part);
    parts.push(generateChapterId(partNumber, chapterNumber));
  }

  if (article.metadata.section) {
    const { sectionNumber } = parseSectionInfo(article.metadata.section);
    const chapterInfo = parseChapterInfo(article.metadata.chapter);
    const chapterNumber = chapterInfo ? chapterInfo.chapterNumber : 0;
    const partNumber = parsePartNumber(article.metadata.part);
    const chapterId = generateChapterId(partNumber, chapterNumber);
    parts.push(generateSectionId(chapterId, sectionNumber));
  }

  if (article.metadata.subsection) {
    const { subsectionNumber } = parseSubsectionInfo(
      article.metadata.subsection,
    );
    const { sectionNumber } = parseSectionInfo(article.metadata.section);
    const chapterInfo = parseChapterInfo(article.metadata.chapter);
    const chapterNumber = chapterInfo ? chapterInfo.chapterNumber : 0;
    const partNumber = parsePartNumber(article.metadata.part);
    const chapterId = generateChapterId(partNumber, chapterNumber);
    const sectionId = generateSectionId(chapterId, sectionNumber);
    parts.push(generateSubsectionId(sectionId, subsectionNumber));
  }

  return parts.join("/");
}
