// ============================================================================
// HTTP API Embedder (High-Performance Python Backend)
// ============================================================================

import { config } from "../shared/config";
import logger from "../shared/logger";
import type { ArticleNode, ArticleClause } from "../shared/types";
import type { IEmbedder } from "./embedder-factory";

// API Response types
interface EmbedResponse {
  embeddings: number[][];
}

interface HealthResponse {
  status: string;
  model: string;
  dimension: number;
}

// ----------------------------------------------------------------------------
// API Embedder Class
// ----------------------------------------------------------------------------

export class ApiEmbedder implements IEmbedder {
  private isInitialized = false;
  private apiUrl: string;

  constructor(apiUrl: string = "http://127.0.0.1:8765") {
    this.apiUrl = apiUrl;
  }

  /**
   * Initialize the embedder (check API health)
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      logger.info(`Initializing API embedder: ${this.apiUrl}`);

      const response = await fetch(`${this.apiUrl}/health`);
      if (!response.ok) {
        throw new Error(`API health check failed: ${response.statusText}`);
      }

      const health = (await response.json()) as HealthResponse;
      logger.info(
        `API Embedder connected: ${health.model} (dimension: ${health.dimension})`,
      );

      this.isInitialized = true;
    } catch (error) {
      logger.error("Failed to connect to embedding API", error);
      throw new Error(
        "Cannot connect to embedding API. Make sure the Python service is running:\n" +
          "  cd embedding-service && pip install -r requirements.txt && python main.py",
        { cause: error },
      );
    }
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    if (!this.isInitialized) {
      throw new Error("Embedder not initialized. Call initialize() first.");
    }

    try {
      const response = await fetch(`${this.apiUrl}/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: [text] }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      const data = (await response.json()) as EmbedResponse;
      return data.embeddings[0];
    } catch (error) {
      logger.error("Failed to generate embedding", error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   * This is where the API embedder shines - processes all texts in parallel
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.isInitialized) {
      throw new Error("Embedder not initialized. Call initialize() first.");
    }

    if (texts.length === 0) return [];

    try {
      const response = await fetch(`${this.apiUrl}/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      const data = (await response.json()) as EmbedResponse;
      return data.embeddings;
    } catch (error) {
      logger.error(
        `Failed to generate batch embeddings for ${texts.length} texts`,
        error,
      );
      throw error;
    }
  }

  /**
   * Generate embedding for an article (title + content)
   */
  async embedArticle(article: ArticleNode): Promise<number[]> {
    const text = `${article.title} ${article.content}`;
    return await this.embed(text);
  }

  /**
   * Generate embedding for a clause (article title + clause text)
   */
  async embedClause(
    article: ArticleNode,
    clause: ArticleClause,
  ): Promise<number[]> {
    const text = `${article.title} - Khoản ${clause.clause_number}: ${clause.text}`;
    return await this.embed(text);
  }

  /**
   * Generate embeddings for all clauses in an article
   */
  async embedArticleClauses(article: ArticleNode): Promise<number[][]> {
    const texts = article.clauses.map(
      (clause) =>
        `${article.title} - Khoản ${clause.clause_number}: ${clause.text}`,
    );
    return await this.embedBatch(texts);
  }

  /**
   * Check if the embedder is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Get the embedding dimension
   */
  async getDimension(): Promise<number> {
    const response = await fetch(`${this.apiUrl}/health`);
    const health = (await response.json()) as HealthResponse;
    return health.dimension;
  }

  /**
   * Clean up resources (no-op for API embedder)
   */
  async dispose(): Promise<void> {
    this.isInitialized = false;
    logger.info("API Embedder disconnected");
  }
}

// ----------------------------------------------------------------------------
// Singleton Instance
// ----------------------------------------------------------------------------

let embedderInstance: ApiEmbedder | null = null;

export async function getEmbedder(): Promise<ApiEmbedder> {
  if (!embedderInstance) {
    const apiUrl = config.embeddingApiUrl || "http://127.0.0.1:8765";
    embedderInstance = new ApiEmbedder(apiUrl);
    await embedderInstance.initialize();
  }
  return embedderInstance;
}

export function resetEmbedder(): void {
  if (embedderInstance) {
    embedderInstance.dispose();
    embedderInstance = null;
  }
}
