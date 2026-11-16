import { describe, expect, it } from "vitest";
import { JinaEmbedder, JINA_API_URL } from "../../../../src/embeddings/embedder-jina";
import { isQuotaError, withKeyRotation } from "../../../../src/embeddings/key-rotation";

const DIM = 4;
const SECRET = "jina_test_secret_key";

function vector(seed: number): number[] {
  const v = [seed + 1, 1, 1, 1];
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

interface Call {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function fakeFetch(responses: Array<() => Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      init: init ?? {},
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra request");
    return next();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function embedder(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof JinaEmbedder>[0]> = {}) {
  const sleeps: number[] = [];
  const e = new JinaEmbedder({
    apiKey: SECRET,
    model: "jina-embeddings-v3",
    dim: DIM,
    batchSize: 50,
    maxConcurrency: 2,
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...extra,
  });
  return { e, sleeps };
}

describe("JinaEmbedder request shape", () => {
  it("documents use retrieval.passage, normalized float vectors, and return in input order", async () => {
    // Jina may return items out of order; the index field decides the position.
    const { fetchImpl, calls } = fakeFetch([
      () =>
        jsonResponse({
          data: [
            { index: 1, embedding: vector(1) },
            { index: 0, embedding: vector(0) },
          ],
          usage: { total_tokens: 40 },
        }),
    ]);
    const { e } = embedder(fetchImpl);
    await e.initialize();

    const out = await e.embedDocuments([
      { id: "a", title: "Điều 1", text: "nội dung" },
      { id: "b", title: "Điều 2", text: "nội dung 2" },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(JINA_API_URL);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    expect(calls[0].body).toMatchObject({
      model: "jina-embeddings-v3",
      task: "retrieval.passage",
      dimensions: DIM,
      normalized: true,
      embedding_type: "float",
    });
    expect(calls[0].body.input).toEqual([
      "title: Điều 1 | text: nội dung",
      "title: Điều 2 | text: nội dung 2",
    ]);
    expect(out).toEqual([vector(0), vector(1)]);
    expect(e.tokensUsed()).toBe(40);
  });

  it("the query path uses retrieval.query and sends the raw query text", async () => {
    const { fetchImpl, calls } = fakeFetch([
      () => jsonResponse({ data: [{ index: 0, embedding: vector(0) }], usage: { total_tokens: 5 } }),
    ]);
    const { e } = embedder(fetchImpl);
    await e.initialize();

    const v = await e.embed("quyền sở hữu");

    expect(v).toEqual(vector(0));
    expect(calls[0].body.task).toBe("retrieval.query");
    expect(calls[0].body.input).toEqual(["quyền sở hữu"]);
  });

  it("splits inputs into batches of batchSize, one request each", async () => {
    const { fetchImpl, calls } = fakeFetch([
      () => jsonResponse({ data: [{ index: 0, embedding: vector(0) }, { index: 1, embedding: vector(1) }] }),
      () => jsonResponse({ data: [{ index: 0, embedding: vector(2) }] }),
    ]);
    const { e } = embedder(fetchImpl, { batchSize: 2 });
    await e.initialize();

    const out = await e.embedDocuments([
      { id: "1", title: "t", text: "x" },
      { id: "2", title: "t", text: "x" },
      { id: "3", title: "t", text: "x" },
    ]);

    expect(calls).toHaveLength(2);
    expect(out).toHaveLength(3);
  });
});

describe("JinaEmbedder failures", () => {
  it("a 401 throws at once with httpStatus 401 and never includes the key", async () => {
    const { fetchImpl, calls } = fakeFetch([
      () => new Response(JSON.stringify({ detail: `bad key ${SECRET}` }), { status: 401 }),
    ]);
    const { e } = embedder(fetchImpl);
    await e.initialize();

    const err = await e.embed("q").catch((x: unknown) => x as Error & { httpStatus?: number });

    expect(calls).toHaveLength(1);
    expect((err as { httpStatus?: number }).httpStatus).toBe(401);
    expect(err.message).toContain("HTTP 401");
    expect(err.message).not.toContain(SECRET);
    expect(err.message).toContain("[key]");
  });

  it("a 429 is retried after Retry-After, then succeeds", async () => {
    const { fetchImpl, calls } = fakeFetch([
      () => new Response("{}", { status: 429, headers: { "retry-after": "1" } }),
      () => jsonResponse({ data: [{ index: 0, embedding: vector(0) }] }),
    ]);
    const { e, sleeps } = embedder(fetchImpl);
    await e.initialize();

    await e.embed("q");

    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([1000]);
  });

  it("a 402 (insufficient balance) is a quota error for key rotation", async () => {
    const { fetchImpl } = fakeFetch([() => new Response("{}", { status: 402 })]);
    const { e } = embedder(fetchImpl);
    await e.initialize();

    const err = await e.embed("q").catch((x: unknown) => x);

    expect((err as { httpStatus?: number }).httpStatus).toBe(402);
    expect(isQuotaError(err)).toBe(true);
  });

  it("rejects a zero vector and a wrong-length vector", async () => {
    const zero = fakeFetch([() => jsonResponse({ data: [{ index: 0, embedding: [0, 0, 0, 0] }] })]);
    const a = embedder(zero.fetchImpl);
    await a.e.initialize();
    await expect(a.e.embed("q")).rejects.toThrow(/zero vector/);

    const short = fakeFetch([() => jsonResponse({ data: [{ index: 0, embedding: [1, 2] }] })]);
    const b = embedder(short.fetchImpl);
    await b.e.initialize();
    await expect(b.e.embed("q")).rejects.toThrow(/expected 4/);
  });

  it("refuses to run before initialize()", async () => {
    const { fetchImpl, calls } = fakeFetch([]);
    const { e } = embedder(fetchImpl);
    await expect(e.embed("q")).rejects.toThrow(/not initialized/);
    expect(calls).toHaveLength(0);
  });
});

describe("key rotation over Jina embedders", () => {
  it("sums tokensUsed across the whole chain, so the budget is not undercounted", async () => {
    // One attempt plus MAX_RETRIES (2) retries, all over quota.
    const quota = fakeFetch([
      () => new Response("{}", { status: 429 }),
      () => new Response("{}", { status: 429 }),
      () => new Response("{}", { status: 429 }),
    ]);
    const primary = embedder(quota.fetchImpl, { sleep: async () => {} });
    await primary.e.initialize();
    const ok = fakeFetch([() => jsonResponse({ data: [{ index: 0, embedding: vector(0) }], usage: { total_tokens: 7 } })]);
    const fallback = embedder(ok.fetchImpl);
    await fallback.e.initialize();

    // Primary is over quota every time, so it only rotates after its retries are spent.
    const rotated = withKeyRotation(primary.e, [fallback.e]) as unknown as {
      embed(text: string): Promise<number[]>;
      tokensUsed(): number;
    };
    await rotated.embed("q");

    expect(rotated.tokensUsed()).toBe(7);
  });
});
