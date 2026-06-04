// ============================================================================
// Agent Tools for Legal Consultation
// ============================================================================

import type { HybridRetrieval } from "../retrieval/hybrid-congraph";
import type { LegalContextBundle } from "../shared/types";
import logger from "../shared/logger";

// ----------------------------------------------------------------------------
// Tool: Retrieve Legal Context
// ----------------------------------------------------------------------------

export async function retrieveLegalContext(
  retrieval: HybridRetrieval,
  query: string,
  mode: "local" | "global" = "local",
): Promise<LegalContextBundle> {
  logger.info(`Tool: retrieveLegalContext called with query: "${query}"`);
  return await retrieval.retrieve(query, mode);
}

// ----------------------------------------------------------------------------
// Tool: Analyze Legal Entities
// ----------------------------------------------------------------------------

export interface LegalEntity {
  type: "person" | "organization" | "property" | "contract" | "other";
  name: string;
  attributes: Record<string, any>;
}

export async function analyzeLegalEntities(text: string): Promise<{
  entities: LegalEntity[];
  summary: string;
}> {
  logger.info(
    `Tool: analyzeLegalEntities called with text length: ${text.length}`,
  );

  const entities: LegalEntity[] = [];

  // Simple entity extraction based on keywords
  const lowerText = text.toLowerCase();

  // Person entities
  const personKeywords = [
    "người",
    "cá nhân",
    "chồng",
    "vợ",
    "con",
    "cha",
    "mẹ",
  ];
  for (const keyword of personKeywords) {
    if (lowerText.includes(keyword)) {
      entities.push({
        type: "person",
        name: keyword,
        attributes: { confidence: 0.8 },
      });
    }
  }

  // Organization entities
  const orgKeywords = ["công ty", "doanh nghiệp", "tổ chức", "cơ quan"];
  for (const keyword of orgKeywords) {
    if (lowerText.includes(keyword)) {
      entities.push({
        type: "organization",
        name: keyword,
        attributes: { confidence: 0.7 },
      });
    }
  }

  // Property entities
  const propertyKeywords = ["nhà", "đất", "xe", "tài sản"];
  for (const keyword of propertyKeywords) {
    if (lowerText.includes(keyword)) {
      entities.push({
        type: "property",
        name: keyword,
        attributes: { confidence: 0.6 },
      });
    }
  }

  // Contract entities
  const contractKeywords = ["hợp đồng", "thỏa thuận", "cam kết"];
  for (const keyword of contractKeywords) {
    if (lowerText.includes(keyword)) {
      entities.push({
        type: "contract",
        name: keyword,
        attributes: { confidence: 0.9 },
      });
    }
  }

  const summary =
    entities.length > 0
      ? `Phát hiện ${entities.length} loại thực thể pháp lý trong câu hỏi`
      : "Không phát hiện thực thể pháp lý cụ thể";

  return { entities, summary };
}

// ----------------------------------------------------------------------------
// Tool: Extract Legal Concepts
// ----------------------------------------------------------------------------

export async function extractLegalConcepts(
  context: LegalContextBundle,
): Promise<{
  concepts: Array<{
    name: string;
    category: string;
    relevance: number;
  }>;
  summary: string;
}> {
  logger.info("Tool: extractLegalConcepts called");

  const concepts = context.relevant_concepts.map((c, index) => ({
    name: c.name,
    category: c.category,
    relevance: 1 - index * 0.1, // Decreasing relevance
  }));

  const summary =
    concepts.length > 0
      ? `Phát hiện ${concepts.length} khái niệm pháp lý liên quan`
      : "Không phát hiện khái niệm pháp lý cụ thể";

  return { concepts, summary };
}

// ----------------------------------------------------------------------------
// Tool: Format Article Reference
// ----------------------------------------------------------------------------

export async function formatArticleReference(
  articleNumber: number,
  title: string,
  snippet?: string,
): Promise<string> {
  logger.info(
    `Tool: formatArticleReference called for article ${articleNumber}`,
  );

  let reference = `**Điều ${articleNumber}**: ${title}`;

  if (snippet) {
    const maxLength = 200;
    const truncatedSnippet =
      snippet.length > maxLength
        ? snippet.substring(0, maxLength) + "..."
        : snippet;
    reference += `\n\n${truncatedSnippet}`;
  }

  return reference;
}

// ----------------------------------------------------------------------------
// Tool: Get Hierarchical Context
// ----------------------------------------------------------------------------

export async function getHierarchicalContext(
  context: LegalContextBundle,
): Promise<{
  path: string;
  part: string;
  chapter: string;
  section?: string;
  subsection?: string;
}> {
  logger.info("Tool: getHierarchicalContext called");

  const { community_context } = context;

  return {
    path: community_context.hierarchical_context,
    part: community_context.part?.name || "",
    chapter: community_context.chapter?.name || "",
    section: community_context.section?.name || "",
    subsection: community_context.subsection?.name || "",
  };
}

// ----------------------------------------------------------------------------
// Tool Registry
// ----------------------------------------------------------------------------

export const agentTools = {
  retrieveLegalContext,
  analyzeLegalEntities,
  extractLegalConcepts,
  formatArticleReference,
  getHierarchicalContext,
};

export type AgentToolName = keyof typeof agentTools;
