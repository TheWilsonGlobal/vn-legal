// ============================================================================
// PathRAG Implementation — direct ConGraphDB traversal
// ============================================================================
//
// Strategy:
//   1. traverseReferences  – keyword-match seed articles → BFS over REFERENCES edges
//   2. findPath            – BFS over REFERENCES + NEXT_ARTICLE edges
//   3. getReferencingArticles – query incoming REFERENCED_BY edges
//
// Uses direct GraphClient BFS over REFERENCES edges for reliable path discovery.
// The ConGraphRAG engine's findPaths follows ALL edge types (HAS_CLAUSE,
// BELONGS_TO_SECTION, etc.) which floods results with non-article nodes.
// Direct BFS gives the same quality as the baseline (vina-legal-new).
// ============================================================================

import type { IStorage } from "congraph-rag/core";
import type { GraphClient } from "../graph/client";
import type { ArticleNode, PathNode } from "../shared/types";
import logger from "../shared/logger";
import {
  validateQuery,
  logPerformance,
  recordMetric,
  safeGraphOperation,
} from "../shared/error-handling";

// ----------------------------------------------------------------------------
// PathRAG Wrapper
// ----------------------------------------------------------------------------

export class PathRAG {
  private graph: GraphClient;

  constructor(private storage: IStorage) {
    // Extract graph client from storage if it's our adapter
    this.graph = (storage as any).graph;
    if (!this.graph) {
      throw new Error(
        "PathRAG requires a storage adapter with an accessible GraphClient",
      );
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /** Load a full ArticleNode from the graph by its string id (e.g. "article_21") */
  private async loadArticle(id: string): Promise<ArticleNode | null> {
    return this.graph.getFullArticle(id);
  }

  /**
   * Find seed articles by keyword matching.
   * Searches Article nodes whose title or content contain query keywords.
   */
  private async findSeedArticles(query: string, limit = 5): Promise<string[]> {
    // Extract meaningful Vietnamese words (>= 3 chars)
    const keywords = query
      .split(/\s+/)
      .map((w) => w.toLowerCase().trim())
      .filter((w) => w.length >= 3);

    if (keywords.length === 0) return [];

    const allArticles = await this.graph.getNodesByType("Article");
    const scored: { id: string; score: number }[] = [];

    for (const node of allArticles) {
      const text =
        `${node.title ?? ""} ${node.content ?? ""} ${node.keywords ?? ""}`.toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (text.includes(kw)) score++;
      }
      if (score > 0) {
        // Always use the string primary key stored in node.id, not node._id (numeric offset)
        const nodeId: string = node.id ?? node._id;
        scored.push({ id: nodeId, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    // node.id is the PRIMARY KEY (e.g. "article_21"); node._id is numeric internal offset
    return scored.slice(0, limit).map((s) => s.id);
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Traverse reference chains starting from seed articles matched by the query.
   *
   * Steps:
   *   1. Find seed articles by keyword matching
   *   2. BFS through REFERENCES edges up to maxDepth hops
   *   3. Return each discovered article as a PathNode
   *
   * @param query - The legal query string
   * @param options.maxDepth - Max BFS hops (default 2)
   * @param options.maxPaths - Max total results (default 20)
   */
  async traverseReferences(
    query: string,
    options: { maxDepth?: number; maxPaths?: number } = {},
  ): Promise<PathNode[]> {
    const startTime = Date.now();
    const maxDepth = options.maxDepth ?? 2;
    const maxPaths = options.maxPaths ?? 20;

    if (!validateQuery(query)) {
      logger.warn(`Invalid query provided: "${query}"`);
      return [];
    }

    logger.debug(`Traversing references for query: "${query}"`);

    return safeGraphOperation(
      "PathRAG.traverseReferences",
      async () => {
        const seeds = await this.findSeedArticles(query);

        if (seeds.length === 0) {
          logger.debug("No seed articles found for query");
          logPerformance("PathRAG.traverseReferences", Date.now() - startTime);
          return [];
        }

        logger.debug(
          `Found ${seeds.length} seed articles: ${seeds.join(", ")}`,
        );

        const pathNodes: PathNode[] = [];
        const visited = new Set<string>(seeds);
        // queue: [articleId, currentPath, depth]
        const queue: Array<[string, string[], number]> = seeds.map((id) => [
          id,
          [id],
          0,
        ]);

        while (queue.length > 0 && pathNodes.length < maxPaths) {
          const [currentId, currentPath, depth] = queue.shift()!;

          // Record this node as a path result (skip the seeds themselves at depth 0
          // only if they are reached via a reference, i.e. depth > 0)
          if (depth > 0) {
            const article = await this.loadArticle(currentId);
            if (article) {
              pathNodes.push({
                article,
                depth,
                path: currentPath,
                relationship: "REFERENCES",
              });
            }
          } else {
            // Still add the seed itself so the caller can see where traversal started
            const article = await this.loadArticle(currentId);
            if (article) {
              pathNodes.push({
                article,
                depth: 0,
                path: currentPath,
                relationship: "seed",
              });
            }
          }

          if (depth < maxDepth) {
            const edges = await this.graph.getOutgoingEdges(
              currentId,
              "REFERENCES",
            );
            for (const edge of edges) {
              if (!visited.has(edge.to)) {
                visited.add(edge.to);
                queue.push([edge.to, [...currentPath, edge.to], depth + 1]);
              }
            }
          }
        }

        recordMetric({
          operation: "PathRAG.traverseReferences",
          duration: Date.now() - startTime,
          success: true,
          metadata: {
            queryLength: query.length,
            seedCount: seeds.length,
            resultCount: pathNodes.length,
          },
        });

        logPerformance("PathRAG.traverseReferences", Date.now() - startTime);
        return pathNodes;
      },
      [],
    );
  }

  /**
   * Stream PathRAG traversal results as text chunks.
   */
  async *traverseReferencesStream(query: string): AsyncIterable<string> {
    if (!validateQuery(query)) {
      logger.warn(`Invalid query provided for streaming: "${query}"`);
      yield "Lỗi: Truy vấn không hợp lệ.";
      return;
    }

    logger.debug(`Streaming PathRAG results for query: "${query}"`);

    try {
      const paths = await this.traverseReferences(query);
      if (paths.length === 0) {
        yield "Không tìm thấy điều khoản liên quan.";
        return;
      }
      for (const node of paths) {
        yield `Điều ${node.article.article_number}: ${node.article.title}\n`;
      }
    } catch (error) {
      recordMetric({
        operation: "PathRAG.traverseReferencesStream",
        duration: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: { queryLength: query.length },
      });
      logger.error("Error in PathRAG streaming", error);
      yield "Lỗi khi truy xuất thông tin.";
    }
  }

  /**
   * Find shortest path between two articles using BFS over
   * REFERENCES and NEXT_ARTICLE edges.
   */
  async findPath(
    fromArticleId: string,
    toArticleId: string,
  ): Promise<string[]> {
    logger.debug(`Finding path from ${fromArticleId} to ${toArticleId}`);

    if (fromArticleId === toArticleId) return [fromArticleId];

    const visited = new Set<string>([fromArticleId]);
    const queue: Array<string[]> = [[fromArticleId]];
    const maxIterations = 1000; // Prevent infinite loops
    let iterations = 0;

    while (queue.length > 0 && iterations < maxIterations) {
      iterations++;
      const path = queue.shift()!;
      const current = path[path.length - 1];

      // Outgoing: REFERENCES and NEXT_ARTICLE (forward)
      for (const edgeType of ["REFERENCES", "NEXT_ARTICLE"]) {
        const edges = await this.graph.getOutgoingEdges(current, edgeType);
        for (const edge of edges) {
          if (edge.to === toArticleId) {
            return [...path, edge.to];
          }
          if (!visited.has(edge.to)) {
            visited.add(edge.to);
            queue.push([...path, edge.to]);
          }
        }
      }

      // Incoming: NEXT_ARTICLE (backward — reach a predecessor)
      const prevEdges = await this.graph.getIncomingEdges(
        current,
        "NEXT_ARTICLE",
      );
      for (const edge of prevEdges) {
        if (edge.from === toArticleId) {
          return [...path, edge.from];
        }
        if (!visited.has(edge.from)) {
          visited.add(edge.from);
          queue.push([...path, edge.from]);
        }
      }

      // Limit BFS depth to avoid full graph scan
      if (path.length > 5) continue;
    }

    // No path found or max iterations reached
    logger.debug(`Path finding stopped after ${iterations} iterations`);
    return [];
  }

  /**
   * Get all articles that reference a given article via REFERENCED_BY edges.
   */
  async getReferencingArticles(articleId: string): Promise<ArticleNode[]> {
    logger.debug(`Getting articles that reference ${articleId}`);

    // REFERENCED_BY: (refArticleId) -[REFERENCED_BY]-> (articleId)
    const edges = await this.graph.getIncomingEdges(articleId, "REFERENCED_BY");
    const articles: ArticleNode[] = [];

    for (const edge of edges) {
      const article = await this.loadArticle(edge.from);
      if (article) articles.push(article);
    }

    return articles;
  }

  /**
   * Get reference context for an article (articles that explicitly reference it).
   */
  async getReferenceContext(
    articleId: string,
  ): Promise<
    Array<{ fromArticle: ArticleNode; context: string; referenceText: string }>
  > {
    logger.debug(`Getting reference context for ${articleId}`);

    const edges = await this.graph.getIncomingEdges(articleId, "REFERENCES");
    const results: Array<{
      fromArticle: ArticleNode;
      context: string;
      referenceText: string;
    }> = [];

    for (const edge of edges) {
      const article = await this.loadArticle(edge.from);
      if (article) {
        results.push({
          fromArticle: article,
          context: (edge as any).context ?? "",
          referenceText: (edge as any).reference_text ?? "",
        });
      }
    }

    return results;
  }
}

// ----------------------------------------------------------------------------
// Factory Function
// ----------------------------------------------------------------------------

export function createPathRAG(storage: IStorage, _llm?: any): PathRAG {
  return new PathRAG(storage);
}
