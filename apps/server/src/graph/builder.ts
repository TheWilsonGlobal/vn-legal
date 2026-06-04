// ============================================================================
// Graph Builder for Vietnam Legal Data
// ============================================================================

import logger from "../shared/logger";
import type { GraphClient } from "./client";
import type {
  ArticleNode,
  CommunityReport,
  ParsedLegalData,
} from "../shared/types";

export class GraphBuilder {
  constructor(private client: GraphClient) {}

  /**
   * Build the entire graph from parsed legal data
   */
  async buildGraph(parsedData: ParsedLegalData): Promise<void> {
    logger.info("Building graph from parsed legal data");
    await this.runBuildPipeline(parsedData, true);
  }

  /**
   * Add more data to the existing graph
   */
  async addGraph(parsedData: ParsedLegalData): Promise<void> {
    logger.info("Adding data to existing graph");
    await this.runBuildPipeline(parsedData, false);
  }

  /**
   * Shared build pipeline
   */
  private async runBuildPipeline(
    parsedData: ParsedLegalData,
    _isFullRebuild: boolean,
  ): Promise<void> {
    const startTotal = Date.now();

    // Build hierarchy nodes
    const startHierarchy = Date.now();
    await this.buildHierarchy(parsedData);
    logger.info(
      `✓ Hierarchy built in ${((Date.now() - startHierarchy) / 1000).toFixed(2)}s`,
    );

    // Build articles and their content
    const startArticles = Date.now();
    await this.buildArticles(parsedData);
    logger.info(
      `✓ Articles built in ${((Date.now() - startArticles) / 1000).toFixed(2)}s`,
    );

    // Build edges
    const startEdges = Date.now();
    await this.buildEdges(parsedData);
    logger.info(
      `✓ Edges built in ${((Date.now() - startEdges) / 1000).toFixed(2)}s`,
    );

    // Build references
    const startRefs = Date.now();
    await this.buildReferences(parsedData);
    logger.info(
      `✓ References built in ${((Date.now() - startRefs) / 1000).toFixed(2)}s`,
    );

    // Build Community Reports (Phase 1.2)
    const startCommunities = Date.now();
    if (parsedData.communityReports) {
      await this.buildCommunityReports(parsedData.communityReports, parsedData);
      logger.info(
        `✓ Community reports built in ${((Date.now() - startCommunities) / 1000).toFixed(2)}s`,
      );
    }

    logger.info(
      `Graph operation complete in ${((Date.now() - startTotal) / 1000).toFixed(2)}s`,
    );
  }

  /**
   * Build hierarchy nodes (Part, Chapter, Section, Subsection)
   */
  private async buildHierarchy(parsedData: ParsedLegalData): Promise<void> {
    logger.info("Building hierarchy nodes");

    // Batch create Part nodes
    const parts = Array.from(parsedData.parts.entries()).map(([id, part]) => ({
      id,
      ...part,
    }));
    const partOffsets = await this.client.createNodesBatch("Part", parts);
    parts.forEach((p, i) => this.client.idToOffset.set(p.id, partOffsets[i]));

    // Batch create Chapter nodes
    const chapters = Array.from(parsedData.chapters.entries()).map(
      ([id, chapter]) => ({ id, ...chapter }),
    );
    const chapterOffsets = await this.client.createNodesBatch(
      "Chapter",
      chapters,
    );
    chapters.forEach((c, i) =>
      this.client.idToOffset.set(c.id, chapterOffsets[i]),
    );

    // Batch create Section nodes
    const sections = Array.from(parsedData.sections.entries()).map(
      ([id, section]) => ({ id, ...section }),
    );
    const sectionOffsets = await this.client.createNodesBatch(
      "Section",
      sections,
    );
    sections.forEach((s, i) =>
      this.client.idToOffset.set(s.id, sectionOffsets[i]),
    );

    // Batch create Subsection nodes
    const subsections = Array.from(parsedData.subsections.entries()).map(
      ([id, sub]) => ({ id, ...sub }),
    );
    const subsectionOffsets = await this.client.createNodesBatch(
      "Subsection",
      subsections,
    );
    subsections.forEach((s, i) =>
      this.client.idToOffset.set(s.id, subsectionOffsets[i]),
    );
  }

  /**
   * Build article nodes and their clauses/points
   */
  private async buildArticles(parsedData: ParsedLegalData): Promise<void> {
    logger.info("Building article nodes");

    const articleNodes: Array<{ id: string; [key: string]: any }> = [];
    const clauseNodes: Array<{ id: string; [key: string]: any }> = [];
    const pointNodes: Array<{ id: string; [key: string]: any }> = [];

    for (const [id, article] of parsedData.articles) {
      articleNodes.push({
        id,
        article_number: article.article_number,
        title: article.title,
        content: article.content,
        clause_count: article.clause_count,
        metadata: JSON.stringify(article.metadata),
        hierarchical_path: article.hierarchical_path,
        keywords: JSON.stringify(article.keywords),
      });

      for (const clause of article.clauses) {
        clauseNodes.push({
          id: clause.id,
          clause_number: clause.clause_number,
          text: clause.text,
          article_id: clause.article_id,
          point_count: clause.point_count,
        });

        for (const point of clause.points) {
          pointNodes.push({
            id: point.id,
            point_letter: point.point_letter,
            text: point.text,
            clause_id: point.clause_id,
          });
        }
      }
    }

    if (articleNodes.length > 0) {
      const offsets = await this.client.createNodesBatch(
        "Article",
        articleNodes,
      );
      articleNodes.forEach((a, i) =>
        this.client.idToOffset.set(a.id, offsets[i]),
      );
    }

    if (clauseNodes.length > 0) {
      const offsets = await this.client.createNodesBatch("Clause", clauseNodes);
      clauseNodes.forEach((c, i) =>
        this.client.idToOffset.set(c.id, offsets[i]),
      );
    }

    if (pointNodes.length > 0) {
      const offsets = await this.client.createNodesBatch(
        "ClausePoint",
        pointNodes,
      );
      pointNodes.forEach((p, i) =>
        this.client.idToOffset.set(p.id, offsets[i]),
      );
    }
  }

  /**
   * Build edges between nodes
   */
  private async buildEdges(parsedData: ParsedLegalData): Promise<void> {
    logger.info("Building edges");

    // Build hierarchy edges
    const hierarchyEdges: Record<string, unknown>[] = [];

    for (const [partId, chapterIds] of parsedData.partToChapters) {
      for (let i = 0; i < chapterIds.length; i++) {
        hierarchyEdges.push({
          from: partId,
          to: chapterIds[i],
          type: "HAS_CHAPTER",
          order: i + 1,
        });
      }
    }

    for (const [chapterId, sectionIds] of parsedData.chapterToSections) {
      for (let i = 0; i < sectionIds.length; i++) {
        hierarchyEdges.push({
          from: chapterId,
          to: sectionIds[i],
          type: "HAS_SECTION",
          order: i + 1,
        });
      }
    }

    for (const [sectionId, subsectionIds] of parsedData.sectionToSubsections) {
      for (let i = 0; i < subsectionIds.length; i++) {
        hierarchyEdges.push({
          from: sectionId,
          to: subsectionIds[i],
          type: "HAS_SUBSECTION",
          order: i + 1,
        });
      }
    }

    if (hierarchyEdges.length > 0) {
      await this.client.createEdgesBatch(hierarchyEdges);
    }

    // Build article belongs-to edges
    const belongsToEdges: Record<string, unknown>[] = [];
    for (const [articleId, parent] of parsedData.articleToParent) {
      let type = "BELONGS_TO_SUBSECTION";
      if (parent.type === "section") {
        type = "BELONGS_TO_SECTION";
      } else if (parent.type === "chapter") {
        type = "BELONGS_TO_CHAPTER";
      }

      belongsToEdges.push({
        from: articleId,
        to: parent.id,
        type: type,
        level: parent.type as "subsection" | "section" | "chapter",
      });
    }
    if (belongsToEdges.length > 0) {
      await this.client.createEdgesBatch(belongsToEdges);
    }

    // Build hierarchy upward edges
    const upwardEdges: Record<string, unknown>[] = [];

    // Chapter -> Part
    for (const [id, ch] of parsedData.chapters) {
      if (ch.part_id) {
        upwardEdges.push({
          from: id,
          to: ch.part_id,
          type: "BELONGS_TO_PART",
        });
      }
    }

    // Section -> Chapter
    for (const [id, sec] of parsedData.sections) {
      if (sec.chapter_id) {
        upwardEdges.push({
          from: id,
          to: sec.chapter_id,
          type: "BELONGS_TO_CHAPTER",
        });
      }
    }

    // Subsection -> Section
    for (const [id, sub] of parsedData.subsections) {
      if (sub.section_id) {
        upwardEdges.push({
          from: id,
          to: sub.section_id,
          type: "BELONGS_TO_SECTION",
        });
      }
    }

    if (upwardEdges.length > 0) {
      logger.debug(`Creating ${upwardEdges.length} hierarchy upward edges...`);
      await this.client.createEdgesBatch(upwardEdges);
    }

    // Build article-clause edges
    const clauseEdges: Record<string, unknown>[] = [];
    for (const [id, article] of parsedData.articles) {
      for (let i = 0; i < article.clauses.length; i++) {
        const clause = article.clauses[i];
        clauseEdges.push({
          from: id,
          to: clause.id,
          type: "HAS_CLAUSE",
          order: i + 1,
        });
      }
    }
    if (clauseEdges.length > 0) {
      await this.client.createEdgesBatch(clauseEdges);
    }

    // Build clause-point edges
    const pointEdges: Record<string, unknown>[] = [];
    for (const [, article] of parsedData.articles) {
      for (const clause of article.clauses) {
        for (let i = 0; i < clause.points.length; i++) {
          const point = clause.points[i];
          pointEdges.push({
            from: clause.id,
            to: point.id,
            type: "HAS_POINT",
            order: i + 1,
          });
        }
      }
    }
    if (pointEdges.length > 0) {
      await this.client.createEdgesBatch(pointEdges);
    }

    // Build next-article edges
    const nextArticleEdges: Record<string, unknown>[] = [];
    const sortedArticles = (
      Array.from(parsedData.articles.values()) as ArticleNode[]
    ).sort((a, b) => a.article_number - b.article_number);

    for (let i = 0; i < sortedArticles.length - 1; i++) {
      const current = sortedArticles[i];
      const next = sortedArticles[i + 1];

      // Check if they're in the same context
      const currentParent = parsedData.articleToParent.get(current.id);
      const nextParent = parsedData.articleToParent.get(next.id);
      const sameContext = currentParent?.id === nextParent?.id;

      nextArticleEdges.push({
        from: current.id,
        to: next.id,
        type: "NEXT_ARTICLE",
        same_context: sameContext,
      });
    }
    if (nextArticleEdges.length > 0) {
      await this.client.createEdgesBatch(nextArticleEdges);
    }
  }

  /**
   * Detect and build reference edges between articles
   */
  private async buildReferences(parsedData: ParsedLegalData): Promise<void> {
    logger.info("Building reference edges");
    const edges: Record<string, unknown>[] = [];

    for (const [id, article] of parsedData.articles) {
      const references = this.extractReferences(article.content);

      for (const refArticleNumber of references) {
        const refArticleId = `article_${refArticleNumber}`;
        let refArticle = parsedData.articles.get(refArticleId);

        // If not in current parsed data, check if it exists in the database
        if (!refArticle) {
          const exists = await this.client.getNode("Article", refArticleId);
          if (exists) {
            // Mock article node just for reference building
            refArticle = { id: refArticleId } as unknown as ArticleNode;
          }
        }

        if (refArticle) {
          edges.push({
            from: id,
            to: refArticleId,
            type: "REFERENCES",
            reference_type: "explicit",
            context: article.content.substring(0, 100),
            reference_text: `Điều ${refArticleNumber}`,
            strength: 1.0,
          });

          // Add reverse reference
          edges.push({
            from: refArticleId,
            to: id,
            type: "REFERENCED_BY",
          });
        }
      }
    }

    if (edges.length > 0) {
      await this.client.createEdgesBatch(edges);
    }
  }

  /**
   * Extract article references from text
   */
  private extractReferences(text: string): number[] {
    if (!text) return [];
    const references: number[] = [];
    const regex = /điều\s+(\d+)/gi;
    const matches = [...text.matchAll(regex)];

    for (const match of matches) {
      const articleNumber = parseInt(match[1], 10);
      if (!references.includes(articleNumber)) {
        references.push(articleNumber);
      }
    }

    return references;
  }

  /**
   * Build Community nodes and their relationships (Global Search Phase)
   */
  private async buildCommunityReports(
    reports: CommunityReport[],
    parsedData: ParsedLegalData,
  ): Promise<void> {
    logger.info(`Building ${reports.length} community nodes`);

    const communityNodes = reports.map((r) => ({
      id: r.community_id || r.id,
      level: r.level,
      title: r.title,
      summary: r.summary,
      rating: r.rating,
      findings: JSON.stringify(r.findings || []),
      principles: r.principles || "",
      article_count: r.article_count || 0,
    }));

    const offsets = await this.client.createNodesBatch(
      "Community",
      communityNodes,
    );
    communityNodes.forEach((c, i) =>
      this.client.idToOffset.set(c.id, offsets[i]),
    );

    const edges: Record<string, unknown>[] = [];

    // 1. Hierarchical edges: [:CONTAINS] from Level 0 to Level 1
    for (const report of reports) {
      if (report.level === 1 && report.parent_id) {
        edges.push({
          from: report.parent_id,
          to: report.community_id || report.id,
          type: "CONTAINS",
        });
      }
    }

    // 2. Structural edges: [:BELONGS_TO] from Article nodes to Level 1 Community nodes
    // Map articles to chapters (Level 1)
    for (const [articleId, parent] of parsedData.articleToParent) {
      if (parent.type === "chapter") {
        const communityId = parent.id.replace("chapter_", "chapter_"); // Assumes community_id matches chapter_id
        if (this.client.idToOffset.has(communityId)) {
          edges.push({
            from: articleId,
            to: communityId,
            type: "BELONGS_TO_COMMUNITY",
          });
        }
      } else if (parent.type === "section" || parent.type === "subsection") {
        // Need to find the chapter for this section/subsection
        let chapterId: string | null = null;
        if (parent.type === "section") {
          chapterId = parsedData.sections.get(parent.id)?.chapter_id || null;
        } else {
          const sectionId = parsedData.subsections.get(parent.id)?.section_id;
          if (sectionId) {
            chapterId = parsedData.sections.get(sectionId)?.chapter_id || null;
          }
        }

        if (chapterId && this.client.idToOffset.has(chapterId)) {
          edges.push({
            from: articleId,
            to: chapterId,
            type: "BELONGS_TO_COMMUNITY",
          });
        }
      }
    }

    if (edges.length > 0) {
      logger.info(`Creating ${edges.length} community edges`);
      await this.client.createEdgesBatch(edges);
    }
  }
}

/**
 * Factory for creating a GraphBuilder
 */
export async function createGraphBuilder(
  client: GraphClient,
): Promise<GraphBuilder> {
  return new GraphBuilder(client);
}
