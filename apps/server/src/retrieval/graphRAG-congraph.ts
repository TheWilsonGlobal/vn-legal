// ============================================================================
// GraphRAG Implementation using ConGraphRAG MSGraphRAG Engine
// ============================================================================

import { MSGraphRAG as ConGraphMSGraphRAG } from "congraph-rag/engines";
import { IStorage, BaseLLM } from "congraph-rag/core";
import type { ArticleNode, CommunityContext } from "../shared/types";
import { getCacheManager } from "../shared/cache";
import {
  validateArticleId,
  validateLevel,
  logPerformance,
  recordMetric,
} from "../shared/error-handling";
import logger from "../shared/logger";

// ----------------------------------------------------------------------------
// GraphRAG (MSGraphRAG) Wrapper
// ----------------------------------------------------------------------------

export class GraphRAG {
  private engine: any; // Use any to avoid value vs type conflict if necessary, or typeof if class is exported as value

  constructor(storage: IStorage, llm?: BaseLLM) {
    if (!ConGraphMSGraphRAG) {
      logger.error("ConGraphMSGraphRAG is not defined in congraph-rag/engines");
    }
    this.engine = new ConGraphMSGraphRAG(storage, llm);
    if (this.engine && typeof this.engine.query !== "function") {
      logger.error("MSGraphRAG engine instance missing query method", {
        keys: Object.keys(this.engine),
        protoKeys: Object.keys(Object.getPrototypeOf(this.engine)),
      });
    }
  }

  /**
   * Get community context for an article using MSGraphRAG
   *
   * This method uses ConGraphRAG's MSGraphRAG engine which:
   * 1. Uses vector search for initial seed retrieval
   * 2. Accesses hierarchical community layers
   * 3. Summarizes across layers for local context
   * 4. Supports hierarchical level-based queries
   *
   * Perfect for legal documents with hierarchical structure:
   * Level 0: Part (Phần)
   * Level 1: Chapter (Chương)
   * Level 2: Section (Mục)
   * Level 3: Subsection (Tiểu mục)
   *
   * @param articleId - The article ID to get context for
   * @param level - Community level (0=part, 1=chapter, 2=section, 3=subsection)
   * @returns Community context with hierarchy and principles
   */
  async getCommunityContext(
    articleId: string,
    level: number = 1,
  ): Promise<CommunityContext> {
    // Validate inputs
    if (!validateArticleId(articleId)) {
      logger.warn(`Invalid article ID: ${articleId}`);
      return this.emptyCommunityContext();
    }

    if (!validateLevel(level)) {
      logger.warn(`Invalid level: ${level}, defaulting to 1`);
      level = 1;
    }

    const cache = getCacheManager();
    if (!cache || !cache.communityContext) {
      logger.error("Cache manager or communityContext cache not available");
      return this.emptyCommunityContext();
    }

    // Use cache for community context with error handling
    return cache.communityContext.getOrCompute(articleId, level, async () => {
      const startTime = Date.now();

      logger.debug(
        `Computing community context for ${articleId} at level ${level}`,
      );

      try {
        // Check if engine exists and has query method
        if (!this.engine || typeof this.engine.query !== "function") {
          logger.error(
            "MSGraphRAG engine not properly initialized or missing query method",
          );
          return this.emptyCommunityContext();
        }
        // First, get the article to use as query
        const article = await this.getArticle(articleId);
        if (!article) {
          throw new Error(`Article ${articleId} not found`);
        }

        // Use the article title and content as query for MSGraphRAG
        const query = `${article.title}. ${article.content.substring(0, 200)}...`;

        // Use ConGraphRAG's MSGraphRAG engine with local mode and specified level
        const result = await this.engine.query(query, { mode: "local", level });

        logPerformance("getCommunityContext", Date.now() - startTime);
        recordMetric({
          operation: "getCommunityContext",
          duration: Date.now() - startTime,
          success: true,
          metadata: { articleId, level },
        });

        // Parse the response to extract community context
        // Use structured communities from metadata if available
        if (
          result.metadata?.communities &&
          result.metadata.communities.length > 0
        ) {
          return this.mapCommunitiesToContext(
            result.metadata.communities,
            article,
            level,
          );
        }

        return this.extractCommunityContext(result.content, article, level);
      } catch (error) {
        recordMetric({
          operation: "getCommunityContext",
          duration: Date.now() - startTime,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          metadata: { articleId, level },
        });

        logger.error("Error in GraphRAG community context", error);
        return this.emptyCommunityContext();
      }
    });
  }

  /**
   * Get articles in the same community context
   */
  async getCommunityArticles(
    articleId: string,
    limit: number = 10,
    level: number = 1,
  ): Promise<ArticleNode[]> {
    logger.debug(
      `Getting community articles for ${articleId} at level ${level}`,
    );

    try {
      const article = await this.getArticle(articleId);
      if (!article) return [];

      const query = `Các điều khoản liên quan đến ${article.title}`;
      const result = await this.engine.query(query, { mode: "local", level });

      // Extract articles from metadata if available, otherwise fallback to parsing
      if (result.metadata?.seeds) {
        const seedEntities = result.metadata.seeds;
        return seedEntities
          .map((e: any) => ({
            id: e.id,
            article_number: parseInt(e.id.replace("article_", ""), 10) || 0,
            title: e.name || `Điều ${e.id.replace("article_", "")}`,
            content: e.description || "",
            clauses: [],
            metadata: e.metadata || {},
            keywords: [],
            hierarchical_path: "",
            clause_count: 0,
          }))
          .slice(0, limit);
      }

      // Fallback to text parsing
      return this.extractArticlesFromResponse(result.content).slice(0, limit);
    } catch (error) {
      logger.error("Error getting community articles", error);
      return [];
    }
  }

  /**
   * Generate chapter/section summary using MSGraphRAG
   */
  async generateChapterSummary(
    chapterId: string,
    level: number = 1,
  ): Promise<string> {
    logger.debug(
      `Generating summary for chapter ${chapterId} at level ${level}`,
    );

    try {
      const result = await this.engine.query(
        `Tóm tắt các nguyên tắc chính của chương ${chapterId}`,
        { mode: "local", level },
      );
      return result.content || "";
    } catch (error) {
      logger.error("Error generating chapter summary", error);
      return "";
    }
  }

  /**
   * Query using MSGraphRAG
   *
   * @param query - The query string
   * @param options - Query options (mode: 'local' | 'global', level: number)
   * @returns Query result with content and metadata
   */
  async query(
    query: string,
    options: { mode?: "local" | "global"; level?: number } = {},
  ): Promise<{ content: string; metadata?: any }> {
    const { mode = "local", level = 1 } = options;
    logger.debug(
      `Querying MSGraphRAG: "${query}" (mode: ${mode}, level: ${level})`,
    );

    try {
      const result = await this.engine.query(query, { mode, level });
      return result;
    } catch (error) {
      logger.error("Error in MSGraphRAG query", error);
      return { content: "" };
    }
  }

  /**
   * Query using MSGraphRAG global search mode
   *
   * Global mode searches across all community layers
   * and provides high-level summaries
   */
  async globalQuery(query: string, level: number = 0): Promise<string> {
    logger.debug(
      `Performing global query: "${query}" at community level ${level}`,
    );

    try {
      if (!this.engine || typeof this.engine.query !== "function") {
        logger.error(
          "MSGraphRAG engine not properly initialized or missing query method for global query",
        );
        return "";
      }
      const result = await this.engine.query(query, { mode: "global", level });
      return result.content;
    } catch (error) {
      logger.error("Error in global query", error);
      return "";
    }
  }

  /**
   * Stream MSGraphRAG results
   */
  async *queryStream(
    query: string,
    options: { mode?: "local" | "global"; level?: number } = {},
  ): AsyncIterable<string> {
    const { mode = "local", level = 0 } = options;
    logger.debug(`Streaming MSGraphRAG results for query: "${query}"`);

    try {
      const stream = this.engine.queryStream(query, { mode, level });
      yield* stream;
    } catch (error) {
      logger.error("Error in MSGraphRAG streaming", error);
      yield "Lỗi khi truy xuất thông tin.";
    }
  }

  /**
   * Map structured communities from congraph-rag to vina-legal CommunityContext
   */
  private mapCommunitiesToContext(
    communities: any[],
    article: ArticleNode,
    level: number,
  ): CommunityContext {
    // Find the most relevant community (usually the first one at the requested level)
    const targetComm = communities[0];

    // Attempt to extract hierarchy from titles/summaries
    const context = this.emptyCommunityContext();
    context.principles = targetComm.summary || "";
    context.article_count = targetComm.entityIds?.length || 0;

    // Map based on level
    if (level === 0) {
      // Part
      context.part = {
        id: targetComm.id,
        name: targetComm.title,
        name_short: targetComm.title,
        part_number: 1,
        chapter_count: 0,
        article_count: context.article_count,
      };
    } else if (level === 1) {
      // Chapter
      context.chapter = {
        id: targetComm.id,
        name: targetComm.title,
        name_short: targetComm.title,
        chapter_roman: "",
        part_id: "",
        article_count: context.article_count,
        section_count: 0,
        summary: targetComm.summary,
      };
    }

    context.hierarchical_context = communities.map((c) => c.title).join(" > ");

    return context;
  }

  // ----------------------------------------------------------------------------
  // Private Helper Methods
  // ----------------------------------------------------------------------------

  /**
   * Get article from storage
   */
  private async getArticle(articleId: string): Promise<ArticleNode | null> {
    try {
      // Use the engine's storage adapter to get real data
      const storage = (this.engine as any).storage;
      if (!storage) return null;

      const entity = await storage.getEntity(articleId);
      if (!entity) return null;

      return {
        id: entity.id,
        article_number:
          entity.metadata?.article_number ||
          parseInt(entity.id.replace("article_", ""), 10),
        title: entity.name || `Điều ${entity.id.replace("article_", "")}`,
        content: entity.description || "",
        clauses: [],
        metadata: entity.metadata?.metadata || {},
        keywords: entity.metadata?.keywords || [],
        hierarchical_path: "",
        clause_count: 0,
      };
    } catch (error) {
      logger.error(`Error fetching article ${articleId}`, error);
      return null;
    }
  }

  /**
   * Extract community context from MSGraphRAG response
   *
   * Maps community levels to legal hierarchy:
   * - Level 0: Part (Phần)
   * - Level 1: Chapter (Chương)
   * - Level 2: Section (Mục)
   * - Level 3: Subsection (Tiểu mục)
   */
  private extractCommunityContext(
    response: string,
    _article: ArticleNode,
    _level: number,
  ): CommunityContext {
    // Try to extract hierarchical information from response
    // Use more restrictive regex to avoid capturing placeholder text or arrows
    const partMatch = response.match(/Phần\s+([^>\n\r]+)/i);
    const chapterMatch = response.match(/Chương\s+([^>\n\r]+)/i);
    const sectionMatch = response.match(/Mục\s+([^>\n\r]+)/i);
    const subsectionMatch = response.match(/Tiểu mục\s+([^>\n\r]+)/i);

    return {
      part: {
        id: "part_1",
        name: partMatch?.[1] || "QUY ĐỊNH CHUNG",
        name_short: partMatch?.[1] || "QUY ĐỊNH CHUNG",
        part_number: 1,
        chapter_count: 1,
        article_count: 1,
      },
      chapter: {
        id: "chapter_1",
        name: chapterMatch?.[1] || "NHỮNG QUY ĐỊNH CHUNG",
        name_short: chapterMatch?.[1] || "NHỮNG QUY ĐỊNH CHUNG",
        chapter_roman: "I",
        part_id: "part_1",
        article_count: 1,
        section_count: 0,
        summary: response.substring(0, 500),
      },
      section: sectionMatch
        ? {
            id: "section_1",
            name: sectionMatch[1],
            name_short: sectionMatch[1],
            section_number: 1,
            chapter_id: "chapter_1",
            article_count: 1,
            subsection_count: 0,
          }
        : null,
      subsection: subsectionMatch
        ? {
            id: "subsection_1",
            name: subsectionMatch[1],
            name_short: subsectionMatch[1],
            subsection_number: 1,
            section_id: "section_1",
            article_count: 1,
          }
        : null,
      article_count: 1,
      principles: response.substring(0, 1000),
      hierarchical_context: [
        partMatch?.[1] || "",
        chapterMatch?.[1] || "",
        sectionMatch?.[1] || "",
        subsectionMatch?.[1] || "",
      ]
        .filter(Boolean)
        .join(" > "),
    };
  }

  /**
   * Extract article references from MSGraphRAG response
   */
  private extractArticlesFromResponse(response: string): ArticleNode[] {
    const articles: ArticleNode[] = [];
    const articleRegex = /Điều\s+(\d+)/g;
    const matches = [...response.matchAll(articleRegex)];

    for (const match of matches) {
      const articleNumber = parseInt(match[1], 10);
      articles.push({
        id: `article_${articleNumber}`,
        article_number: articleNumber,
        title: `Điều ${articleNumber}`,
        content: "",
        clauses: [],
        metadata: {
          part: "",
          chapter: "",
          section: "",
          subsection: "",
          source: "",
        },
        keywords: [],
        hierarchical_path: "",
        clause_count: 0,
      });
    }

    return articles;
  }

  /**
   * Create empty community context
   */
  private emptyCommunityContext(): CommunityContext {
    return {
      part: {
        id: "",
        name: "",
        name_short: "",
        part_number: 0,
        chapter_count: 0,
        article_count: 0,
      },
      chapter: {
        id: "",
        name: "",
        name_short: "",
        chapter_roman: "",
        part_id: "",
        article_count: 0,
        section_count: 0,
        summary: "",
      },
      section: null,
      subsection: null,
      article_count: 0,
      principles: "",
      hierarchical_context: "",
    };
  }
}

// ----------------------------------------------------------------------------
// Factory Function
// ----------------------------------------------------------------------------

export function createGraphRAG(storage: IStorage, llm?: BaseLLM): GraphRAG {
  return new GraphRAG(storage, llm);
}
