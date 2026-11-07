import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GeminiEmbedder } from "../../../../src/embeddings/embedder-gemini";
import {
  GEMINI_DOC_PREFIX,
  GEMINI_QUERY_PREFIX,
} from "../../../../src/embeddings/index-manifest";
import {
  DIM,
  KEY,
  MODEL,
  article,
  httpError,
  make,
  okFor,
  ready,
  sentTexts,
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

describe("prefixes per method", () => {
  it("embed(text) is the query path", async () => {
    const { embedder } = await ready();
    embedContent.mockResolvedValueOnce(okFor(1));

    const out = await embedder.embed("Quyền sở hữu $& {content}");

    expect(out).toHaveLength(DIM);
    expect(sentTexts(embedContent, 0)).toEqual([
      "task: search result | query: Quyền sở hữu $& {content}",
    ]);
  });

  it("embedArticle is the document path with the article title", async () => {
    const { embedder } = await ready();
    embedContent.mockResolvedValueOnce(okFor(1));

    await embedder.embedArticle(article);

    expect(sentTexts(embedContent, 0)).toEqual([
      "title: Điều 1. Phạm vi | text: Nội dung $& {content}",
    ]);
  });

  it("embedClause is the document path", async () => {
    const { embedder } = await ready();
    embedContent.mockResolvedValueOnce(okFor(1));

    await embedder.embedClause(article, article.clauses[0]);

    expect(sentTexts(embedContent, 0)).toEqual([
      "title: Điều 1. Phạm vi | text: Khoản 1: Khoản một",
    ]);
  });

  it("embedArticleClauses is the document path, one text per clause", async () => {
    const { embedder } = await ready();
    embedContent.mockResolvedValueOnce(okFor(3));

    const out = await embedder.embedArticleClauses(article);

    expect(out).toHaveLength(3);
    expect(sentTexts(embedContent, 0)).toEqual([
      "title: Điều 1. Phạm vi | text: Khoản 1: Khoản một",
      "title: Điều 1. Phạm vi | text: Khoản 2: Khoản hai",
      "title: Điều 1. Phạm vi | text: Khoản 3: Khoản ba",
    ]);
  });

  it("embedBatch is the document path with the title none", async () => {
    const { embedder } = await ready();
    embedContent.mockResolvedValueOnce(okFor(1));

    await embedder.embedBatch(["x y"]);

    expect(sentTexts(embedContent, 0)).toEqual(["title: none | text: x y"]);
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

describe("embedDocuments (document path, batched)", () => {
  const docs = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `d${i}`,
      title: `Title ${i}`,
      text: `body ${i}`,
    }));

  it("120 documents make 3 requests at batchSize 50, sized 50, 50 and 20", async () => {
    const { embedder } = await ready();
    embedContent.mockImplementation(async (request: { contents: unknown[] }) =>
      okFor(request.contents.length),
    );

    const out = await embedder.embedDocuments(docs(120));

    expect(embedContent).toHaveBeenCalledTimes(3);
    const sizes = embedContent.mock.calls.map(
      ([request]) => (request as { contents: unknown[] }).contents.length,
    );
    expect(sizes).toEqual([50, 50, 20]);
    expect(out).toHaveLength(120);
  });

  it("each document is its own Content, with the document prefix title: T | text: X", async () => {
    const { embedder } = await ready();
    embedContent.mockResolvedValueOnce(okFor(2));

    await embedder.embedDocuments([
      { id: "d0", title: "Điều 1", text: "Nội dung một" },
      { id: "d1", title: "A $& B", text: "x {content}" },
    ]);

    expect(embedContent).toHaveBeenCalledTimes(1);
    const request = embedContent.mock.calls[0][0] as {
      contents: Array<{ parts: unknown[] }>;
    };
    expect(request.contents).toHaveLength(2);
    expect(request.contents.every((c) => c.parts.length === 1)).toBe(true);
    expect(sentTexts(embedContent, 0)).toEqual([
      "title: Điều 1 | text: Nội dung một",
      "title: A $& B | text: x {content}",
    ]);
    expect(request).toMatchObject({
      model: MODEL,
      config: { outputDimensionality: DIM },
    });
  });

  it("returns vectors in input order", async () => {
    const { embedder } = await ready();
    embedContent.mockResolvedValueOnce(okFor(2, 5));

    const out = await embedder.embedDocuments(docs(2));

    expect(out[0]).toEqual(vec(5));
    expect(out[1]).toEqual(vec(6));
  });

  it("an empty list makes no request", async () => {
    const { embedder } = await ready();

    expect(await embedder.embedDocuments([])).toEqual([]);
    expect(embedContent).not.toHaveBeenCalled();
  });

  it("a zero vector names the document id", async () => {
    const { embedder } = await ready();
    embedContent.mockResolvedValueOnce({
      embeddings: [{ values: new Array(DIM).fill(0) }],
    });

    await expect(embedder.embedDocuments(docs(1))).rejects.toThrow(
      "zero vector for d0",
    );
  });

  it("an over-limit document names its id, and nothing is sent", async () => {
    const { embedder } = await ready();
    const items = [
      ...docs(3),
      { id: "d7", title: "Big", text: "ệ".repeat(8200) },
    ];

    await expect(embedder.embedDocuments(items)).rejects.toThrow(
      "input d7 is over the 8192-token embedding limit",
    );
    expect(embedContent).not.toHaveBeenCalled();
  });

  it("a failed batch names the first and last ids in the batch", async () => {
    const { embedder } = await ready();
    embedContent.mockRejectedValueOnce(httpError(400));

    await expect(embedder.embedDocuments(docs(50))).rejects.toThrow(
      "embedContent for 50 inputs (ids d0 to d49) failed with HTTP 400",
    );
  });
});
