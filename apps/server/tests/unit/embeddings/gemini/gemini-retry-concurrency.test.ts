import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  makeRetryAwareFetch,
  parseRetryAfterMs,
  RetryableHttpError,
} from "../../../../src/embeddings/embedder-gemini";
import logger from "../../../../src/shared/logger";
import {
  DIM,
  article,
  httpError,
  okFor,
  ready,
} from "./gemini-fixtures";

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

vi.mock("../../../../src/shared/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  ctorOptions.length = 0;
  embedContent.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
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

  it.each([
    [
      "a socket reset",
      Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    ],
    [
      "a timeout",
      Object.assign(new Error("request timed out"), { name: "TimeoutError" }),
    ],
    ["an abort", Object.assign(new Error("aborted"), { name: "AbortError" })],
  ])("%s is a connection-level error: retried", async (_label, error) => {
    const { embedder, sleep } = await ready();
    embedContent.mockRejectedValue(error);

    await expect(embedder.embed("q")).rejects.toThrow("network error");
    expect(embedContent).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("any other error throws at once, with no retry (R10-05)", async () => {
    const { embedder, sleep } = await ready();
    embedContent.mockRejectedValue(new Error("unexpected response shape"));

    await expect(embedder.embed("q")).rejects.toThrow(
      "unexpected response shape",
    );
    expect(embedContent).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("a TypeError that is not a fetch failure is not retried as network (R10-05)", async () => {
    const { embedder, sleep } = await ready();
    embedContent.mockRejectedValue(
      new TypeError("Cannot read properties of undefined"),
    );

    await expect(embedder.embed("q")).rejects.toThrow(
      "Cannot read properties of undefined",
    );
    expect(embedContent).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
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
