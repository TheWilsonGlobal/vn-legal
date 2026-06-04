// ============================================================================
// Llama.cpp API Embedder (GGUF Backend)
// ============================================================================

import { config } from "../shared/config";
import logger from "../shared/logger";
import type { ArticleNode, ArticleClause } from "../shared/types";
import type { IEmbedder } from "./embedder-factory";

export class LlamaCppEmbedder implements IEmbedder {
  private isInitialized = false;
  private apiUrl: string;

  constructor(apiUrl: string = "http://127.0.0.1:3018") {
    this.apiUrl = apiUrl;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      logger.info(`Initializing Llama.cpp embedder: ${this.apiUrl}`);

      // Basic health check
      const response = await fetch(`${this.apiUrl}/health`);
      if (!response.ok) {
        throw new Error(
          `Llama.cpp health check failed: ${response.statusText}`,
        );
      }

      this.isInitialized = true;
      logger.info("Llama.cpp Embedder connected successfully");
    } catch (error) {
      logger.error("Failed to connect to Llama.cpp API", error);
      throw new Error(
        `Cannot connect to Llama.cpp at ${this.apiUrl}. Ensure llama-server is running.`,
      );
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!this.isInitialized) throw new Error("Embedder not initialized");

    try {
      // Proactively truncate to stay within ~512 token limits (approx 2000 chars for Vietnamese)
      const safeText = text.length > 2000 ? text.substring(0, 2000) : text;
      const textSnippet = safeText.substring(0, 50).replace(/\n/g, " ");

      if (text.length > 2000) {
        logger.warn(
          `Text truncated for embedding (Original: ${text.length}, Truncated: 2000)`,
        );
      }

      const response = await fetch(`${this.apiUrl}/embedding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: safeText }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          `Llama.cpp request failed for text: "${textSnippet}..." (Length: ${safeText.length})`,
        );
        logger.error(`Server response: ${errorText}`);
        throw new Error(
          `Llama.cpp request failed: ${response.statusText} (${response.status})`,
        );
      }

      const data = (await response.json()) as
        | Record<string, unknown>
        | unknown[];

      let embedding: number[] | undefined;

      if (Array.isArray(data)) {
        // If data is [{ embedding: [...] }] or [{ embedding: [[...]] }]
        const first = data[0] as Record<string, unknown> | number | undefined;
        if (
          first &&
          typeof first === "object" &&
          Array.isArray(first.embedding)
        ) {
          embedding = Array.isArray(first.embedding[0])
            ? first.embedding[0]
            : first.embedding;
        } else if (typeof first === "number") {
          embedding = data as number[];
        }
      } else if (data && typeof data === "object" && !Array.isArray(data)) {
        const d = data as Record<string, unknown>;
        if (Array.isArray(d.embedding)) {
          // Handle nested array format [[...]]
          if (Array.isArray(d.embedding[0])) {
            embedding = d.embedding[0];
          } else {
            embedding = d.embedding as number[];
          }
        } else if (d.results && Array.isArray(d.results)) {
          const results = d.results as Record<string, unknown>[];
          if (Array.isArray(results[0]?.embedding)) {
            embedding = results[0].embedding as number[];
          }
        }
      }

      if (!embedding) {
        logger.error(
          "Llama.cpp response malformed or missing embedding:",
          JSON.stringify(data),
        );
        throw new Error("Invalid embedding response from Llama.cpp");
      }

      const cleaned = this.validateVector(embedding, "llama-cpp-embed");
      return this.normalize(cleaned);
    } catch (error) {
      logger.error("Failed to generate Llama.cpp embedding", error);
      throw error;
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    const concurrencyLimit = 10; // Process 10 at a time to avoid overloading llama-server

    for (let i = 0; i < texts.length; i += concurrencyLimit) {
      const chunk = texts.slice(i, i + concurrencyLimit);
      const chunkResults = await Promise.all(
        chunk.map(async (text) => {
          try {
            return await this.embed(text);
          } catch (err) {
            logger.error(
              `Failed to embed individual text in batch, using zero vector: ${err}`,
            );
            // Return a zero vector of standard dimension (384 for MiniLM)
            return new Array(384).fill(0);
          }
        }),
      );
      results.push(...chunkResults);
    }

    return results;
  }

  private validateVector(v: unknown[], context: string): number[] {
    const result: number[] = [];

    for (let i = 0; i < v.length; i++) {
      let val = v[i];

      // If it's an object, try to find a numeric value inside it
      if (typeof val === "object" && val !== null) {
        if (i === 0)
          logger.warn(
            `Detected object in vector at index 0: ${JSON.stringify(val)}`,
          );
        // Common fields in some JSON formats
        const obj = val as Record<string, unknown>;
        val = (obj.value ?? obj.v ?? obj.embedding ?? NaN) as number;
      }

      const num = Number(val);
      if (isNaN(num) || !isFinite(num)) {
        if (i < 5)
          logger.error(
            `Invalid number at index ${i} (${context}): ${typeof v[i] === "object" ? JSON.stringify(v[i]) : v[i]}`,
          );
        result.push(0);
      } else {
        result.push(num);
      }
    }
    return result;
  }

  private normalize(v: number[]): number[] {
    const sumSq = v.reduce((sum, val) => sum + val * val, 0);
    const norm = Math.sqrt(sumSq);

    if (norm < 1e-12 || isNaN(norm)) {
      logger.warn(
        `Extremely small or NaN norm (${norm}) detected, returning zero-safe vector`,
      );
      return v.length > 0 ? v : new Array(384).fill(0);
    }

    return v.map((val) => val / norm);
  }

  async embedArticle(article: ArticleNode): Promise<number[]> {
    return this.embed(`${article.title} ${article.content}`);
  }

  async embedClause(
    article: ArticleNode,
    clause: ArticleClause,
  ): Promise<number[]> {
    return this.embed(
      `${article.title} - Khoản ${clause.clause_number}: ${clause.text}`,
    );
  }

  async embedArticleClauses(article: ArticleNode): Promise<number[][]> {
    const texts = article.clauses.map(
      (c) => `${article.title} - Khoản ${c.clause_number}: ${c.text}`,
    );
    return this.embedBatch(texts);
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  async getDimension(): Promise<number> {
    // MiniLM-L12-v2 is always 384
    return config.embeddingDimension || 384;
  }

  async dispose(): Promise<void> {
    this.isInitialized = false;
  }
}
