// ============================================================================
// Gemini Embedder (gemini-embedding-2 via @google/genai)
// ============================================================================
//
// embed(text) is the QUERY path. embedArticle, embedClause,
// embedArticleClauses and embedBatch are the DOCUMENT path (plan §5.9, A22).
// No zero vectors, no truncation, no partial results: any failure throws an
// EmbeddingError.

import { GoogleGenAI } from "@google/genai";
import logger from "../shared/logger";
import type { ArticleNode, ArticleClause } from "../shared/types";
import type { IEmbedder } from "./embedder-factory";

/** Gemini embedding input limit, in tokens. */
export const GEMINI_MAX_INPUT_TOKENS = 8192;

const MAX_RETRIES = 2;
const RETRY_BUDGET_MS = 10_000;
const BASE_BACKOFF_MS = 500;
const REQUEST_TIMEOUT_MS = 30_000;

/** Any embedding failure. The runner maps it to error code embedding_error. */
export class EmbeddingError extends Error {
  readonly httpStatus: number | undefined;

  constructor(message: string, httpStatus?: number) {
    super(message);
    this.name = "EmbeddingError";
    this.httpStatus = httpStatus;
  }
}

/** A 429 or 503 response, raised by the fetch wrapper so Retry-After survives. */
export class RetryableHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;

  constructor(status: number, retryAfterMs: number | undefined) {
    super(`HTTP ${status}`);
    this.name = "RetryableHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Retry-After as delta-seconds or an HTTP date, in milliseconds. */
export function parseRetryAfterMs(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  return undefined;
}

/**
 * Wraps fetch so a 429 or 503 surfaces as RetryableHttpError with its
 * Retry-After. The SDK's ApiError carries only the status, so without this the
 * header is lost. Other responses pass through unchanged.
 */
export function makeRetryAwareFetch(): (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response> {
  return async (input, init) => {
    const response = await globalThis.fetch(input, init);
    if (response.status === 429 || response.status === 503) {
      await response.body?.cancel();
      throw new RetryableHttpError(
        response.status,
        parseRetryAfterMs(response.headers.get("retry-after")),
      );
    }
    return response;
  };
}

/** A UTF-8 byte count above the token limit cannot be ruled out, so it is refused. */
function assertWithinLimit(id: string, text: string): void {
  const bytes = Buffer.byteLength(text, "utf-8");
  if (bytes > GEMINI_MAX_INPUT_TOKENS) {
    throw new EmbeddingError(
      `input ${id} is over the ${GEMINI_MAX_INPUT_TOKENS}-token embedding limit ` +
        `(${bytes} UTF-8 bytes; the text is not truncated)`,
    );
  }
}

function upstreamStatus(error: unknown): number | undefined {
  if (error instanceof RetryableHttpError) return error.status;
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

function validateVector(values: unknown, id: string, dim: number): number[] {
  if (!Array.isArray(values)) {
    throw new EmbeddingError(`Gemini returned no vector for ${id}`);
  }
  if (values.length !== dim) {
    throw new EmbeddingError(
      `vector for ${id} has length ${values.length}, expected ${dim}`,
    );
  }
  let sumSquares = 0;
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new EmbeddingError(`vector for ${id} contains a non-finite value`);
    }
    sumSquares += v * v;
  }
  if (sumSquares === 0) {
    throw new EmbeddingError(`Gemini returned a zero vector for ${id}`);
  }
  return values as number[];
}

class Throttle {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.max) {
      this.active += 1;
    } else {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}

interface EmbedInput {
  id: string;
  text: string;
}

export interface GeminiEmbedderOptions {
  apiKey: string | undefined;
  model: string;
  dim: number;
  batchSize: number;
  maxConcurrency: number;
  /** Test hook for the retry wait. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

export class GeminiEmbedder implements IEmbedder {
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly dim: number;
  private readonly batchSize: number;
  private readonly throttle: Throttle;
  private readonly sleep: (ms: number) => Promise<void>;
  private ready = false;

  constructor(options: GeminiEmbedderOptions) {
    if (!options.apiKey) {
      throw new EmbeddingError(
        "GEMINI_EMBEDDING_API_KEY is not set (required by EMBEDDING_PROVIDER=gemini)",
      );
    }
    this.ai = new GoogleGenAI({
      apiKey: options.apiKey,
      httpOptions: {
        fetch: makeRetryAwareFetch(),
        timeout: REQUEST_TIMEOUT_MS,
      },
    });
    this.model = options.model;
    this.dim = options.dim;
    this.batchSize = options.batchSize;
    this.throttle = new Throttle(options.maxConcurrency);
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async initialize(): Promise<void> {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  getDimension(): number {
    return this.dim;
  }

  async dispose(): Promise<void> {
    this.ready = false;
  }

  /** QUERY path. */
  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedInputs([
      { id: "query", text: queryText(text) },
    ]);
    return vector;
  }

  /** DOCUMENT path: each input is titled "none". Callers pass pre-built text. */
  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.embedInputs(
      texts.map((text, i) => ({
        id: `batch[${i}]`,
        text: documentText("none", text),
      })),
    );
  }

  /** DOCUMENT path. */
  async embedArticle(article: ArticleNode): Promise<number[]> {
    const [vector] = await this.embedInputs([
      {
        id: article.id,
        text: documentText(article.title, article.content),
      },
    ]);
    return vector;
  }

  /** DOCUMENT path. */
  async embedClause(
    article: ArticleNode,
    clause: ArticleClause,
  ): Promise<number[]> {
    const [vector] = await this.embedInputs([clauseInput(article, clause)]);
    return vector;
  }

  /** DOCUMENT path. */
  async embedArticleClauses(article: ArticleNode): Promise<number[][]> {
    return this.embedInputs(
      article.clauses.map((clause) => clauseInput(article, clause)),
    );
  }

  private assertReady(): void {
    if (!this.ready) {
      throw new EmbeddingError(
        "Gemini embedder not initialized. Call initialize() first.",
      );
    }
  }

  private async embedInputs(inputs: EmbedInput[]): Promise<number[][]> {
    this.assertReady();
    if (inputs.length === 0) return [];
    for (const input of inputs) assertWithinLimit(input.id, input.text);

    const chunks: EmbedInput[][] = [];
    for (let i = 0; i < inputs.length; i += this.batchSize) {
      chunks.push(inputs.slice(i, i + this.batchSize));
    }
    const results = await Promise.all(
      chunks.map((chunk) => this.throttle.run(() => this.embedChunk(chunk))),
    );
    return results.flat();
  }

  private async embedChunk(chunk: EmbedInput[]): Promise<number[][]> {
    const response = await this.withRetry(
      `embedContent(${chunk.length} inputs)`,
      () =>
        this.ai.models.embedContent({
          model: this.model,
          // One Content per input: a shared Content would return one aggregated vector.
          contents: chunk.map((input) => ({ parts: [{ text: input.text }] })),
          config: { outputDimensionality: this.dim },
        }),
    );
    const embeddings = response.embeddings ?? [];
    if (embeddings.length !== chunk.length) {
      throw new EmbeddingError(
        `Gemini returned ${embeddings.length} embeddings for ${chunk.length} inputs`,
      );
    }
    return embeddings.map((e, i) =>
      validateVector(e.values, chunk[i].id, this.dim),
    );
  }

  /**
   * Bounded retry, the same policy as the chat model (plan §5.3): 429, 503 and
   * network errors retry at most MAX_RETRIES times, honouring Retry-After,
   * within RETRY_BUDGET_MS. Every other status throws at once.
   */
  private async withRetry<T>(
    label: string,
    call: () => Promise<T>,
  ): Promise<T> {
    const started = Date.now();
    let waitedMs = 0;
    for (let retry = 0; ; retry += 1) {
      try {
        return await call();
      } catch (error) {
        const status = upstreamStatus(error);
        if (status !== undefined && status !== 429 && status !== 503) {
          throw new EmbeddingError(
            `Gemini ${label} failed with HTTP ${status}`,
            status,
          );
        }
        const kind = status === undefined ? "network error" : `HTTP ${status}`;
        if (retry >= MAX_RETRIES) {
          throw new EmbeddingError(
            `Gemini ${label} failed after ${MAX_RETRIES} retries (${kind})`,
            status,
          );
        }
        const retryAfter =
          error instanceof RetryableHttpError ? error.retryAfterMs : undefined;
        const delayMs =
          retryAfter ??
          Math.round(BASE_BACKOFF_MS * 2 ** retry + Math.random() * 250);
        const overBudget =
          waitedMs + delayMs > RETRY_BUDGET_MS ||
          Date.now() - started + delayMs > RETRY_BUDGET_MS;
        if (overBudget) {
          throw new EmbeddingError(
            `Gemini ${label} failed: retry budget of ${RETRY_BUDGET_MS} ms exhausted (${kind})`,
            status,
          );
        }
        logger.warn(
          `Gemini ${label}: ${kind}, retry ${retry + 1} of ${MAX_RETRIES} in ${delayMs} ms`,
        );
        waitedMs += delayMs;
        await this.sleep(delayMs);
      }
    }
  }
}

// Literal templates, not String.replace: a title or text containing "$&" or
// "{content}" must reach the model unchanged. The formats match the constants
// in index-manifest.ts, which the manifest stores and the boot check compares.
function documentText(title: string, content: string): string {
  return `title: ${title} | text: ${content}`;
}

function queryText(query: string): string {
  return `task: search result | query: ${query}`;
}

function clauseInput(article: ArticleNode, clause: ArticleClause): EmbedInput {
  return {
    id: clause.id,
    text: documentText(
      article.title,
      `Khoản ${clause.clause_number}: ${clause.text}`,
    ),
  };
}
