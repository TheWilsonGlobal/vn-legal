// ============================================================================
// Jina embedder (jina-embeddings-v3 via the Jina Embedding API)
// ============================================================================
//
// embed(text) is the QUERY path (task retrieval.query). embedArticle,
// embedClause, embedArticleClauses, embedBatch and embedDocuments are the
// DOCUMENT path (task retrieval.passage). Same failure contract as the Gemini
// embedder: no zero vectors, no truncation, no partial results. Any failure
// throws an EmbeddingError whose httpStatus drives the key rotation.

import logger from "../shared/logger";
import type { ArticleNode, ArticleClause } from "../shared/types";
import type { IEmbedder } from "./embedder-factory";
import {
  EmbeddingError,
  Throttle,
  estimateInputTokens,
  parseRetryAfterMs,
} from "./embedder-gemini";
import {
  JINA_DOC_TEMPLATE,
  JINA_QUERY_TEMPLATE,
  renderTemplate,
} from "./index-manifest";

export const JINA_API_URL = "https://api.jina.ai/v1/embeddings";

/** jina-embeddings-v3 input limit, in tokens. */
export const JINA_MAX_INPUT_TOKENS = 8192;

const MAX_RETRIES = 2;
const RETRY_BUDGET_MS = 10_000;
const BASE_BACKOFF_MS = 500;
const REQUEST_TIMEOUT_MS = 30_000;
const DETAIL_MAX_CHARS = 300;

const TASK_PASSAGE = "retrieval.passage";
const TASK_QUERY = "retrieval.query";

/** A non-2xx response from the Jina API. `detail` is redacted and may be undefined. */
class JinaHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;
  readonly detail: string | undefined;

  constructor(status: number, retryAfterMs: number | undefined, detail?: string) {
    super(`HTTP ${status}`);
    this.name = "JinaHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.detail = detail;
  }
}

function sanitizeDetail(text: string, secret: string): string {
  let out = text.replace(/https?:\/\/\S+/g, "[url]");
  if (secret) out = out.split(secret).join("[key]");
  out = out.replace(/\s+/g, " ").trim();
  return out.length > DETAIL_MAX_CHARS
    ? `${out.slice(0, DETAIL_MAX_CHARS)}...`
    : out;
}

/** Jina's message from an error body (`detail` or `error.message`), as one line. */
function jinaErrorDetail(body: string, secret: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  const nested =
    typeof record.error === "object" && record.error !== null
      ? (record.error as Record<string, unknown>).message
      : undefined;
  const message = [record.detail, nested, record.message].find(
    (part): part is string => typeof part === "string" && part.trim() !== "",
  );
  return message === undefined ? undefined : sanitizeDetail(message, secret);
}

/** Connection-level failures only: fetch rejected, or the request timed out. */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    /^fetch failed/i.test(error.message)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateVector(values: unknown, id: string, dim: number): number[] {
  if (!Array.isArray(values)) {
    throw new EmbeddingError(`Jina returned no vector for ${id}`);
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
    throw new EmbeddingError(`Jina returned a zero vector for ${id}`);
  }
  return values as number[];
}

/** Estimate check only; the text is never truncated. See estimateInputTokens. */
function assertWithinLimit(id: string, text: string): void {
  const estimate = estimateInputTokens(text);
  if (estimate > JINA_MAX_INPUT_TOKENS) {
    throw new EmbeddingError(
      `input ${id} is over the ${JINA_MAX_INPUT_TOKENS}-token embedding limit: ` +
        `estimated ${estimate} tokens (an estimate, not a tokenizer count; ` +
        "the text is not truncated)",
    );
  }
}

interface EmbedInput {
  id: string;
  text: string;
}

export interface JinaEmbedderOptions {
  apiKey: string | undefined;
  model: string;
  dim: number;
  batchSize: number;
  maxConcurrency: number;
  /** Test hook for the HTTP call. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Test hook for the retry wait. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

/** One document for embedDocuments. `id` names the input in errors. */
export interface JinaDocument {
  id: string;
  title: string;
  text: string;
}

function documentText(title: string, content: string): string {
  return renderTemplate(JINA_DOC_TEMPLATE, title, content);
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

export class JinaEmbedder implements IEmbedder {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dim: number;
  private readonly batchSize: number;
  private readonly throttle: Throttle;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private usedTokens = 0;
  private ready = false;

  constructor(options: JinaEmbedderOptions) {
    if (!options.apiKey) {
      throw new EmbeddingError(
        "JINA_EMBEDDING_API_KEY is not set (required by EMBEDDING_PROVIDER=jina)",
      );
    }
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.dim = options.dim;
    this.batchSize = options.batchSize;
    this.throttle = new Throttle(options.maxConcurrency);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
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

  /** Total tokens Jina reported as used by this instance (from response usage). */
  tokensUsed(): number {
    return this.usedTokens;
  }

  /** QUERY path. The query is embedded as given. */
  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedInputs(
      [{ id: "query", text: renderTemplate(JINA_QUERY_TEMPLATE, "", text) }],
      TASK_QUERY,
    );
    return vector;
  }

  /** DOCUMENT path: each input is titled "none". Callers pass pre-built text. */
  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.embedInputs(
      texts.map((text, i) => ({
        id: `batch[${i}]`,
        text: documentText("none", text),
      })),
      TASK_PASSAGE,
    );
  }

  /** DOCUMENT path. */
  async embedArticle(article: ArticleNode): Promise<number[]> {
    const [vector] = await this.embedInputs(
      [{ id: article.id, text: documentText(article.title, article.content) }],
      TASK_PASSAGE,
    );
    return vector;
  }

  /** DOCUMENT path. */
  async embedClause(
    article: ArticleNode,
    clause: ArticleClause,
  ): Promise<number[]> {
    const [vector] = await this.embedInputs(
      [clauseInput(article, clause)],
      TASK_PASSAGE,
    );
    return vector;
  }

  /** DOCUMENT path. */
  async embedArticleClauses(article: ArticleNode): Promise<number[][]> {
    return this.embedInputs(
      article.clauses.map((clause) => clauseInput(article, clause)),
      TASK_PASSAGE,
    );
  }

  /**
   * DOCUMENT path for many documents. Each chunk of batchSize inputs is one
   * request. Vectors come back in input order.
   */
  async embedDocuments(documents: JinaDocument[]): Promise<number[][]> {
    return this.embedInputs(
      documents.map((doc) => ({
        id: doc.id,
        text: documentText(doc.title, doc.text),
      })),
      TASK_PASSAGE,
    );
  }

  private async embedInputs(
    inputs: EmbedInput[],
    task: string,
  ): Promise<number[][]> {
    if (!this.ready) {
      throw new EmbeddingError(
        "Jina embedder not initialized. Call initialize() first.",
      );
    }
    if (inputs.length === 0) return [];
    for (const input of inputs) assertWithinLimit(input.id, input.text);

    const chunks: EmbedInput[][] = [];
    for (let i = 0; i < inputs.length; i += this.batchSize) {
      chunks.push(inputs.slice(i, i + this.batchSize));
    }
    const results = await Promise.all(
      chunks.map((chunk) =>
        this.throttle.run(() => this.embedChunk(chunk, task)),
      ),
    );
    return results.flat();
  }

  private async embedChunk(
    chunk: EmbedInput[],
    task: string,
  ): Promise<number[][]> {
    const label = `embeddings for ${chunkLabel(chunk)}`;
    const body = {
      model: this.model,
      task,
      dimensions: this.dim,
      normalized: true,
      embedding_type: "float",
      input: chunk.map((input) => input.text),
    };
    const response = await this.withRetry(label, () => this.post(body));

    const data = Array.isArray(response.data) ? response.data : [];
    if (data.length !== chunk.length) {
      throw new EmbeddingError(
        `Jina returned ${data.length} embeddings for ${chunk.length} inputs`,
      );
    }
    const total = response.usage?.total_tokens;
    if (typeof total === "number") this.usedTokens += total;

    const out: number[][] = new Array(chunk.length);
    data.forEach((item, position) => {
      const index =
        typeof item.index === "number" ? item.index : position;
      if (!Number.isInteger(index) || index < 0 || index >= chunk.length) {
        throw new EmbeddingError(`Jina returned an out-of-range index ${index}`);
      }
      out[index] = validateVector(item.embedding, chunk[index].id, this.dim);
    });
    if (out.some((vector) => vector === undefined)) {
      throw new EmbeddingError(`Jina response is missing inputs for ${label}`);
    }
    return out;
  }

  private async post(body: unknown): Promise<JinaResponse> {
    const response = await this.fetchImpl(JINA_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new JinaHttpError(
        response.status,
        parseRetryAfterMs(response.headers.get("retry-after")),
        jinaErrorDetail(text, this.apiKey),
      );
    }
    return (await response.json()) as JinaResponse;
  }

  /**
   * Bounded retry, the same policy as the Gemini embedder: 429, 503 and
   * connection-level errors retry at most MAX_RETRIES times, honouring
   * Retry-After, within RETRY_BUDGET_MS. Every other error throws at once.
   */
  private async withRetry<T>(label: string, call: () => Promise<T>): Promise<T> {
    const started = Date.now();
    let waitedMs = 0;
    for (let retry = 0; ; retry += 1) {
      let status: number | undefined;
      let kind: string;
      let suffix = "";
      let retryAfter: number | undefined;
      try {
        return await call();
      } catch (error) {
        if (error instanceof JinaHttpError) {
          status = error.status;
          suffix = error.detail === undefined ? "" : `: ${error.detail}`;
          retryAfter = error.retryAfterMs;
          if (status !== 429 && status !== 503) {
            throw new EmbeddingError(
              `Jina ${label} failed with HTTP ${status}${suffix}`,
              status,
            );
          }
          kind = `HTTP ${status}`;
        } else if (isNetworkError(error)) {
          kind = "network error";
        } else {
          throw new EmbeddingError(
            `Jina ${label} failed: ${sanitizeDetail(errorMessage(error), this.apiKey)}`,
          );
        }

        if (retry >= MAX_RETRIES) {
          throw new EmbeddingError(
            `Jina ${label} failed after ${MAX_RETRIES} retries (${kind}${suffix})`,
            status,
          );
        }
        const delayMs =
          retryAfter ??
          Math.round(BASE_BACKOFF_MS * 2 ** retry + Math.random() * 250);
        const overBudget =
          waitedMs + delayMs > RETRY_BUDGET_MS ||
          Date.now() - started + delayMs > RETRY_BUDGET_MS;
        if (overBudget) {
          throw new EmbeddingError(
            `Jina ${label} failed: retry budget of ${RETRY_BUDGET_MS} ms exhausted (${kind}${suffix})`,
            status,
          );
        }
        logger.warn(
          `Jina ${label}: ${kind}, retry ${retry + 1} of ${MAX_RETRIES} in ${delayMs} ms`,
        );
        waitedMs += delayMs;
        await this.sleep(delayMs);
      }
    }
  }
}

interface JinaResponse {
  data?: Array<{ index?: unknown; embedding?: unknown }>;
  usage?: { total_tokens?: unknown };
}

function chunkLabel(chunk: EmbedInput[]): string {
  if (chunk.length === 1) return `input ${chunk[0].id}`;
  return `${chunk.length} inputs (ids ${chunk[0].id} to ${chunk[chunk.length - 1].id})`;
}
