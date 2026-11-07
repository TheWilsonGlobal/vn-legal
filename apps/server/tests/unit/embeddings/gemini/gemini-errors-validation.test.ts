import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  EmbeddingError,
  estimateInputTokens,
  GEMINI_MAX_INPUT_TOKENS,
} from "../../../../src/embeddings/embedder-gemini";
import type { ArticleNode } from "../../../../src/shared/types";
import {
  DIM,
  KEY,
  VI_SENTENCE,
  article,
  httpError,
  make,
  okFor,
  ready,
  vec,
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

  it("an input over the 8,192-token estimate throws naming the id, and nothing is sent", async () => {
    const { embedder } = await ready();
    const over = { ...article, content: "ệ".repeat(8200) } as ArticleNode;

    await expect(embedder.embedArticle(over)).rejects.toThrow(
      "input a1 is over the 8192-token embedding limit: estimated",
    );
    expect(embedContent).not.toHaveBeenCalled();
  });

  it("the limit message says the count is an estimate and the text is not truncated", async () => {
    const { embedder } = await ready();

    let message = "";
    try {
      await embedder.embedArticle({
        ...article,
        content: "ệ".repeat(8200),
      } as ArticleNode);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("an estimate, not a tokenizer count");
    expect(message).toContain("not truncated");
    expect(message).not.toContain("UTF-8 bytes");
  });

  it("embed before initialize throws", async () => {
    const { embedder } = make();

    await expect(embedder.embed("q")).rejects.toThrow("not initialized");
    expect(embedContent).not.toHaveBeenCalled();
  });
});

describe("token estimate (R10-01)", () => {
  it("counts one token per character, and four per character outside the BMP", () => {
    expect(estimateInputTokens("abc")).toBe(3);
    expect(estimateInputTokens("ệ")).toBe(1);
    expect(estimateInputTokens("😀")).toBe(4);
  });

  it("a ~10 KB Vietnamese article under the estimate passes (the old byte check refused it)", async () => {
    const { embedder } = await ready();
    let content = "";
    while (Buffer.byteLength(content, "utf-8") < 10_240) content += VI_SENTENCE;
    expect(Buffer.byteLength(content, "utf-8")).toBeGreaterThanOrEqual(10_000);
    expect(estimateInputTokens(content)).toBeLessThan(GEMINI_MAX_INPUT_TOKENS);
    embedContent.mockResolvedValueOnce(okFor(1));

    const out = await embedder.embedArticle({
      ...article,
      content,
    } as ArticleNode);

    expect(out).toHaveLength(DIM);
    expect(embedContent).toHaveBeenCalledTimes(1);
  });

  it("an article whose estimate is over the limit fails naming its id, and nothing is sent", async () => {
    const { embedder } = await ready();

    await expect(
      embedder.embedArticle({
        ...article,
        content: "😀".repeat(2100),
      } as ArticleNode),
    ).rejects.toThrow("input a1 is over the 8192-token embedding limit");
    expect(embedContent).not.toHaveBeenCalled();
  });
});
