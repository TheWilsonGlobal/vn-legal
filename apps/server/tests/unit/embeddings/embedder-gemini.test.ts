import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  EmbeddingError,
  GeminiEmbedder,
  makeRetryAwareFetch,
  parseRetryAfterMs,
  RetryableHttpError,
  type GeminiEmbedderOptions,
} from "../../../src/embeddings/embedder-gemini";
import {
  GEMINI_DOC_PREFIX,
  GEMINI_QUERY_PREFIX,
} from "../../../src/embeddings/index-manifest";
import logger from "../../../src/shared/logger";
import type { ArticleNode } from "../../../src/shared/types";

// No network: the SDK is replaced by a class whose embedContent is a spy.
const { embedContent, ctorOptions } = vi.hoisted(() => ({
  embedContent: vi.fn(),
  ctorOptions: [] as unknown[],
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { embedContent };
    constructor(options: unknown) {
      ctorOptions.push(options);
    }
  },
}));

vi.mock("../../../src/shared/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const KEY = "test-key-not-real";
const DIM = 768;
const MODEL = "gemini-embedding-2";

const vec = (seed: number): number[] =>
  Array.from({ length: DIM }, (_, i) => (((i + seed) % 7) + 1) / 10);

const okFor = (count: number, seed = 1) => ({
  embeddings: Array.from({ length: count }, (_, i) => ({
    values: vec(seed + i),
  })),
});

const httpError = (status: number) =>
  Object.assign(new Error("upstream"), { status });

function make(overrides: Partial<GeminiEmbedderOptions> = {}) {
  const sleep = vi.fn(async (_ms: number) => {});
  const embedder = new GeminiEmbedder({
    apiKey: KEY,
    model: MODEL,
    dim: DIM,
    batchSize: 50,
    maxConcurrency: 2,
    sleep,
    ...overrides,
  });
  return { embedder, sleep };
}

async function ready(overrides: Partial<GeminiEmbedderOptions> = {}) {
  const made = make(overrides);
  await made.embedder.initialize();
  return made;
}

const article = {
  id: "a1",
  title: "Điều 1. Phạm vi",
  content: "Nội dung $& {content}",
  clauses: [
    { id: "c1", clause_number: 1, text: "Khoản một" },
    { id: "c2", clause_number: 2, text: "Khoản hai" },
    { id: "c3", clause_number: 3, text: "Khoản ba" },
  ],
} as unknown as ArticleNode;

function sentTexts(callIndex: number): string[] {
  const request = embedContent.mock.calls[callIndex][0] as {
    contents: Array<{ parts: Array<{ text: string }> }>;
  };
  return request.contents.map((c) => c.parts[0].text);
}

beforeEach(() => {
  vi.clearAllMocks();
  ctorOptions.length = 0;
  embedContent.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prefixes per method", () => {
  it("embed(text) is the query path", async () => {
    const { embedder } = await ready();
    embedContent.mockResolvedValueOnce(okFor(1));

    const out = await embedder.embed("Quyền sở hữu $& {content}");

    expect(out).toHaveLength(DIM);
    expect(sentTexts(0)).toEqual([
      "task: search result | query: Quyền sở hữu $& {content}",
    ]);
  });

  it("embedArticle is the document path with the article title", async () => {
    const { embedder } = await ready();
    embedContent.mockResolvedValueOnce(okFor(1));

    await embedder.embedArticle(article);

    expect(sentTexts(0)).toEqual([
      "title: Điều 1. Phạm vi | text: Nội dung $& {content}",
    ]);
  });

  it("embedClause is the document path", async () => {
    const { embedder } = await ready();
    embedContent.mockResolvedValueOnce(okFor(1));

    await embedder.embedClause(article, article.clauses[0]);

    expect(sentTexts(0)).toEqual([
      "title: Điều 1. Phạm vi | text: Khoản 1: Khoản một",
    ]);
  });

  it("embedArticleClauses is the document path, one text per clause", async () => {
    const { embedder } = await ready();
    embedContent.mockResolvedValueOnce(okFor(3));

    const out = await embedder.embedArticleClauses(article);

    expect(out).toHaveLength(3);
    expect(sentTexts(0)).toEqual([
      "title: Điều 1. Phạm vi | text: Khoản 1: Khoản một",
      "title: Điều 1. Phạm vi | text: Khoản 2: Khoản hai",
      "title: Điều 1. Phạm vi | text: Khoản 3: Khoản ba",
    ]);
  });

  it("embedBatch is the document path with the title none", async () => {
    const { embedder } = await ready();
    embedContent.mockResolvedValueOnce(okFor(1));

    await embedder.embedBatch(["x y"]);

    expect(sentTexts(0)).toEqual(["title: none | text: x y"]);
  });

  it("the templates in index-manifest.ts match the text the embedder sends", () => {
    expect(
      GEMINI_DOC_PREFIX.replace("{title}", "T").replace("{content}", "C"),
    ).toBe("title: T | text: C");
    expect(GEMINI_QUERY_PREFIX.replace("{content}", "Q")).toBe(
      "task: search result | query: Q",
    );
  });

  it("sends the model and outputDimensionality, and no task_type", async () => {
    const { embedder } = await ready();
    embedContent.mockResolvedValueOnce(okFor(1));

    await embedder.embed("q");

    const request = embedContent.mock.calls[0][0] as Record<string, unknown>;
    expect(request.model).toBe(MODEL);
    expect(request.config).toEqual({ outputDimensionality: DIM });
    expect(JSON.stringify(request)).not.toContain("taskType");
  });
});

describe("one Content per input", () => {
  it("splits into batches of batchSize, each input its own Content object", async () => {
    const { embedder } = await ready({ batchSize: 2 });
    embedContent
      .mockResolvedValueOnce(okFor(2))
      .mockResolvedValueOnce(okFor(1));

    const out = await embedder.embedArticleClauses(article);

    expect(out).toHaveLength(3);
    expect(embedContent).toHaveBeenCalledTimes(2);
    const first = embedContent.mock.calls[0][0] as { contents: unknown[] };
    const second = embedContent.mock.calls[1][0] as { contents: unknown[] };
    expect(first.contents).toHaveLength(2);
    expect(second.contents).toHaveLength(1);
    for (const content of [...first.contents, ...second.contents] as Array<{
      parts: unknown[];
    }>) {
      expect(content.parts).toHaveLength(1);
    }
  });

  it("a response count that differs from the input count throws", async () => {
    const { embedder } = await ready();
    embedContent.mockResolvedValueOnce(okFor(1));

    await expect(embedder.embedBatch(["a", "b"])).rejects.toThrow(
      "Gemini returned 1 embeddings for 2 inputs",
    );
  });
});

describe("errors never return a zero or partial vector (AC 38)", () => {
  it("throws EmbeddingError, not a vector, on an upstream error", async () => {
    const { embedder } = await ready();
    embedContent.mockRejectedValueOnce(httpError(400));

    const attempt = embedder.embed("q");
    await expect(attempt).rejects.toBeInstanceOf(EmbeddingError);
    await expect(attempt).rejects.toMatchObject({ httpStatus: 400 });
  });

  it.each([400, 401, 403])("HTTP %i is not retried", async (status) => {
    const { embedder, sleep } = await ready();
    embedContent.mockRejectedValue(httpError(status));

    await expect(embedder.embed("q")).rejects.toMatchObject({
      httpStatus: status,
    });
    expect(embedContent).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("an error message carries no key", async () => {
    const { embedder } = await ready();
    embedContent.mockRejectedValueOnce(httpError(401));

    let message = "";
    try {
      await embedder.embed("q");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain(KEY);
    expect(message).toContain("401");
  });

  it("a zero vector throws naming the id", async () => {
    const { embedder } = await ready();
    embedContent.mockResolvedValueOnce({
      embeddings: [{ values: new Array(DIM).fill(0) }],
    });

    await expect(
      embedder.embedClause(article, article.clauses[0]),
    ).rejects.toThrow("zero vector for c1");
  });

  it("a vector of the wrong length throws naming the id", async () => {
    const { embedder } = await ready();
    embedContent.mockResolvedValueOnce({
      embeddings: [{ values: [0.1, 0.2, 0.3, 0.4, 0.5] }],
    });

    await expect(embedder.embedArticle(article)).rejects.toThrow(
      "vector for a1 has length 5, expected 768",
    );
  });

  it("a non-finite value throws", async () => {
    const { embedder } = await ready();
    const values = vec(1);
    values[3] = Number.NaN;
    embedContent.mockResolvedValueOnce({ embeddings: [{ values }] });

    await expect(embedder.embed("q")).rejects.toThrow("non-finite");
  });

  it("a later failed batch fails the whole call, with no partial result", async () => {
    const { embedder } = await ready({ batchSize: 1 });
    embedContent
      .mockResolvedValueOnce(okFor(1))
      .mockRejectedValueOnce(httpError(400));

    await expect(embedder.embedArticleClauses(article)).rejects.toBeInstanceOf(
      EmbeddingError,
    );
  });

  it("an input over the 8,192-token bound throws naming the id, and nothing is sent", async () => {
    const { embedder } = await ready();

    await expect(embedder.embedBatch(["a".repeat(9000)])).rejects.toThrow(
      "input batch[0] is over the 8192-token embedding limit",
    );
    expect(embedContent).not.toHaveBeenCalled();
  });

  it("embed before initialize throws", async () => {
    const { embedder } = make();

    await expect(embedder.embed("q")).rejects.toThrow("not initialized");
    expect(embedContent).not.toHaveBeenCalled();
  });
});

describe("missing key", () => {
  it("names GEMINI_EMBEDDING_API_KEY and builds no client", () => {
    let message = "";
    try {
      new GeminiEmbedder({
        apiKey: undefined,
        model: MODEL,
        dim: DIM,
        batchSize: 50,
        maxConcurrency: 2,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("GEMINI_EMBEDDING_API_KEY");
    expect(ctorOptions).toHaveLength(0);
  });

  it("builds the client with the key and a timeout", () => {
    make();

    expect(ctorOptions).toHaveLength(1);
    const options = ctorOptions[0] as {
      apiKey: string;
      httpOptions: { fetch: unknown; timeout: number };
    };
    expect(options.apiKey).toBe(KEY);
    expect(typeof options.httpOptions.fetch).toBe("function");
    expect(options.httpOptions.timeout).toBeGreaterThan(0);
  });
});

describe("bounded retry (plan §5.3)", () => {
  it("503, 503, then success: two warn-logged retries with backoff", async () => {
    const { embedder, sleep } = await ready();
    embedContent
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce(okFor(1));

    const out = await embedder.embed("q");

    expect(out).toHaveLength(DIM);
    expect(embedContent).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    const first = sleep.mock.calls[0][0];
    const second = sleep.mock.calls[1][0];
    expect(first).toBeGreaterThanOrEqual(500);
    expect(first).toBeLessThanOrEqual(750);
    expect(second).toBeGreaterThanOrEqual(1000);
    expect(second).toBeLessThanOrEqual(1250);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("429 three times: at most 2 retries, then EmbeddingError with the status", async () => {
    const { embedder, sleep } = await ready();
    embedContent.mockRejectedValue(httpError(429));

    await expect(embedder.embed("q")).rejects.toMatchObject({
      name: "EmbeddingError",
      httpStatus: 429,
    });
    expect(embedContent).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("a network error is retried, then fails with EmbeddingError", async () => {
    const { embedder } = await ready();
    embedContent.mockRejectedValue(new TypeError("fetch failed"));

    await expect(embedder.embed("q")).rejects.toThrow("network error");
    expect(embedContent).toHaveBeenCalledTimes(3);
  });

  it("honours Retry-After over the backoff", async () => {
    const { embedder, sleep } = await ready();
    embedContent
      .mockRejectedValueOnce(new RetryableHttpError(429, 3000))
      .mockResolvedValueOnce(okFor(1));

    await embedder.embed("q");

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("refuses a Retry-After longer than the 10 s budget, without waiting", async () => {
    const { embedder, sleep } = await ready();
    embedContent.mockRejectedValue(new RetryableHttpError(429, 11000));

    await expect(embedder.embed("q")).rejects.toThrow(
      "retry budget of 10000 ms exhausted",
    );
    expect(embedContent).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("the budget counts total waiting across retries", async () => {
    const { embedder, sleep } = await ready();
    embedContent.mockRejectedValue(new RetryableHttpError(503, 6000));

    await expect(embedder.embed("q")).rejects.toThrow("retry budget");
    expect(embedContent).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.reduce((sum, [ms]) => sum + ms, 0)).toBe(6000);
  });

  it("a 500 is not retried", async () => {
    const { embedder, sleep } = await ready();
    embedContent.mockRejectedValue(httpError(500));

    await expect(embedder.embed("q")).rejects.toMatchObject({
      httpStatus: 500,
    });
    expect(embedContent).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("retry-aware fetch and Retry-After parsing", () => {
  it("turns a 429 with Retry-After into RetryableHttpError with the delay in ms", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, { status: 429, headers: { "retry-after": "2" } }),
      ),
    );
    const wrapped = makeRetryAwareFetch();

    await expect(wrapped("https://example.invalid/x")).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 2000,
    });
  });

  it("passes a 200 and a 400 through unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("{}", { status: 200 }))
        .mockResolvedValueOnce(new Response("{}", { status: 400 })),
    );
    const wrapped = makeRetryAwareFetch();

    expect((await wrapped("https://example.invalid/a")).status).toBe(200);
    expect((await wrapped("https://example.invalid/b")).status).toBe(400);
  });

  it("parseRetryAfterMs reads seconds, HTTP dates, and rejects garbage", () => {
    expect(parseRetryAfterMs("3")).toBe(3000);
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs("")).toBeUndefined();
    expect(parseRetryAfterMs("soon")).toBeUndefined();
    const later = parseRetryAfterMs(new Date(Date.now() + 5000).toUTCString());
    expect(later).toBeGreaterThan(3000);
    expect(later).toBeLessThanOrEqual(5000);
  });
});

describe("concurrency throttle", () => {
  it.each([1, 2])(
    "never runs more than maxConcurrency=%i requests at once",
    async (max) => {
      const { embedder } = await ready({ batchSize: 1, maxConcurrency: max });
      let inFlight = 0;
      let peak = 0;
      embedContent.mockImplementation(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return okFor(1);
      });

      const out = await embedder.embedArticleClauses(article);

      expect(out).toHaveLength(3);
      expect(peak).toBe(max);
    },
  );
});
