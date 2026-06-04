// ============================================================================
// ConGraphDB Vector Store Integration
// ============================================================================

import { createVectorStore, type VectorStore } from "congraphdb";
import { config } from "../shared/config";
import logger from "../shared/logger";
import type {
  ArticleEmbedding,
  ClauseEmbedding,
  ArticleNode,
} from "../shared/types";
import type { IEmbedder } from "./embedder-factory";

// ----------------------------------------------------------------------------
// ConGraphDB Vector Store Client
// ----------------------------------------------------------------------------

export class ConGraphVectorStore {
  private store: VectorStore | null = null;
  private articlesTable = "articles";
  private clausesTable = "clauses";
  private communityReportsTable = "community_reports";
  private isInitialized = false;

  /**
   * Initialize ConGraphDB vector store
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      logger.info(
        `Initializing ConGraphDB vector store at ${config.conGraphVectorDbPath}`,
      );

      this.store = createVectorStore(config.conGraphVectorDbPath);
      await this.store.init();

      // Check if tables exist, create if not
      const tables = await this.store.getTables();
      const tableNames = tables.map((t: any) => t.name);

      if (!tableNames.includes(this.articlesTable)) {
        await this.createArticlesTable();
      } else {
        logger.info("Articles table already exists");
      }

      if (!tableNames.includes(this.clausesTable)) {
        await this.createClausesTable();
      } else {
        logger.info("Clauses table already exists");
      }

      if (!tableNames.includes(this.communityReportsTable)) {
        await this.createCommunityReportsTable();
      } else {
        logger.info("Community reports table already exists");
      }

      this.isInitialized = true;
      logger.info("ConGraphDB vector store initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize ConGraphDB vector store", error);
      throw error;
    }
  }

  /**
   * Create articles table with HNSW index
   */
  private async createArticlesTable(): Promise<void> {
    if (!this.store) throw new Error("Vector store not initialized");

    logger.info("Creating articles table with HNSW index");

    await this.store.createTable(this.articlesTable, {
      properties: {
        article_id: "STRING",
        article_number: "INT64",
        title: "STRING",
        part: "STRING",
        chapter: "STRING",
        section: "STRING",
        subsection: "STRING",
        keywords: "STRING",
        content: "STRING",
      },
      vectorProperty: "vector",
      vectorDim: config.embeddingDimension,
      primaryKey: "article_id",
      indexOptions: {
        m: 14,
        efConstruction: 150,
        metric: "cosine",
      },
    });

    logger.info("Articles table created");
  }

  /**
   * Create clauses table with HNSW index
   */
  private async createClausesTable(): Promise<void> {
    if (!this.store) throw new Error("Vector store not initialized");

    logger.info("Creating clauses table with HNSW index");

    await this.store.createTable(this.clausesTable, {
      properties: {
        clause_id: "STRING",
        article_id: "STRING",
        clause_number: "INT64",
        text: "STRING",
        article_title: "STRING",
        part: "STRING",
        chapter: "STRING",
      },
      vectorProperty: "vector",
      vectorDim: config.embeddingDimension,
      primaryKey: "clause_id",
      indexOptions: {
        m: 14,
        efConstruction: 150,
        metric: "cosine",
      },
    });

    logger.info("Clauses table created");
  }

  /**
   * Create community reports table with HNSW index
   */
  private async createCommunityReportsTable(): Promise<void> {
    if (!this.store) throw new Error("Vector store not initialized");

    logger.info("Creating community reports table with HNSW index");

    await this.store.createTable(this.communityReportsTable, {
      properties: {
        id: "STRING",
        level: "INT64",
        title: "STRING",
        summary: "STRING",
        findings: "STRING",
        rating: "DOUBLE",
        parent_id: "STRING",
      },
      vectorProperty: "vector",
      vectorDim: config.embeddingDimension,
      primaryKey: "id",
      indexOptions: {
        m: 14,
        efConstruction: 150,
        metric: "cosine",
      },
    });

    logger.info("Community reports table created");
  }

  /**
   * Add article embeddings to the database
   */
  async addArticles(embeddings: ArticleEmbedding[]): Promise<void> {
    if (!this.store) {
      throw new Error("ConGraphDB vector store not initialized");
    }

    if (embeddings.length === 0) return;

    try {
      // add() returns a Promise, must be awaited
      await this.store.add(this.articlesTable, embeddings);

      // count() returns a Promise
      const count = await this.store.count(this.articlesTable);
      logger.info(
        `Successfully added ${embeddings.length} article embeddings. Total count: ${count}`,
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
    if (!this.store) {
      throw new Error("ConGraphDB vector store not initialized");
    }

    if (embeddings.length === 0) return;

    logger.info(`Adding ${embeddings.length} clause embeddings to ConGraphDB`);

    try {
      await this.store.add(this.clausesTable, embeddings);

      const count = await this.store.count(this.clausesTable);
      logger.info(
        `Successfully added clause embeddings. Total count: ${count}`,
      );
    } catch (error) {
      logger.error("Failed to add clause embeddings", error);
      throw error;
    }
  }

  /**
   * Add community report embeddings to the database
   */
  async addCommunityReports(embeddings: any[]): Promise<void> {
    if (!this.store) {
      throw new Error("ConGraphDB vector store not initialized");
    }

    if (embeddings.length === 0) return;

    logger.info(`Adding ${embeddings.length} community report embeddings`);

    try {
      await this.store.add(this.communityReportsTable, embeddings);
      logger.info(`Successfully added community report embeddings`);
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
  ): Promise<any[]> {
    if (!this.store) {
      throw new Error("ConGraphDB vector store not initialized");
    }

    try {
      logger.debug(
        `Searching articles with vector length: ${queryVector.length}, limit: ${limit}`,
      );
      const searchOptions: any = {
        limit,
        vectorProperty: "vector",
      };

      if (filter && Object.keys(filter).length > 0) {
        searchOptions.filter = filter;
      }

      const results = await this.store.search(
        this.articlesTable,
        queryVector,
        searchOptions,
      );
      logger.debug(`Article search returned ${results?.length || 0} results`);

      // Unwrap wrapped results (ConGraphDB may return { n: { ... } })
      const unwrappedResults = (results || []).map((r: any) => {
        if (r.n) return r.n;
        if (r[this.articlesTable]) return r[this.articlesTable];
        return r;
      });

      return unwrappedResults;
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
  ): Promise<any[][]> {
    if (!this.store) {
      throw new Error("ConGraphDB vector store not initialized");
    }

    try {
      logger.debug(`Searching batch of ${queryVectors.length} queries`);
      const searchOptions: any = {
        limit,
        vectorProperty: "vector",
      };

      if (filter && Object.keys(filter).length > 0) {
        searchOptions.filter = filter;
      }

      const results = await (this.store as any).searchBatch(
        this.articlesTable,
        queryVectors,
        searchOptions,
      );

      // Unwrap wrapped results for each batch
      const unwrappedResults = (results || []).map((batch: any[]) =>
        (batch || []).map((r: any) => {
          if (r.n) return r.n;
          if (r[this.articlesTable]) return r[this.articlesTable];
          return r;
        }),
      );

      return unwrappedResults;
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
  ): Promise<any[]> {
    if (!this.store) {
      throw new Error("ConGraphDB vector store not initialized");
    }

    try {
      const searchOptions: any = {
        limit,
        vectorProperty: "vector",
      };

      if (filter && Object.keys(filter).length > 0) {
        searchOptions.filter = filter;
      }

      const results = await this.store.search(
        this.clausesTable,
        queryVector,
        searchOptions,
      );
      // logger.debug(`Clause search returned ${results?.length || 0} results`);

      // Unwrap wrapped results (ConGraphDB may return { n: { ... } })
      const unwrappedResults = (results || []).map((r: any) => {
        if (r.n) return r.n;
        if (r[this.clausesTable]) return r[this.clausesTable];
        return r;
      });

      return unwrappedResults;
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
  ): Promise<any[]> {
    if (!this.store) {
      logger.warn(
        "ConGraphDB vector store not initialized, skipping global search",
      );
      return [];
    }

    try {
      const results = await this.store.search(
        this.communityReportsTable,
        queryVector,
        {
          limit,
          vectorProperty: "vector",
        },
      );

      // Unwrap wrapped results (ConGraphDB may return { n: { ... } })
      const unwrappedResults = (results || []).map((r: any) => {
        if (r.n) return r.n;
        if (r[this.communityReportsTable]) return r[this.communityReportsTable];
        return r;
      });

      return unwrappedResults;
    } catch (error) {
      logger.error("Failed to search community reports", error);
      throw error;
    }
  }

  /**
   * Get article by ID
   */
  async getArticle(articleId: string): Promise<any | null> {
    if (!this.store) {
      throw new Error("ConGraphDB vector store not initialized");
    }

    try {
      const result = await this.store.get(
        this.articlesTable,
        articleId,
        "article_id",
      );
      if (!result) return null;

      // Handle cases where the result is wrapped in a variable name like { n: { ... } } or { articles: { ... } }
      if (result.n) return result.n;
      if (result[this.articlesTable]) return result[this.articlesTable];

      return result;
    } catch (error) {
      logger.error(`Failed to get article ${articleId}`, error);
      throw error;
    }
  }

  /**
   * Get clause by ID
   */
  async getClause(clauseId: string): Promise<any | null> {
    if (!this.store) {
      throw new Error("ConGraphDB vector store not initialized");
    }

    try {
      const result = await this.store.get(
        this.clausesTable,
        clauseId,
        "clause_id",
      );
      if (!result) return null;

      // Handle wrapped results
      if (result.n) return result.n;
      if (result[this.clausesTable]) return result[this.clausesTable];

      return result;
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

    if (this.store) {
      try {
        articleCount = await this.store.count(this.articlesTable);
      } catch {
        articleCount = -1;
      }

      try {
        clauseCount = await this.store.count(this.clausesTable);
      } catch {
        clauseCount = -1;
      }
    }

    return { articleCount, clauseCount };
  }

  /**
   * Get stats for community reports
   */
  async getCommunityReportCount(): Promise<number> {
    if (!this.store) return 0;
    try {
      return await this.store.count(this.communityReportsTable);
    } catch {
      return -1;
    }
  }

  /**
   * Delete all tables (clear database)
   */
  async clearAll(): Promise<void> {
    if (!this.store) {
      throw new Error("ConGraphDB vector store not initialized");
    }

    try {
      logger.info("Clearing all tables in ConGraphDB vector store...");

      await this.store.clear(this.articlesTable);
      await this.store.clear(this.clausesTable);
      await this.store.clear(this.communityReportsTable);

      logger.info("Successfully cleared ConGraphDB vector store");
    } catch (error) {
      logger.error("Failed to clear ConGraphDB vector store", error);
      throw error;
    }
  }

  /**
   * Force checkpoint to persist all pending data
   */
  async checkpoint(): Promise<void> {
    if (!this.store) {
      throw new Error("ConGraphDB vector store not initialized");
    }

    try {
      await this.store.checkpoint();
      logger.info("ConGraphDB vector store checkpoint completed");
    } catch (error) {
      logger.error("Failed to checkpoint ConGraphDB vector store", error);
      throw error;
    }
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    if (this.store) {
      await this.store.close();
      this.store = null;
      this.isInitialized = false;
      // logger.info("ConGraphDB vector store connection closed");
    }
  }

  /**
   * Get the underlying store
   */
  public getStore(): any {
    return this.store;
  }

  /**
   * Check if the database is initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.store !== null;
  }

  getType(): string {
    return "congraph";
  }
}

// ----------------------------------------------------------------------------
// Indexing Pipeline
// ----------------------------------------------------------------------------

export class ConGraphIndexingPipeline {
  constructor(
    private vectorStore: ConGraphVectorStore,
    private embedder: IEmbedder,
  ) {}

  /**
   * Index all articles from the graph
   */
  async indexArticles(articles: ArticleNode[]): Promise<void> {
    const batchSize = 200; // Increased from 50 for better performance
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
    // Optimize: Collect all clauses first, then batch them
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
        clause: any;
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
  async indexCommunityReports(reports: any[]): Promise<void> {
    if (reports.length === 0) return;

    logger.info(`Indexing ${reports.length} community reports`);

    // Prepare all texts for batch embedding
    const reportTexts: string[] = [];
    const validReports: any[] = [];

    for (const report of reports) {
      const textToEmbed = `${report.title} ${report.summary} ${report.findings.join(" ")}`;
      reportTexts.push(textToEmbed);
      validReports.push(report);
    }

    // Batch embed all reports at once
    logger.info(`Embedding ${reportTexts.length} community reports...`);
    const embeddings = await this.embedder.embedBatch(reportTexts);

    // Prepare data for insertion
    const data: any[] = [];
    for (let i = 0; i < validReports.length; i++) {
      const report = validReports[i];
      const embedding = embeddings[i];

      if (!embedding || embedding.length === 0) {
        logger.warn(
          `Failed to generate embedding for report: ${report.community_id}`,
        );
        continue;
      }

      data.push({
        vector: embedding,
        id: report.community_id,
        level: report.level,
        title: report.title,
        summary: report.summary,
        findings: Array.isArray(report.findings)
          ? report.findings.join("\n")
          : String(report.findings),
        rating: report.rating,
        parent_id: report.parent_id || "",
      });
    }

    if (data.length > 0) {
      logger.info(
        `Adding ${data.length} valid community reports to ConGraphDB`,
      );
      await this.vectorStore.addCommunityReports(data);
    } else {
      logger.warn("No valid community reports to index");
    }
  }
}

// ----------------------------------------------------------------------------
// Factory Functions
// ----------------------------------------------------------------------------

export async function createConGraphVectorStore(): Promise<ConGraphVectorStore> {
  const store = new ConGraphVectorStore();
  await store.initialize();
  return store;
}

export async function createConGraphIndexingPipeline(
  vectorStore: ConGraphVectorStore,
  embedder: IEmbedder,
): Promise<ConGraphIndexingPipeline> {
  return new ConGraphIndexingPipeline(vectorStore, embedder);
}
