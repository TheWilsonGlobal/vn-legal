// ============================================================================
// Graph Schema Definitions for Vietnam Legal Data
// ============================================================================

import type { ArticleClause, ClausePoint } from "../shared/types";

// ----------------------------------------------------------------------------
// Node Type Constants
// ----------------------------------------------------------------------------

export const NodeType = {
  ARTICLE: "Article",
  CLAUSE: "Clause",
  POINT: "ClausePoint",
  PART: "Part",
  CHAPTER: "Chapter",
  SECTION: "Section",
  SUBSECTION: "Subsection",
  CONCEPT: "LegalConcept",
} as const;

export type NodeTypeConstant = (typeof NodeType)[keyof typeof NodeType];

// ----------------------------------------------------------------------------
// Edge Type Constants
// ----------------------------------------------------------------------------

export const EdgeType = {
  // Hierarchy edges
  HAS_CHAPTER: "HAS_CHAPTER",
  HAS_SECTION: "HAS_SECTION",
  HAS_SUBSECTION: "HAS_SUBSECTION",
  BELONGS_TO: "BELONGS_TO",
  HAS_CLAUSE: "HAS_CLAUSE",
  HAS_POINT: "HAS_POINT",

  // Reference edges
  REFERENCES: "REFERENCES",
  REFERENCED_BY: "REFERENCED_BY",

  // Sequence edges
  NEXT_ARTICLE: "NEXT_ARTICLE",

  // Definition edges
  DEFINES: "DEFINES",

  // Concept edges
  RELATED_TO: "RELATED_TO",

  // Logic edges
  REQUIRES: "REQUIRES",
  CONTRADICTS: "CONTRADICTS",
  SUPERSEDES: "SUPERSEDES",
} as const;

export type EdgeTypeConstant = (typeof EdgeType)[keyof typeof EdgeType];

// ----------------------------------------------------------------------------
// Schema Helper Functions
// ----------------------------------------------------------------------------

/**
 * Generate a unique ID for a Part node
 */
export function generatePartId(partNumber: number): string {
  return `part_${partNumber}`;
}

/**
 * Generate a unique ID for a Chapter node
 */
export function generateChapterId(
  partNumber: number | string,
  chapterNumber: number | string,
): string {
  return `chapter_p${partNumber}_c${chapterNumber}`;
}

/**
 * Generate a unique ID for a Section node
 */
export function generateSectionId(
  chapterId: string,
  sectionNumber: number,
): string {
  return `section_${chapterId}_s${sectionNumber}`;
}

/**
 * Generate a unique ID for a Subsection node
 */
export function generateSubsectionId(
  sectionId: string,
  subsectionNumber: number,
): string {
  return `subsection_${sectionId}_ss${subsectionNumber}`;
}

/**
 * Generate a unique ID for an Article node
 */
export function generateArticleId(articleNumber: number): string {
  return `article_${articleNumber}`;
}

/**
 * Generate a unique ID for a Clause node
 */
export function generateClauseId(
  articleId: string,
  clauseNumber: number,
): string {
  return `${articleId}_clause_${clauseNumber}`;
}

/**
 * Generate a unique ID for a Point node
 */
export function generatePointId(clauseId: string, pointLetter: string): string {
  return `${clauseId}_point_${pointLetter}`;
}

/**
 * Generate a unique ID for a Legal Concept node
 */
export function generateConceptId(conceptName: string): string {
  return `concept_${conceptName.toLowerCase().replace(/\s+/g, "_")}`;
}

// ----------------------------------------------------------------------------
// Content Parsing Helpers
// ----------------------------------------------------------------------------

/**
 * Parse article content into clauses (khoản)
 * Clauses are numbered as "1. ", "2. ", "3. ", etc.
 */
export function parseArticleClauses(
  articleId: string,
  content: any,
): ArticleClause[] {
  const contentStr =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.join("\n")
        : content && typeof content === "object"
          ? Object.values(content).join("\n")
          : String(content || "");

  // Find all clause markers: line starts with "Number. "
  const clauseMarkerRegex = /^\d+\.\s+/gm;
  const matches = [...contentStr.matchAll(clauseMarkerRegex)];

  if (matches.length === 0) {
    // No numbered clauses found, treat entire content as single clause
    const clauseId = generateClauseId(articleId, 1);
    const points = parseClausePoints(clauseId, contentStr);
    return [
      {
        id: clauseId,
        clause_number: 1,
        text: contentStr.trim(),
        article_id: articleId,
        points,
        point_count: points.length,
      },
    ];
  }

  const clauses: ArticleClause[] = [];

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index!;
    const end =
      i < matches.length - 1 ? matches[i + 1].index : contentStr.length;

    let text = contentStr.substring(start, end).trim();

    // If it's the first clause and there's text before it, prepend it to include the context
    if (i === 0 && start > 0) {
      const preamble = contentStr.substring(0, start).trim();
      if (preamble) {
        text = preamble + "\n" + text;
      }
    }

    // Extract the clause number from the marker (e.g., "1. " -> 1)
    const clauseNumberStr = matches[i][0].match(/\d+/)?.[0];
    const clauseNumber = clauseNumberStr
      ? parseInt(clauseNumberStr, 10)
      : i + 1;
    const clauseId = generateClauseId(articleId, clauseNumber);

    // Parse points within the full text of the clause
    const points = parseClausePoints(clauseId, text);

    clauses.push({
      id: clauseId,
      clause_number: clauseNumber,
      text,
      article_id: articleId,
      points,
      point_count: points.length,
    });
  }

  return clauses;
}

/**
 * Parse clause text into points (điểm)
 * Points are lettered as "a) ", "b) ", "c) ", etc.
 */
export function parseClausePoints(clauseId: string, text: any): ClausePoint[] {
  const textStr = typeof text === "string" ? text : String(text || "");
  const pointRegex =
    /^[a-záàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]\)\s+(.+)$/gim;
  const matches = [...textStr.matchAll(pointRegex)];

  if (matches.length === 0) {
    return [];
  }

  const points: ClausePoint[] = [];

  for (const match of matches) {
    const pointLetter = match[0].trim()[0].toLowerCase();
    const pointText = match[1].trim();
    const pointId = generatePointId(clauseId, pointLetter);

    points.push({
      id: pointId,
      point_letter: pointLetter,
      text: pointText,
      clause_id: clauseId,
    });
  }

  return points;
}

/**
 * Extract keywords from article content
 * This is a simple implementation that can be enhanced with NLP
 */
export function extractKeywords(title: string, content: any): string[] {
  const contentStr =
    typeof content === "string" ? content : String(content || "");
  const combined = `${title} ${contentStr}`.toLowerCase();

  // Common legal terms in Vietnamese civil law
  const legalTerms = [
    "quyền dân sự",
    "cá nhân",
    "pháp nhân",
    "hợp đồng",
    "tài sản",
    "sở hữu",
    "thừa kế",
    "người chưa thành niên",
    "người có khó khăn trong nhận thức",
    "giám hộ",
    "bồi thường",
    "thiệt hại",
    "nghĩa vụ",
    "giao dịch",
    "đại diện",
    "chứng cứ",
    "hết thời hiệu",
    "khoản",
    "điểm",
    "điều",
  ];

  const found = legalTerms.filter((term) => combined.includes(term));

  // Also extract capitalized terms that might be legal concepts
  const capitalizedRegex =
    /\b[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ][a-zàáảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]+(?:\s+[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ][a-zàáảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]+)*\b/g;
  const capitalized = [...combined.matchAll(capitalizedRegex)].map((m) => m[0]);

  return [...new Set([...found, ...capitalized])];
}

/**
 * Detect article references in text
 * Returns array of referenced article numbers
 */
export function detectArticleReferences(text: any): number[] {
  const textStr = typeof text === "string" ? text : String(text || "");
  const references: number[] = [];

  // Match "Điều X" or "điều X" patterns
  const articleRegex = /điều\s+(\d+)/gi;
  const matches = [...textStr.matchAll(articleRegex)];

  for (const match of matches) {
    const articleNumber = parseInt(match[1], 10);
    if (!references.includes(articleNumber)) {
      references.push(articleNumber);
    }
  }

  return references;
}

/**
 * Detect clause references in text
 * Returns array of referenced clause patterns like "khoản 2"
 */
export function detectClauseReferences(text: any): string[] {
  const textStr = typeof text === "string" ? text : String(text || "");
  const references: string[] = [];

  // Match "khoản X" patterns
  const clauseRegex = /khoản\s+(\d+)/gi;
  const matches = [...textStr.matchAll(clauseRegex)];

  for (const match of matches) {
    references.push(match[0].toLowerCase());
  }

  return [...new Set(references)];
}

/**
 * Detect point references in text
 * Returns array of referenced point patterns like "điểm a" or "điểm a)"
 */
export function detectPointReferences(text: any): string[] {
  const textStr = typeof text === "string" ? text : String(text || "");
  const references: string[] = [];

  // Match "điểm X" patterns
  const pointRegex =
    /điểm\s+([a-záàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ])\)?/gi;
  const matches = [...textStr.matchAll(pointRegex)];

  for (const match of matches) {
    references.push(match[0].toLowerCase());
  }

  return [...new Set(references)];
}
