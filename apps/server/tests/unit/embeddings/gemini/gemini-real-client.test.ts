import { describe, it, expect, vi, afterEach } from "vitest";
import { GeminiEmbedder } from "../../../../src/embeddings/embedder-gemini";
import { DIM, KEY, MODEL, vec } from "./gemini-fixtures";

describe("real @google/genai client with fetch stubbed (R10-06, RB1)", () => {
  const json = (body: unknown, status: number, headers = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });

  async function realEmbedder(sleep: (ms: number) => Promise<void>) {
    const embedder = new GeminiEmbedder({
      apiKey: KEY,
      model: MODEL,
      dim: DIM,
      batchSize: 50,
      maxConcurrency: 2,
      sleep,
    });
    await embedder.initialize();
    return embedder;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a 429 with Retry-After reaches withRetry as RetryableHttpError and the delay is honoured", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(
        json(
          {
            error: {
              code: 429,
              message: "Resource has been exhausted",
              status: "RESOURCE_EXHAUSTED",
            },
          },
          429,
          { "retry-after": "1" },
        ),
      )
      .mockResolvedValueOnce(json({ embeddings: [{ values: vec(1) }] }, 200));
    vi.stubGlobal("fetch", fetchStub);
    const sleep = vi.fn(async (_ms: number) => {});
    const embedder = await realEmbedder(sleep);

    const out = await embedder.embed("q");

    expect(out).toHaveLength(DIM);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("a 429 that never clears throws Google's status and message, key and URL redacted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          {
            error: {
              code: 429,
              message: `Quota exceeded for ${KEY}. See https://ai.google.dev/rate-limits`,
              status: "RESOURCE_EXHAUSTED",
            },
          },
          429,
        ),
      ),
    );
    const embedder = await realEmbedder(async () => {});

    let caught: unknown;
    try {
      await embedder.embed("q");
    } catch (error) {
      caught = error;
    }
    const message = (caught as Error).message;
    expect(caught).toMatchObject({ name: "EmbeddingError", httpStatus: 429 });
    expect(message).toBe(
      "Gemini embedContent for input query failed after 2 retries (HTTP 429: RESOURCE_EXHAUSTED: Quota exceeded for [key]. See [url])",
    );
    expect(message).not.toContain(KEY);
    expect(message).not.toContain("https://");
  });

  it("a 400 from the SDK keeps Google's status and message, and is not retried", async () => {
    const fetchStub = vi.fn(async () =>
      json(
        {
          error: {
            code: 400,
            message: "Request contains an invalid argument.",
            status: "INVALID_ARGUMENT",
          },
        },
        400,
      ),
    );
    vi.stubGlobal("fetch", fetchStub);
    const sleep = vi.fn(async (_ms: number) => {});
    const embedder = await realEmbedder(sleep);

    await expect(embedder.embed("q")).rejects.toThrow(
      "failed with HTTP 400: INVALID_ARGUMENT: Request contains an invalid argument.",
    );
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
