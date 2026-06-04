// ============================================================================
// Embedder Factory - Creates embedder based on configuration
// ============================================================================

import { config } from "../shared/config";
import logger from "../shared/logger";
import { ArticleNode, ArticleClause } from "../shared/types";

// Embedder types
export interface IEmbedder {
  initialize(): Promise<void>;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  embedArticle(article: ArticleNode): Promise<number[]>;
  embedClause(article: ArticleNode, clause: ArticleClause): Promise<number[]>;
  embedArticleClauses(article: ArticleNode): Promise<number[][]>;
  isReady(): boolean;
  getDimension(): number | Promise<number>;
  dispose(): Promise<void>;
}

let embedderInstance: IEmbedder | null = null;

/**
 * Get or create embedder instance based on configuration
 */
export async function getEmbedder(): Promise<IEmbedder> {
  if (embedderInstance) {
    return embedderInstance;
  }

  logger.info(`Creating embedder backend: ${config.embeddingBackend}`);

  if (config.embeddingBackend === "api") {
    // Use high-performance Python API (ONNX)
    const { ApiEmbedder } = await import("./embedder-api.js");
    const apiUrl = config.embeddingApiUrl;
    embedderInstance = new ApiEmbedder(apiUrl);
  } else if (config.embeddingBackend === "llamacpp") {
    // Use Llama.cpp API (GGUF)
    const { LlamaCppEmbedder } = await import("./embedder-llamacpp.js");
    const apiUrl = config.embeddingApiUrl;
    embedderInstance = new LlamaCppEmbedder(apiUrl);
  } else {
    // Use WebAssembly transformers (default, slower)
    const { Embedder } = await import("./embedder.js");
    embedderInstance = new Embedder() as IEmbedder;
  }

  await embedderInstance.initialize();
  return embedderInstance;
}

/**
 * Reset embedder instance
 */
export function resetEmbedder(): void {
  if (embedderInstance) {
    embedderInstance.dispose();
    embedderInstance = null;
  }
}

/**
 * Get current embedder type
 */
export function getEmbedderType(): string {
  return config.embeddingBackend;
}
