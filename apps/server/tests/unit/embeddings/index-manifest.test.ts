import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertIndexManifest,
  assertNoManifestLock,
  assertServerEmbeddingConfig,
  describeEmbedder,
  GEMINI_DOC_PREFIX,
  GEMINI_QUERY_PREFIX,
  hasManifest,
  IndexManifestLockedError,
  manifestPathFor,
  writeManifestAtomic,
  type EmbeddingConfig,
  type IndexManifest,
} from "../../../src/embeddings/index-manifest";
import { config } from "../../../src/shared/config";
import logger from "../../../src/shared/logger";
import {
  buildVectorIndex,
  addIndex,
} from "../../../src/scripts/build-index-by-congraphdb";
import { buildGraphLite } from "../../../src/scripts/build-index-by-congraphdb-lite";
import { createGraphClient } from "../../../src/graph/client";
import { createVectorStore } from "../../../src/embeddings/vector-store-factory";
import { getEmbedder } from "../../../src/embeddings/embedder-factory";

vi.mock("../../../src/shared/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// The build functions are imported for the lock check only. Nothing below may
// open a real store or embed anything, so the store and embedder are stubbed.
vi.mock("../../../src/embeddings/vector-store-factory", () => ({
  createVectorStore: vi.fn(),
}));
vi.mock("../../../src/embeddings/embedder-factory", () => ({
  getEmbedder: vi.fn(),
}));
vi.mock("../../../src/embeddings/congraph", () => ({
  createConGraphIndexingPipeline: vi.fn(),
}));
vi.mock("../../../src/graph/parser", () => ({
  parseLegalFile: vi.fn(),
  parseLegalData: vi.fn(),
}));
// The lite build must refuse before it reaches the graph. If it does not, this
// throws, so the test fails without touching a real database.
vi.mock("../../../src/graph/client", () => ({
  createGraphClient: vi.fn(() => {
    throw new Error("graph build reached before the manifest lock check");
  }),
}));

const KEY_LIKE = "test-key-not-real";

const geminiCfg = (
  overrides: Partial<EmbeddingConfig["embedding"]> = {},
  vectorStoreType: EmbeddingConfig["vectorStoreType"] = "congraph",
): EmbeddingConfig => ({
  vectorStoreType,
  embedding: {
    provider: "gemini",
    model: "gemini-embedding-2",
    dim: 768,
    batchSize: 50,
    maxConcurrency: 2,
    maxTokensBudget: 2000000,
    apiKey: KEY_LIKE,
    ...overrides,
  },
});

const legacyManifest = (): IndexManifest => ({
  index_id: "legacy-transformers-384",
  provider: "transformers",
  model: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  dim: 384,
  doc_prefix: "",
  query_prefix: "",
  corpus_sha256: null,
  counts: { articles: 689, clauses: 1430, reports: 0 },
  created_at: "2026-11-01T00:00:00.000Z",
  legacy: true,
  written_by: "RB1",
});

const geminiManifest = (): IndexManifest => ({
  index_id: "gemini-embedding-2-768-test",
  provider: "gemini",
  model: "gemini-embedding-2",
  dim: 768,
  doc_prefix: GEMINI_DOC_PREFIX,
  query_prefix: GEMINI_QUERY_PREFIX,
  corpus_sha256: "a".repeat(64),
  counts: { articles: 689 },
  created_at: "2026-11-06T00:00:00.000Z",
  written_by: "RB1",
});

function hashDir(dir: string): string {
  const h = createHash("sha256");
  for (const name of readdirSync(dir).sort()) {
    h.update(name);
    h.update(readFileSync(join(dir, name)));
  }
  return h.digest("hex");
}

let dir: string;
let storePath: string;

beforeEach(() => {
  vi.clearAllMocks();
  dir = mkdtempSync(join(tmpdir(), "index-manifest-"));
  storePath = join(dir, "store.cgraph");
  writeFileSync(storePath, Buffer.from("store bytes that must never change"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("describeEmbedder", () => {
  it("describes gemini-embedding-2 at 768-d with the two text templates", () => {
    expect(describeEmbedder(geminiCfg())).toEqual({
      provider: "gemini",
      model: "gemini-embedding-2",
      dim: 768,
      doc_prefix: "title: {title} | text: {content}",
      query_prefix: "task: search result | query: {content}",
    });
  });

  it("describes the transformers rollback exactly as the legacy manifest", () => {
    const described = describeEmbedder({
      vectorStoreType: "congraph",
      embedding: { ...geminiCfg().embedding, provider: "transformers" },
    });
    expect(described).toEqual({
      provider: legacyManifest().provider,
      model: legacyManifest().model,
      dim: legacyManifest().dim,
      doc_prefix: legacyManifest().doc_prefix,
      query_prefix: legacyManifest().query_prefix,
    });
  });

  it("names EMBEDDING_PROVIDER when the provider is unset", () => {
    expect(() => describeEmbedder(geminiCfg({ provider: undefined }))).toThrow(
      "EMBEDDING_PROVIDER",
    );
  });

  it("names EMBEDDING_MODEL when gemini has no model", () => {
    expect(() => describeEmbedder(geminiCfg({ model: undefined }))).toThrow(
      "EMBEDDING_MODEL",
    );
  });
});

describe("assertServerEmbeddingConfig", () => {
  it("passes for gemini with a key and a model", () => {
    expect(() => assertServerEmbeddingConfig(geminiCfg())).not.toThrow();
  });

  it("refuses an unset provider, naming EMBEDDING_PROVIDER", () => {
    expect(() =>
      assertServerEmbeddingConfig(geminiCfg({ provider: undefined })),
    ).toThrow("EMBEDDING_PROVIDER");
  });

  it("refuses an unsupported provider, naming EMBEDDING_PROVIDER", () => {
    expect(() =>
      assertServerEmbeddingConfig(geminiCfg({ provider: "api" })),
    ).toThrow("EMBEDDING_PROVIDER");
  });

  it("refuses lancedb together with gemini", () => {
    expect(() => assertServerEmbeddingConfig(geminiCfg({}, "lancedb"))).toThrow(
      "VECTOR_STORE_TYPE=lancedb",
    );
  });

  it("names GEMINI_EMBEDDING_API_KEY when the key is missing, without any value", () => {
    let message = "";
    try {
      assertServerEmbeddingConfig(geminiCfg({ apiKey: undefined }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("GEMINI_EMBEDDING_API_KEY");
    expect(message).not.toContain(KEY_LIKE);
  });

  it("accepts the transformers rollback and logs the rollback warning", () => {
    expect(() =>
      assertServerEmbeddingConfig({
        vectorStoreType: "congraph",
        embedding: { ...geminiCfg().embedding, provider: "transformers" },
      }),
    ).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      "embedding rollback mode: transformers 384-d",
    );
  });
});

describe("assertIndexManifest", () => {
  it("passes when the manifest matches the described embedder and returns it with index_id", async () => {
    writeFileSync(manifestPathFor(storePath), JSON.stringify(geminiManifest()));

    const manifest = await assertIndexManifest(
      storePath,
      describeEmbedder(geminiCfg()),
    );

    expect(manifest.index_id).toBe("gemini-embedding-2-768-test");
  });

  it("throws naming the path when the manifest is missing", async () => {
    await expect(
      assertIndexManifest(storePath, describeEmbedder(geminiCfg())),
    ).rejects.toThrow(manifestPathFor(storePath));
    await expect(
      assertIndexManifest(storePath, describeEmbedder(geminiCfg())),
    ).rejects.toThrow("missing");
  });

  it.each([
    ["provider", { provider: "transformers" }],
    ["model", { model: "gemini-embedding-001" }],
    ["dim", { dim: 384 }],
    ["doc_prefix", { doc_prefix: "passage: {content}" }],
    ["query_prefix", { query_prefix: "query: {content}" }],
  ])(
    "throws naming the path and the field %s on a mismatch",
    async (field, override) => {
      writeFileSync(
        manifestPathFor(storePath),
        JSON.stringify({ ...geminiManifest(), ...override }),
      );

      const attempt = assertIndexManifest(
        storePath,
        describeEmbedder(geminiCfg()),
      );
      await expect(attempt).rejects.toThrow(`field ${field} is`);
      await expect(attempt).rejects.toThrow(manifestPathFor(storePath));
    },
  );

  it("refuses the legacy 384-d manifest for the gemini embedder", async () => {
    writeFileSync(manifestPathFor(storePath), JSON.stringify(legacyManifest()));

    await expect(
      assertIndexManifest(storePath, describeEmbedder(geminiCfg())),
    ).rejects.toThrow("field provider is");
  });

  it("accepts the legacy manifest for the transformers rollback", async () => {
    writeFileSync(manifestPathFor(storePath), JSON.stringify(legacyManifest()));

    const manifest = await assertIndexManifest(
      storePath,
      describeEmbedder({
        vectorStoreType: "congraph",
        embedding: { ...geminiCfg().embedding, provider: "transformers" },
      }),
    );

    expect(manifest.index_id).toBe("legacy-transformers-384");
  });

  it("throws naming the path for a manifest that is not valid JSON", async () => {
    writeFileSync(manifestPathFor(storePath), "{not json");

    await expect(
      assertIndexManifest(storePath, describeEmbedder(geminiCfg())),
    ).rejects.toThrow(manifestPathFor(storePath));
  });
});

describe("manifest lock", () => {
  it("hasManifest and assertNoManifestLock pass when no manifest exists", () => {
    expect(hasManifest(storePath)).toBe(false);
    expect(() => assertNoManifestLock(storePath)).not.toThrow();
  });

  it("assertNoManifestLock throws IndexManifestLockedError when a manifest exists", () => {
    writeFileSync(manifestPathFor(storePath), JSON.stringify(geminiManifest()));

    expect(hasManifest(storePath)).toBe(true);
    try {
      assertNoManifestLock(storePath);
      expect.unreachable("assertNoManifestLock should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(IndexManifestLockedError);
      expect((error as IndexManifestLockedError).code).toBe(
        "index_locked_by_manifest",
      );
      expect((error as IndexManifestLockedError).path).toBe(storePath);
    }
  });
});

describe("writeManifestAtomic", () => {
  it("writes the manifest, reads back equal, and leaves no temp file", async () => {
    await writeManifestAtomic(storePath, geminiManifest());

    const onDisk = JSON.parse(
      readFileSync(manifestPathFor(storePath), "utf-8"),
    );
    expect(onDisk).toEqual(geminiManifest());
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses a manifest without index_id and writes nothing", async () => {
    const bad = { ...geminiManifest(), index_id: "" };

    await expect(writeManifestAtomic(storePath, bad)).rejects.toThrow(
      "index_id",
    );
    expect(hasManifest(storePath)).toBe(false);
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});

describe("legacy build functions refuse a manifested store (AC 41)", () => {
  const storeBytesHash = () => hashDir(dir);

  beforeEach(() => {
    writeFileSync(manifestPathFor(storePath), JSON.stringify(geminiManifest()));
    (config as { conGraphVectorDbPath: string }).conGraphVectorDbPath =
      storePath;
  });

  it("buildVectorIndex throws before clearAll and leaves the store byte-identical", async () => {
    const before = storeBytesHash();

    await expect(buildVectorIndex()).rejects.toMatchObject({
      code: "index_locked_by_manifest",
    });

    expect(storeBytesHash()).toBe(before);
    expect(createVectorStore).not.toHaveBeenCalled();
    expect(getEmbedder).not.toHaveBeenCalled();
  });

  it("buildGraphLite throws before the graph build and clearAll (R10-04)", async () => {
    const before = storeBytesHash();

    await expect(buildGraphLite()).rejects.toMatchObject({
      code: "index_locked_by_manifest",
    });

    expect(createGraphClient).not.toHaveBeenCalled();
    expect(storeBytesHash()).toBe(before);
  });

  it("addIndex throws before clearAll and leaves the store byte-identical", async () => {
    const before = storeBytesHash();

    await expect(addIndex()).rejects.toMatchObject({
      code: "index_locked_by_manifest",
    });

    expect(storeBytesHash()).toBe(before);
    expect(createVectorStore).not.toHaveBeenCalled();
    expect(getEmbedder).not.toHaveBeenCalled();
  });

  it("a manifest on the store also refuses a call that passes an existing store", async () => {
    const before = storeBytesHash();
    const clearAll = vi.fn();

    await expect(
      addIndex(undefined, { clearAll } as never),
    ).rejects.toMatchObject({ code: "index_locked_by_manifest" });

    expect(clearAll).not.toHaveBeenCalled();
    expect(storeBytesHash()).toBe(before);
  });
});
