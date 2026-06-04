// ============================================================================
// Hybrid Retrieval using ConGraphRAG Engines
// ============================================================================
// Combines PathRAG and MSGraphRAG engines for comprehensive legal retrieval

import { IStorage, BaseLLM } from "congraph-rag/core";
import type { IEmbedder } from "../embeddings/embedder-factory";
import type {
  LegalContextBundle,
  SeedArticle,
  ArticleNode,
  LegalConceptNode,
} from "../shared/types";
import { createPathRAG } from "./pathRAG-congraph";
import { createGraphRAG } from "./graphRAG-congraph";
import { config } from "../shared/config";
import logger from "../shared/logger";
import {
  validateQuery,
  logPerformance,
  recordMetric,
  safeGraphOperation,
} from "../shared/error-handling";

// ----------------------------------------------------------------------------
// Hybrid Retrieval Engine with ConGraphRAG
// ----------------------------------------------------------------------------

export class HybridRetrieval {
  private pathRAG: ReturnType<typeof createPathRAG>;
  private graphRAG: ReturnType<typeof createGraphRAG>;

  constructor(
    private storage: IStorage,
    public llm?: BaseLLM,
    private embedder?: IEmbedder,
  ) {
    // Initialize ConGraphRAG engines
    this.pathRAG = createPathRAG(storage, llm);
    this.graphRAG = createGraphRAG(storage, llm);
  }

  /**
   * Perform hybrid retrieval combining PathRAG and LightRAG
   *
   * This method:
   * 1. Uses LightRAG for seed article discovery and community context
   * 2. Uses PathRAG for reference chain traversal
   * 3. Combines results for comprehensive legal context
   *
   * @param query - The legal query
   * @param mode - Retrieval mode: "local", "global", or "hybrid"
   * @param filters - Optional hierarchical filters
   * @returns Legal context bundle with all retrieved information
   */
  async retrieve(
    query: string,
    mode: "local" | "global" = "local",
    filters?: {
      part_id?: string;
      chapter_id?: string;
      section_id?: string;
      subsection_id?: string;
    },
  ): Promise<LegalContextBundle> {
    const startTime = Date.now();

    // Validate query
    if (!validateQuery(query)) {
      logger.warn(`Invalid query provided: "${query}"`);
      recordMetric({
        operation: "HybridRetrieval.retrieve",
        duration: 0,
        success: false,
        error: "Invalid query",
        metadata: { queryLength: query.length },
      });
      return this.emptyContextBundle(query);
    }

    logger.info(
      `Performing hybrid retrieval for query: "${query}" (mode: ${mode})`,
    );

    return safeGraphOperation(
      "HybridRetrieval.retrieve",
      async () => {
        // Step 1: Discover seed articles
        if (mode === "global") {
          // Phase 2.2: Global Retrieval Logic
          logger.info("Executing Global Retrieval (Community-level)");
          const queryVector = await this.embedder!.embed(query);
          const communityEmbeddings = await (
            this.storage as any
          ).searchCommunityReports(queryVector, 3);

          // Convert embeddings to CommunityReport format
          const communityReports = communityEmbeddings.map((ce: any) => ({
            id: ce.id,
            level: ce.level,
            title: ce.title,
            summary: ce.summary,
            findings: ce.findings?.split("\n") || [],
            rating: ce.rating,
            parent_id: ce.parent_id,
          }));

          return {
            query,
            seed_articles: [],
            path_context: [],
            community_context: this.emptyContextBundle(query).community_context,
            community_reports: communityReports,
            relevant_concepts: [],
            hierarchical_filter: filters || {},
            timestamp: new Date(),
          };
        }

        // Step 1: Discover seed articles
        let seedArticles: SeedArticle[] = [];

        if (mode === "local") {
          // In local mode, continue with standard pipeline
          seedArticles = await this.findSeedArticles(query);
          logger.info(
            `Found ${seedArticles.length} seed articles via vector search`,
          );
        }

        // Step 2: Use MSGraphRAG for community context and potentially more seeds (Disabled to optimize performance)
        // This query's output is unused and causes large latency overhead with local LLMs.
        // if seedArticles.length === 0, extractSeedArticles will fetch this.
        // await this.graphRAG.query(query, { mode, level: 1 });

        // If we still need seeds
        if (seedArticles.length === 0) {
          seedArticles = await this.extractSeedArticles(query, mode);
          logger.info(
            `Found ${seedArticles.length} seed articles via GraphRAG extraction`,
          );
        }

        if (seedArticles.length === 0) {
          logger.warn("No seed articles found, returning empty context");
          return this.emptyContextBundle(query);
        }

        // Step 3: Use PathRAG for reference chain traversal
        const pathContext = await this.pathRAG.traverseReferences(query);
        logger.info(`Found ${pathContext.length} articles in reference chains`);

        // Step 4: Get community context from top seed article
        const communityContext = await this.graphRAG.getCommunityContext(
          seedArticles[0].article_id,
          1, // Chapter level
        );

        // Step 5: Extract relevant concepts from all retrieved articles
        const relevantConcepts = await this.extractConcepts(
          seedArticles.map((s) => s.article),
          pathContext.map((p) => p.article),
        );

        const duration = Date.now() - startTime;
        logPerformance("HybridRetrieval.retrieve", duration, {
          seedArticles: seedArticles.length,
          pathContext: pathContext.length,
          concepts: relevantConcepts.length,
        });

        recordMetric({
          operation: "HybridRetrieval.retrieve",
          duration,
          success: true,
          metadata: {
            queryLength: query.length,
            mode,
            seedArticles: seedArticles.length,
            pathContext: pathContext.length,
          },
        });

        logger.info("Hybrid retrieval complete");

        return {
          query,
          seed_articles: seedArticles,
          path_context: pathContext,
          community_context: communityContext,
          community_reports: [], // No global reports in local/hybrid mode
          relevant_concepts: relevantConcepts,
          hierarchical_filter: filters || {},
          timestamp: new Date(),
        };
      },
      this.emptyContextBundle(query),
    );
  }

  /**
   * Stream hybrid retrieval results
   */
  async *retrieveStream(
    query: string,
    mode: "local" | "global" = "local",
  ): AsyncIterable<string> {
    // Validate query
    if (!validateQuery(query)) {
      logger.warn(`Invalid query provided for streaming: "${query}"`);
      yield "Lỗi: Truy vấn không hợp lệ.";
      return;
    }

    logger.info(`Streaming hybrid retrieval for query: "${query}"`);

    const startTime = Date.now();

    // Stream from MSGraphRAG engine
    try {
      const stream = this.graphRAG.queryStream(query, { mode, level: 1 });
      yield* stream;

      recordMetric({
        operation: "HybridRetrieval.retrieveStream",
        duration: Date.now() - startTime,
        success: true,
        metadata: { queryLength: query.length, mode },
      });
    } catch (error) {
      recordMetric({
        operation: "HybridRetrieval.retrieveStream",
        duration: Date.now() - startTime,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: { queryLength: query.length, mode },
      });
      logger.error("Error in hybrid streaming", error);
      yield "Lỗi khi truy xuất thông tin.";
    }
  }

  /**
   * Find seed articles using vector search
   */
  async findSeedArticles(
    query: string,
    limit: number = config.retrieval.topKSeedArticles,
  ): Promise<SeedArticle[]> {
    logger.debug(`Finding seed articles for query: "${query}"`);

    // Generate query embedding
    const queryVector = await this.embedder!.embed(query);

    // Use storage to search by embedding
    const entities = await this.storage.searchEntitiesByEmbedding(
      queryVector,
      limit,
    );

    // Convert to SeedArticle format
    const seedArticles: SeedArticle[] = [];

    for (const entity of entities) {
      const article = await this.entityToArticle(entity);
      if (article) {
        seedArticles.push({
          article_id: article.id,
          score: (entity.metadata?.score as number) || 1.0,
          article,
          matched_entity_id: entity.id,
        });
      }
    }

    return seedArticles;
  }

  /**
   * Find seed clauses for more granular retrieval
   */
  async findSeedClauses(
    query: string,
    limit: number = 5,
  ): Promise<
    Array<{
      clause_id: string;
      article_id: string;
      clause_number: number;
      text: string;
      score: number;
    }>
  > {
    logger.debug(`Finding seed clauses for query: "${query}"`);

    const queryVector = await this.embedder!.embed(query);
    const entities = await this.storage.searchEntitiesByEmbedding(
      queryVector,
      100, // Search even more to ensure we get clauses
    );

    return entities
      .filter(
        (e: any) =>
          e.id?.toLowerCase().includes("clause") || e.type === "Clause",
      )
      .slice(0, limit)
      .map((e: any) => {
        const lowerId = e.id.toLowerCase();
        const articleId = lowerId.split("_clause_")[0];
        const clauseMatch = lowerId.match(/_clause_(\d+)/);
        const clause_number = clauseMatch
          ? parseInt(clauseMatch[1], 10)
          : parseInt(e.metadata?.clause_number as string) || 1;
        return {
          clause_id: e.id,
          article_id: articleId,
          clause_number,
          text: e.description || e.name || "",
          score: (e.metadata?.score as number) || 1.0,
        };
      });
  }

  // ----------------------------------------------------------------------------
  // Private Helper Methods
  // ----------------------------------------------------------------------------

  /**
   * Extract seed articles from query and storage
   */
  private async extractSeedArticles(
    query: string,
    mode: "local" | "global" = "local",
  ): Promise<SeedArticle[]> {
    // Use MSGraphRAG to find relevant articles
    const result = await this.graphRAG.query(query, { mode, level: 1 });

    // Extract article IDs from response
    const articleIds = this.extractArticleIdsFromResponse(result.content);
    const graph = (this.storage as any).graph;

    const seedArticles: SeedArticle[] = [];
    for (const id of articleIds) {
      const article = await graph.getFullArticle(id);
      if (article) {
        seedArticles.push({
          article_id: article.id,
          score: 1.0,
          article,
          matched_entity_id: id,
        });
      }
    }

    return seedArticles;
  }

  /**
   * Extract article IDs (e.g. article_33) from response text
   */
  private extractArticleIdsFromResponse(response: string): string[] {
    const articleIds: string[] = [];
    const articleRegex = /Điều\s+(\d+)/g;
    const matches = [...response.matchAll(articleRegex)];

    for (const match of matches) {
      const articleNumber = parseInt(match[1], 10);
      articleIds.push(`article_${articleNumber}`);
    }

    return Array.from(new Set(articleIds));
  }

  /**
   * Convert entity to article node
   */
  private async entityToArticle(entity: {
    id: string;
    name: string;
    description?: string;
    metadata?: any;
  }): Promise<ArticleNode | null> {
    // Try to extract article number from ID
    if (!entity.id) return null;
    const articleMatch = entity.id.match(/article_(\d+)/i);
    if (!articleMatch) return null;
    const baseArticleId = `article_${articleMatch[1]}`;

    const graph = (this.storage as any).graph;
    if (graph) {
      const article = await graph.getFullArticle(baseArticleId);
      if (article) {
        // Merge metadata, prioritizing graph data but filling gaps from entity metadata
        // Merge metadata, prioritizing graph data but filling gaps from entity metadata
        const entityMeta = entity.metadata || {};
        const getVal = (
          graphVal: string | undefined,
          entityVal: string | undefined,
        ) => {
          if (!graphVal || graphVal === "N/A" || graphVal === "")
            return entityVal || "";
          return graphVal;
        };

        article.metadata = {
          part: getVal(article.metadata?.part, entityMeta.part),
          chapter: getVal(article.metadata?.chapter, entityMeta.chapter),
          section: getVal(article.metadata?.section, entityMeta.section),
          subsection: getVal(
            article.metadata?.subsection,
            entityMeta.subsection,
          ),
          source: getVal(article.metadata?.source, entityMeta.source),
        };

        return article;
      }
    }

    const articleNumber = parseInt(articleMatch[1], 10);
    return {
      id: entity.id,
      article_number: articleNumber,
      title: entity.name || `Điều ${articleNumber}`,
      content: entity.description || "",
      clauses: [],
      metadata: {
        part: entity.metadata?.part || "",
        chapter: entity.metadata?.chapter || "",
        section: entity.metadata?.section || "",
        subsection: entity.metadata?.subsection || "",
        source: entity.metadata?.source || "",
      },
      keywords: [],
      hierarchical_path: "",
      clause_count: 0,
    };
  }

  /**
   * Extract relevant legal concepts from articles
   */
  private async extractConcepts(
    ...articleLists: ArticleNode[][]
  ): Promise<LegalConceptNode[]> {
    // Collect all keywords from articles
    const allKeywords = new Set<string>();

    for (const articles of articleLists) {
      for (const article of articles) {
        if (article && Array.isArray(article.keywords)) {
          for (const keyword of article.keywords) {
            allKeywords.add(keyword);
          }
        }
      }
    }

    // Convert to concept nodes
    const concepts: LegalConceptNode[] = [];

    for (const keyword of Array.from(allKeywords).slice(
      0,
      config.retrieval.maxConcepts,
    )) {
      concepts.push({
        id: `concept_${keyword.toLowerCase().replace(/\s+/g, "_")}`,
        name: keyword,
        name_variants: [keyword],
        definition: "",
        category: this.categorizeConcept(keyword),
        source_articles: articleLists.flat().map((a) => a.id),
        source_clauses: [],
        related_concepts: [],
      });
    }

    return concepts;
  }

  /**
   * Categorize a legal concept
   */
  private categorizeConcept(concept: string): LegalConceptNode["category"] {
    const lower = concept.toLowerCase();

    if (lower.includes("người") || lower.includes("cá nhân")) {
      return "person";
    }
    if (lower.includes("tài sản") || lower.includes("sở hữu")) {
      return "property";
    }
    if (lower.includes("hợp đồng") || lower.includes("thỏa thuận")) {
      return "contract";
    }
    if (lower.includes("thừa kế") || lower.includes("di chúc")) {
      return "inheritance";
    }
    if (
      lower.includes("gia đình") ||
      lower.includes("kết hôn") ||
      lower.includes("ly hôn")
    ) {
      return "family";
    }
    if (lower.includes("bồi thường") || lower.includes("thiệt hại")) {
      return "tort";
    }

    return "other";
  }

  /**
   * Create empty context bundle
   */
  private emptyContextBundle(query: string): LegalContextBundle {
    return {
      query,
      seed_articles: [],
      path_context: [],
      community_context: {
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
      },
      community_reports: [],
      relevant_concepts: [],
      hierarchical_filter: {},
      timestamp: new Date(),
    };
  }

  /**
   * Get retrieval statistics
   */
  getStats(): {
    topKSeedArticles: number;
    pathTraversalDepth: number;
    maxConcepts: number;
  } {
    return {
      topKSeedArticles: config.retrieval.topKSeedArticles,
      pathTraversalDepth: config.retrieval.pathTraversalDepth,
      maxConcepts: config.retrieval.maxConcepts,
    };
  }
}

// ----------------------------------------------------------------------------
// Factory Function
// ----------------------------------------------------------------------------

export function createHybridRetrieval(
  storage: IStorage,
  llm?: BaseLLM,
  embedder?: IEmbedder,
): HybridRetrieval {
  return new HybridRetrieval(storage, llm, embedder);
}
