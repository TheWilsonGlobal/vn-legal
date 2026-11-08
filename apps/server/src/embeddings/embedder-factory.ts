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

/**
 * Document embedding (plan r5 R10-03). Gemini separates documents from queries with a
 * title prefix; embedDocuments applies it. Embedders without it (legacy transformers)
 * return null, and callers keep their original input strings unchanged.
 */
export interface DocumentEmbedder {
  embedDocuments(
    docs: { id: string; title: string; text: string }[],
  ): Promise<number[][]>;
}

export function documentEmbedderOf(
  embedder: IEmbedder,
): DocumentEmbedder | null {
  const candidate = embedder as Partial<DocumentEmbedder>;
  return typeof candidate.embedDocuments === "function"
    ? (embedder as unknown as DocumentEmbedder)
    : null;
}

let embedderInstance: IEmbedder | null = null;

/**
 * Get or create embedder instance based on configuration
 */
export async function getEmbedder(): Promise<IEmbedder> {
  if (embedderInstance) {
    return embedderInstance;
  }

  const provider = config.embedding.provider;
  if (provider === "gemini") {
    // Server path: gemini-embedding-2 through the Gemini API (plan §5.9).
    const apiKey = config.embedding.apiKey;
    if (!apiKey) {
      throw new Error(
        "GEMINI_EMBEDDING_API_KEY is not set (required by EMBEDDING_PROVIDER=gemini)",
      );
    }
    const model = config.embedding.model;
    if (!model) {
      throw new Error(
        "EMBEDDING_MODEL is not set (required by EMBEDDING_PROVIDER=gemini)",
      );
    }
    logger.info(
      `Creating embedder provider: gemini (${model}, ${config.embedding.dim}-d)`,
    );
    const { GeminiEmbedder } = await import("./embedder-gemini.js");
    embedderInstance = new GeminiEmbedder({
      apiKey,
      model,
      dim: config.embedding.dim,
      batchSize: config.embedding.batchSize,
      maxConcurrency: config.embedding.maxConcurrency,
    });
    await embedderInstance.initialize();
    return embedderInstance;
  }
  if (provider === "transformers") {
    // Documented rollback only (plan §8 item 5): the legacy 384-d transformers embedder.
    logger.info("Creating embedder provider: transformers (rollback, 384-d)");
    const { Embedder } = await import("./embedder.js");
    embedderInstance = new Embedder() as IEmbedder;
    await embedderInstance.initialize();
    return embedderInstance;
  }
  if (provider !== undefined) {
    throw new Error(
      'EMBEDDING_PROVIDER must be "gemini" or "transformers"; it is not a supported value',
    );
  }

  // Provider unset: the legacy EMBEDDING_BACKEND switch, for legacy scripts only.
  // The server never reaches it: assertServerEmbeddingConfig refuses an unset provider.
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
 * Get current embedder type: the EMBEDDING_PROVIDER value when it is set, so
 * "gemini" under the Gemini provider. Only when the provider is unset does it
 * report the legacy EMBEDDING_BACKEND switch.
 */
export function getEmbedderType(): string {
  return config.embedding.provider ?? config.embeddingBackend;
}
