// ============================================================================
// @xenova/transformers Embedder Wrapper
// ============================================================================

import {
  pipeline,
  env,
  type FeatureExtractionPipeline,
} from "@xenova/transformers";
import { config } from "../shared/config";
import logger from "../shared/logger";
import type { ArticleNode, ArticleClause } from "../shared/types";
import { existsSync } from "fs";
import { resolve } from "path";

// Configure transformers.js for local use with native ONNX runtime
env.allowLocalModels = true;
env.useBrowserCache = false;

// Check if onnxruntime-node is installed by looking for the package
const onnxNodePath = resolve(process.cwd(), "node_modules/onnxruntime-node");
const hasOnnxRuntimeNode = existsSync(onnxNodePath);

if (hasOnnxRuntimeNode) {
  // Configure to use native ONNX runtime backend
  env.backends.onnx.executionTarget = "node";
  logger.info(
    "ONNX Runtime Node detected - configuring for native CPU acceleration",
  );
} else {
  logger.info("ONNX Runtime Node not found - will use WASM fallback (slower)");
}

// ----------------------------------------------------------------------------
// Embedder Class
// ----------------------------------------------------------------------------

export class Embedder {
  private pipeline: FeatureExtractionPipeline | null = null;
  private isInitialized = false;

  /**
   * Initialize the embedding pipeline
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      logger.info(`Initializing embedding model: ${config.embeddingModel}`);

      this.pipeline = await pipeline(
        "feature-extraction",
        config.embeddingModel,
        {
          quantized: true,
          progress_callback: (progress: {
            status: string;
            progress: number;
          }) => {
            if (progress.status === "downloading") {
              logger.debug(`Downloading model: ${progress.progress}%`);
            } else if (progress.status === "loading") {
              logger.debug(`Loading model: ${progress.progress}%`);
            }
          },
        },
      );

      this.isInitialized = true;
      logger.info("Embedding model initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize embedding model", error);
      throw error;
    }
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    if (!this.isInitialized || !this.pipeline) {
      throw new Error("Embedder not initialized. Call initialize() first.");
    }

    try {
      const output = await this.pipeline(text, {
        pooling: "mean",
        normalize: true,
      });

      return Array.from(output.data);
    } catch (error) {
      logger.error("Failed to generate embedding", error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.isInitialized || !this.pipeline) {
      throw new Error("Embedder not initialized. Call initialize() first.");
    }

    if (texts.length === 0) return [];

    try {
      // Process the entire batch in parallel using the pipeline
      const output = await this.pipeline(texts, {
        pooling: "mean",
        normalize: true,
      });

      // output is a Tensor. For multiple inputs, we need to extract rows.
      // The output data is a flat Float32Array. We need to split it.
      const dimension = this.getDimension();
      const results: number[][] = [];

      for (let i = 0; i < texts.length; i++) {
        const start = i * dimension;
        const end = start + dimension;
        // Use slice instead of subarray for compatibility with all DataArray types
        const slice = (output.data as Float32Array).slice(start, end);
        results.push(Array.from(slice));
      }

      return results;
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
    return this.isInitialized && this.pipeline !== null;
  }

  /**
   * Get the embedding dimension
   */
  getDimension(): number {
    return config.embeddingDimension;
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    if (this.pipeline) {
      await this.pipeline.dispose();
      this.pipeline = null;
      this.isInitialized = false;
      logger.info("Embedder disposed");
    }
  }
}

// ----------------------------------------------------------------------------
// Singleton Instance
// ----------------------------------------------------------------------------

let embedderInstance: Embedder | null = null;

export async function getEmbedder(): Promise<Embedder> {
  if (!embedderInstance) {
    embedderInstance = new Embedder();
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
