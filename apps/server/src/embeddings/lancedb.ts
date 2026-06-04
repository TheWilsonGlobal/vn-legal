// ============================================================================
// LanceDB Integration
// ============================================================================

import { connect, type Table, type Connection } from "@lancedb/lancedb";
import { config } from "../shared/config";
import logger from "../shared/logger";
import type {
  ArticleEmbedding,
  ClauseEmbedding,
  ArticleNode,
  ArticleClause,
} from "../shared/types";
import type { IEmbedder } from "./embedder-factory";

// ----------------------------------------------------------------------------
// LanceDB Client
// ----------------------------------------------------------------------------

export class VectorStore {
  private connection: Connection | null = null;
  private articlesTable: Table | null = null;
  private clausesTable: Table | null = null;
  private communityReportsTable: Table | null = null;
  private isInitialized = false;

  /**
   * Initialize LanceDB connection
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      logger.info(`Initializing LanceDB at ${config.vectorDbPath}`);
      this.connection = await connect(config.vectorDbPath);

      // Try to open tables if they exist
      try {
        this.articlesTable = await this.connection.openTable("articles");
        logger.info("Opened existing articles table");
      } catch {
        logger.info("Articles table does not exist yet");
      }

      try {
        this.clausesTable = await this.connection.openTable("clauses");
        logger.info("Opened existing clauses table");
      } catch {
        logger.info("Clauses table does not exist yet");
      }

      try {
        this.communityReportsTable =
          await this.connection.openTable("community_reports");
        logger.info("Opened existing community_reports table");
      } catch {
        logger.info("Community reports table does not exist yet");
      }

      this.isInitialized = true;
      logger.info("LanceDB initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize LanceDB", error);
      throw error;
    }
  }

  /**
   * Add article embeddings to the database
   */
  async addArticles(embeddings: ArticleEmbedding[]): Promise<void> {
    if (!this.connection) {
      throw new Error("LanceDB not initialized");
    }

    if (embeddings.length === 0) return;

    const firstDim = (embeddings[0] as ArticleEmbedding).vector?.length;
    logger.info(
      `Adding ${embeddings.length} article embeddings to LanceDB (dim: ${firstDim})`,
    );

    try {
      if (!this.articlesTable) {
        this.articlesTable = await this.connection.createTable(
          "articles",
          embeddings,
        );
        logger.info("Created new articles table with first batch");
      } else {
        await this.articlesTable.add(embeddings);
      }

      const afterCount = await (
        this.articlesTable as unknown as { countRows: () => Promise<number> }
      )
        .countRows()
        .catch(() => -1);
      logger.info(
        `Successfully added ${embeddings.length} article embeddings. New table size: ${afterCount}`,
      );
    } catch (error) {
      logger.error("Failed to add article embeddings", error);
      throw error;
    }
  }

  /**
   * Add clause embeddings to the database
   */
  async addClauses(embeddings: ClauseEmbedding[]): Promise<void> {
    if (!this.connection) {
      throw new Error("LanceDB not initialized");
    }

    if (embeddings.length === 0) return;

    const firstDim = (embeddings[0] as any).vector?.length;
    logger.info(
      `Adding ${embeddings.length} clause embeddings to LanceDB (dim: ${firstDim})`,
    );

    try {
      if (!this.clausesTable) {
        this.clausesTable = await this.connection.createTable(
          "clauses",
          embeddings,
        );
        logger.info("Created new clauses table with first batch");
      } else {
        await this.clausesTable.add(embeddings);
      }

      const afterCount = await (
        this.clausesTable as unknown as { countRows: () => Promise<number> }
      )
        .countRows()
        .catch(() => -1);
      logger.info(
        `Successfully added ${embeddings.length} clause embeddings. New table size: ${afterCount}`,
      );
    } catch (error) {
      logger.error("Failed to add clause embeddings", error);
      throw error;
    }
  }

  /**
   * Add community report embeddings to the database
   */
  async addCommunityReports(
    embeddings: Record<string, unknown>[],
  ): Promise<void> {
    if (!this.connection) {
      throw new Error("LanceDB not initialized");
    }

    if (embeddings.length === 0) return;

    try {
      if (!this.communityReportsTable) {
        this.communityReportsTable = await this.connection.createTable(
          "community_reports",
          embeddings,
        );
        logger.info("Created new community_reports table with first batch");
      } else {
        await this.communityReportsTable.add(embeddings);
      }
      logger.info(
        `Successfully added ${embeddings.length} community report embeddings`,
      );
    } catch (error) {
      logger.error("Failed to add community report embeddings", error);
      throw error;
    }
  }

  /**
   * Search for similar articles
   */
  async searchArticles(
    queryVector: number[],
    limit: number = 10,
    filter?: Partial<ArticleEmbedding>,
  ): Promise<Record<string, unknown>[]> {
    if (!this.articlesTable) {
      throw new Error("Articles table not initialized");
    }

    try {
      const count = await (
        this.articlesTable as unknown as { countRows: () => Promise<number> }
      )
        .countRows()
        .catch(() => -1);
      console.log(`DEBUG: searchArticles table size: ${count}`);
      let query = this.articlesTable.search(queryVector);

      if (filter) {
        // Apply filters if provided
        if (filter.part) {
          query = query.where(`part = '${filter.part}'`);
        }
        if (filter.chapter) {
          query = query.where(`chapter = '${filter.chapter}'`);
        }
        if (filter.section) {
          query = query.where(`section = '${filter.section}'`);
        }
        if (filter.subsection) {
          query = query.where(`subsection = '${filter.subsection}'`);
        }
      }

      // Convert to array and return results
      const results = (await query.limit(limit).toArray()) as Record<
        string,
        unknown
      >[];
      return results || [];
    } catch (error) {
      logger.error("Failed to search articles", error);
      throw error;
    }
  }

  /**
   * Search for multiple query vectors in parallel
   */
  async searchArticlesBatch(
    queryVectors: number[][],
    limit: number = 10,
    filter?: Partial<ArticleEmbedding>,
  ): Promise<Record<string, unknown>[][]> {
    if (!this.articlesTable) {
      throw new Error("Articles table not initialized");
    }

    try {
      logger.debug(
        `Searching batch of ${queryVectors.length} queries in LanceDB`,
      );
      // Simple parallel implementation for now
      return Promise.all(
        queryVectors.map((v) => this.searchArticles(v, limit, filter)),
      );
    } catch (error) {
      logger.error("Failed to batch search articles", error);
      throw error;
    }
  }

  /**
   * Search for similar clauses
   */
  async searchClauses(
    queryVector: number[],
    limit: number = 10,
    filter?: { chapter?: string },
  ): Promise<Record<string, unknown>[]> {
    if (!this.clausesTable) {
      throw new Error("Clauses table not initialized");
    }

    try {
      let query = this.clausesTable.search(queryVector);

      if (filter?.chapter) {
        query = query.where(`chapter = '${filter.chapter}'`);
      }

      const results = (await query.limit(limit).toArray()) as Record<
        string,
        unknown
      >[];
      return results || [];
    } catch (error) {
      logger.error("Failed to search clauses", error);
      throw error;
    }
  }

  /**
   * Search for similar community reports
   */
  async searchCommunityReports(
    queryVector: number[],
    limit: number = 3,
  ): Promise<Record<string, unknown>[]> {
    if (!this.communityReportsTable) {
      logger.warn(
        "Community reports table not initialized, skipping global search",
      );
      return [];
    }

    try {
      const query = this.communityReportsTable.search(queryVector).limit(limit);
      const results = (await query.toArray()) as Record<string, unknown>[];
      return results || [];
    } catch (error) {
      logger.error("Failed to search community reports", error);
      throw error;
    }
  }

  /**
   * Get article by ID
   */
  async getArticle(articleId: string): Promise<Record<string, unknown> | null> {
    if (!this.articlesTable) {
      throw new Error("Articles table not initialized");
    }

    try {
      const query = this.articlesTable
        .search(Array(config.embeddingDimension).fill(0)) // Dummy vector
        .where(`article_id = '${articleId}'`)
        .limit(1);

      const results = (await query.toArray()) as Record<string, unknown>[];
      return results?.[0] || null;
    } catch (error) {
      logger.error(`Failed to get article ${articleId}`, error);
      throw error;
    }
  }

  /**
   * Get clause by ID
   */
  async getClause(clauseId: string): Promise<Record<string, unknown> | null> {
    if (!this.clausesTable) {
      throw new Error("Clauses table not initialized");
    }

    try {
      const query = this.clausesTable
        .search(Array(config.embeddingDimension).fill(0)) // Dummy vector
        .where(`clause_id = '${clauseId}'`)
        .limit(1);

      const results = (await query.toArray()) as Record<string, unknown>[];
      return results?.[0] || null;
    } catch (error) {
      logger.error(`Failed to get clause ${clauseId}`, error);
      throw error;
    }
  }

  /**
   * Get statistics about the database
   */
  async getStats(): Promise<{ articleCount: number; clauseCount: number }> {
    let articleCount = 0;
    let clauseCount = 0;

    if (this.articlesTable) {
      try {
        articleCount = await (
          this.articlesTable as unknown as { countRows: () => Promise<number> }
        ).countRows();
      } catch {
        try {
          const rows = await (
            this.articlesTable as unknown as {
              toArrow: () => Promise<{ numRows: number }>;
            }
          ).toArrow();
          articleCount = rows?.numRows ?? 0;
        } catch {
          articleCount = -1; // unknown
        }
      }
    }

    if (this.clausesTable) {
      try {
        clauseCount = await (
          this.clausesTable as unknown as { countRows: () => Promise<number> }
        ).countRows();
      } catch {
        try {
          const rows = await (
            this.clausesTable as unknown as {
              toArrow: () => Promise<{ numRows: number }>;
            }
          ).toArrow();
          clauseCount = rows?.numRows ?? 0;
        } catch {
          clauseCount = -1; // unknown
        }
      }
    }

    return { articleCount, clauseCount };
  }

  /**
   * Get stats for community reports
   */
  async getCommunityReportCount(): Promise<number> {
    if (!this.communityReportsTable) return 0;
    try {
      return await (
        this.communityReportsTable as unknown as {
          countRows: () => Promise<number>;
        }
      ).countRows();
    } catch {
      return -1;
    }
  }

  /**
   * Delete all tables (clear database)
   */
  async clearAll(): Promise<void> {
    if (!this.connection) {
      throw new Error("LanceDB not initialized");
    }

    try {
      logger.info("Clearing all tables in LanceDB...");
      const tables = await this.connection.tableNames();
      for (const tableName of tables) {
        await this.connection.dropTable(tableName);
      }
      this.articlesTable = null;
      this.clausesTable = null;
      this.communityReportsTable = null;
      logger.info("Successfully cleared LanceDB database");
    } catch (error) {
      logger.error("Failed to clear LanceDB database", error);
      throw error;
    }
  }

  /**
   * Force checkpoint (no-op for LanceDB)
   */
  async checkpoint(): Promise<void> {
    return;
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
      this.isInitialized = false;
      logger.info("LanceDB connection closed");
    }
  }

  /**
   * Check if the database is initialized
   */
  isReady(): boolean {
    return (
      this.isInitialized &&
      this.articlesTable !== null &&
      this.clausesTable !== null
    );
  }

  getType(): string {
    return "lancedb";
  }

  /**
   * Get the underlying connection
   */
  getStore(): unknown {
    return this.connection;
  }
}

// ----------------------------------------------------------------------------
// Indexing Pipeline
// ----------------------------------------------------------------------------

export class IndexingPipeline {
  constructor(
    private vectorStore: VectorStore,
    private embedder: IEmbedder,
  ) {}

  /**
   * Index all articles from the graph
   */
  async indexArticles(articles: ArticleNode[]): Promise<void> {
    const batchSize = 200; // Increased for better performance with Python API
    logger.info(
      `Indexing ${articles.length} articles (Batch Size: ${batchSize})`,
    );

    for (let i = 0; i < articles.length; i += batchSize) {
      const batch = articles.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(articles.length / batchSize);
      logger.info(
        `[${batchNum}/${totalBatches}] Embedding ${batch.length} articles...`,
      );

      const texts = batch.map((a) => `${a.title} ${a.content}`);
      const batchEmbeddings = await this.embedder.embedBatch(texts);

      const data: ArticleEmbedding[] = batch.map((article, index) => ({
        vector: batchEmbeddings[index],
        article_id: article.id,
        article_number: article.article_number,
        title: article.title,
        part: article.metadata.part,
        chapter: article.metadata.chapter,
        section: article.metadata.section,
        subsection: article.metadata.subsection,
        keywords: Array.isArray(article.keywords)
          ? article.keywords.join(", ")
          : "",
        content: article.content,
      }));

      await this.vectorStore.addArticles(data);
      logger.info(
        `[${batchNum}/${totalBatches}] Added ${data.length} articles to vector store`,
      );
    }
  }

  /**
   * Index all clauses from the articles
   */
  async indexClauses(articles: ArticleNode[]): Promise<void> {
    // Match ConGraphDB approach: Collect all clauses first, then batch them
    logger.info(`Collecting clauses from ${articles.length} articles`);

    const allClauses: ClauseEmbedding[] = [];
    const articleBatchSize = 100; // Process articles in larger batches
    const clauseBatchSize = 500; // Add clauses in larger batches

    for (let i = 0; i < articles.length; i += articleBatchSize) {
      const articleBatch = articles.slice(i, i + articleBatchSize);
      const batchNum = Math.floor(i / articleBatchSize) + 1;
      const totalBatches = Math.ceil(articles.length / articleBatchSize);

      logger.info(
        `[${batchNum}/${totalBatches}] Processing ${articleBatch.length} articles...`,
      );

      // Collect all clauses from these articles
      const clauseTexts: string[] = [];
      const clauseMetadata: Array<{
        clause: ArticleClause;
        article: ArticleNode;
        text: string;
      }> = [];

      for (const article of articleBatch) {
        for (const clause of article.clauses) {
          const text = `${article.title} - Khoản ${clause.clause_number}: ${clause.text}`;
          clauseTexts.push(text);
          clauseMetadata.push({ clause, article, text });
        }
      }

      if (clauseTexts.length === 0) continue;

      logger.info(
        `[${batchNum}/${totalBatches}] Embedding ${clauseTexts.length} clauses...`,
      );
      const clauseEmbeddings = await this.embedder.embedBatch(clauseTexts);

      // Create clause embeddings
      for (let j = 0; j < clauseMetadata.length; j++) {
        const { clause, article } = clauseMetadata[j];
        allClauses.push({
          vector: clauseEmbeddings[j],
          clause_id: clause.id,
          article_id: article.id,
          clause_number: clause.clause_number,
          text: clause.text,
          article_title: article.title,
          part: article.metadata.part,
          chapter: article.metadata.chapter,
        });
      }

      // Add clauses in batches
      for (let k = 0; k < allClauses.length; k += clauseBatchSize) {
        const clauseBatch = allClauses.slice(k, k + clauseBatchSize);
        await this.vectorStore.addClauses(clauseBatch);
        logger.info(
          `[${batchNum}/${totalBatches}] Added ${clauseBatch.length} clauses (${k + clauseBatch.length}/${allClauses.length})`,
        );
      }

      // Clear for next article batch
      allClauses.length = 0;
    }

    logger.info(`Clause indexing complete: Total clauses indexed`);
  }

  /**
   * Index both articles and clauses
   */
  async indexAll(articles: ArticleNode[]): Promise<void> {
    await this.indexArticles(articles);
    await this.indexClauses(articles);
  }

  /**
   * Index community reports
   */
  async indexCommunityReports(
    reports: Record<string, unknown>[],
  ): Promise<void> {
    if (reports.length === 0) return;

    logger.info(`Indexing ${reports.length} community reports`);
    const data: Record<string, unknown>[] = [];

    for (const report of reports) {
      try {
        const findings = Array.isArray(report.findings) ? report.findings : [];
        const textToEmbed = `${report.title} ${report.summary} ${findings.join(" ")}`;
        const embedding = await this.embedder.embed(textToEmbed);

        if (!embedding || embedding.length === 0) {
          logger.warn(
            `Failed to generate embedding for report: ${(report as any).community_id}`,
          );
          continue;
        }

        data.push({
          vector: embedding,
          id: (report as any).community_id || report.id,
          level: report.level,
          title: report.title,
          summary: report.summary,
          findings: Array.isArray(report.findings)
            ? report.findings.join("\n")
            : String(report.findings),
          rating: report.rating,
          parent_id: (report as any).parent_id || "",
        });
      } catch (err) {
        logger.error(
          `Error processing community report ${report.community_id}:`,
          err,
        );
      }
    }

    if (data.length > 0) {
      logger.info(`Adding ${data.length} valid community reports to LanceDB`);
      await this.vectorStore.addCommunityReports(data);
    } else {
      logger.warn("No valid community reports to index");
    }
  }
}

// ----------------------------------------------------------------------------
// Factory Functions
// ----------------------------------------------------------------------------

export async function createVectorStore(): Promise<VectorStore> {
  const store = new VectorStore();
  await store.initialize();
  return store;
}

export async function createIndexingPipeline(
  vectorStore: VectorStore,
  embedder: IEmbedder,
): Promise<IndexingPipeline> {
  return new IndexingPipeline(vectorStore, embedder);
}
