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

/**
 * A 429 or 503 response, raised by the fetch wrapper so Retry-After survives.
 * `detail` is Google's status and message, already redacted; it is undefined
 * when the body had none.
 */
export class RetryableHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;
  readonly detail: string | undefined;

  constructor(
    status: number,
    retryAfterMs: number | undefined,
    detail?: string,
  ) {
    super(`HTTP ${status}`);
    this.name = "RetryableHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.detail = detail;
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

const DETAIL_MAX_CHARS = 300;

/**
 * Google's status and message from an error body, as one line for the thrown
 * error. The key and any URL are redacted; headers are never read into it.
 * Returns undefined when the body is not JSON with an error object.
 */
function googleErrorDetail(
  body: string,
  secret: string | undefined,
): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  const error = errorField(parsed, "error");
  const parts = [errorField(error, "status"), errorField(error, "message")]
    .filter((part): part is string => typeof part === "string")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return undefined;
  return sanitizeDetail(parts.join(": "), secret);
}

function sanitizeDetail(text: string, secret: string | undefined): string {
  let out = text.replace(/https?:\/\/\S+/g, "[url]");
  if (secret) out = out.split(secret).join("[key]");
  out = out.replace(/\s+/g, " ").trim();
  return out.length > DETAIL_MAX_CHARS
    ? `${out.slice(0, DETAIL_MAX_CHARS)}...`
    : out;
}

function errorField(value: unknown, field: string): unknown {
  if (typeof value !== "object" || value === null || !(field in value)) {
    return undefined;
  }
  return (value as Record<string, unknown>)[field];
}

/**
 * Wraps fetch so a 429 or 503 surfaces as RetryableHttpError with its
 * Retry-After and Google's message. The SDK's ApiError carries only the status,
 * so without this the header and the message are lost. Other responses pass
 * through unchanged. If the body cannot be read, only the message is lost; the
 * status still drives the retry.
 */
export function makeRetryAwareFetch(
  apiKey?: string,
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const response = await globalThis.fetch(input, init);
    if (response.status === 429 || response.status === 503) {
      const body = await response.text().catch(() => "");
      throw new RetryableHttpError(
        response.status,
        parseRetryAfterMs(response.headers.get("retry-after")),
        googleErrorDetail(body, apiKey),
      );
    }
    return response;
  };
}

/**
 * Conservative token estimate for the input limit. An exact count needs
 * countTokens, which is a live call this embedder never makes, so the limit is
 * checked against this estimate instead: one token per character, and four per
 * character outside the Basic Multilingual Plane (a tokenizer may split those
 * into their four UTF-8 bytes). It is an estimate, not a tokenizer count. The
 * estimate is high for Vietnamese: RB1's measured count for the real corpus is
 * about 0.3 tokens per character.
 */
export function estimateInputTokens(text: string): number {
  let tokens = 0;
  for (const character of text) {
    tokens += (character.codePointAt(0) ?? 0) > 0xffff ? 4 : 1;
  }
  return tokens;
}

function assertWithinLimit(id: string, text: string): void {
  const estimate = estimateInputTokens(text);
  if (estimate > GEMINI_MAX_INPUT_TOKENS) {
    throw new EmbeddingError(
      `input ${id} is over the ${GEMINI_MAX_INPUT_TOKENS}-token embedding limit: ` +
        `estimated ${estimate} tokens (an estimate, not a tokenizer count; ` +
        "the text is not truncated)",
    );
  }
}

function upstreamStatus(error: unknown): number | undefined {
  if (error instanceof RetryableHttpError) return error.status;
  const status = errorField(error, "status");
  return typeof status === "number" ? status : undefined;
}

/** Google's message for a failed call, from the wrapper or from an SDK ApiError body. */
function upstreamDetail(error: unknown, secret: string): string | undefined {
  if (error instanceof RetryableHttpError) return error.detail;
  if (error instanceof Error) return googleErrorDetail(error.message, secret);
  return undefined;
}

const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/**
 * Connection-level failures only: fetch rejected, a timeout or abort, or a
 * socket error. Anything else is not a network error and is not retried.
 */
function isNetworkError(error: unknown): boolean {
  const name = errorField(error, "name");
  if (name === "AbortError" || name === "TimeoutError") return true;
  const message = errorField(error, "message");
  if (typeof message === "string" && /^fetch failed/i.test(message)) {
    return true;
  }
  const code =
    errorField(error, "code") ?? errorField(errorField(error, "cause"), "code");
  return typeof code === "string" && NETWORK_ERROR_CODES.has(code);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Names the input, or the first and last id of a batch, in an error. */
function chunkLabel(chunk: EmbedInput[]): string {
  if (chunk.length === 1) return `input ${chunk[0].id}`;
  return `${chunk.length} inputs (ids ${chunk[0].id} to ${chunk[chunk.length - 1].id})`;
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

/** One document for embedDocuments. `id` names the input in errors. */
export interface GeminiDocument {
  id: string;
  title: string;
  text: string;
}

export class GeminiEmbedder implements IEmbedder {
  private readonly ai: GoogleGenAI;
  private readonly secret: string;
  private readonly model: string;
  private readonly dim: number;
  private readonly batchSize: number;
  private readonly throttle: Throttle;
  private readonly sleep: (ms: number) => Promise<void>;
  private ready = false;

  constructor(options: GeminiEmbedderOptions) {
    const apiKey = options.apiKey;
    if (!apiKey) {
      throw new EmbeddingError(
        "GEMINI_EMBEDDING_API_KEY is not set (required by EMBEDDING_PROVIDER=gemini)",
      );
    }
    this.secret = apiKey;
    this.ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        fetch: makeRetryAwareFetch(apiKey),
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

  /**
   * DOCUMENT path for many documents. Each chunk of batchSize inputs is one
   * request, and each input is its own Content, so n documents cost
   * ceil(n / batchSize) requests. Vectors come back in input order.
   */
  async embedDocuments(documents: GeminiDocument[]): Promise<number[][]> {
    return this.embedInputs(
      documents.map((doc) => ({
        id: doc.id,
        text: documentText(doc.title, doc.text),
      })),
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
      `embedContent for ${chunkLabel(chunk)}`,
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
   * connection-level errors (see isNetworkError) retry at most MAX_RETRIES
   * times, honouring Retry-After, within RETRY_BUDGET_MS. Every other error
   * throws at once. Each thrown error carries Google's message when there is one.
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
        const detail = upstreamDetail(error, this.secret);
        const suffix = detail === undefined ? "" : `: ${detail}`;
        if (status !== undefined && status !== 429 && status !== 503) {
          throw new EmbeddingError(
            `Gemini ${label} failed with HTTP ${status}${suffix}`,
            status,
          );
        }
        if (status === undefined && !isNetworkError(error)) {
          throw new EmbeddingError(
            `Gemini ${label} failed: ${sanitizeDetail(errorMessage(error), this.secret)}`,
          );
        }
        const kind = status === undefined ? "network error" : `HTTP ${status}`;
        if (retry >= MAX_RETRIES) {
          throw new EmbeddingError(
            `Gemini ${label} failed after ${MAX_RETRIES} retries (${kind}${suffix})`,
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
            `Gemini ${label} failed: retry budget of ${RETRY_BUDGET_MS} ms exhausted (${kind}${suffix})`,
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
