// ============================================================================
// Embedder Factory - Creates embedder based on configuration
// ============================================================================

import { config } from "../shared/config";
import logger from "../shared/logger";
import { ArticleNode, ArticleClause } from "../shared/types";
import { withKeyRotation } from "./key-rotation";

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
  /** Cumulative tokens Jina reported as used; absent for Gemini. The build checks it against the budget. */
  tokensUsed?(): number;
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
  if (provider === "gemini" || provider === "jina") {
    // Server path: gemini-embedding-2 through the Gemini API (plan §5.9), or
    // jina-embeddings-v3 through the Jina Embedding API.
    const keyName =
      provider === "jina" ? "JINA_EMBEDDING_API_KEY" : "GEMINI_EMBEDDING_API_KEY";
    const apiKey = config.embedding.apiKey;
    if (!apiKey) {
      throw new Error(
        `${keyName} is not set (required by EMBEDDING_PROVIDER=${provider})`,
      );
    }
    const model = config.embedding.model;
    if (!model) {
      throw new Error(
        `EMBEDDING_MODEL is not set (required by EMBEDDING_PROVIDER=${provider})`,
      );
    }
    logger.info(
      `Creating embedder provider: ${provider} (${model}, ${config.embedding.dim}-d)`,
    );
    const build = async (key: string): Promise<IEmbedder> => {
      const options = {
        apiKey: key,
        model,
        dim: config.embedding.dim,
        batchSize: config.embedding.batchSize,
        maxConcurrency: config.embedding.maxConcurrency,
      };
      const alt: IEmbedder =
        provider === "jina"
          ? new (await import("./embedder-jina.js")).JinaEmbedder(options)
          : new (await import("./embedder-gemini.js")).GeminiEmbedder(options);
      await alt.initialize();
      return alt;
    };
    embedderInstance = await build(apiKey);
    const fallbackKeys = config.embedding.fallbackApiKeys ?? [];
    if (fallbackKeys.length > 0) {
      // Same model and dimension, other keys: only quota errors rotate (key-rotation.ts).
      const fallbacks: IEmbedder[] = [];
      for (const key of fallbackKeys) {
        fallbacks.push(await build(key));
      }
      embedderInstance = withKeyRotation(embedderInstance, fallbacks) as IEmbedder;
      logger.info(`${provider} embedding key rotation enabled: ${fallbackKeys.length} fallback key(s)`);
    }
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
      'EMBEDDING_PROVIDER must be "gemini", "jina" or "transformers"; it is not a supported value',
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
