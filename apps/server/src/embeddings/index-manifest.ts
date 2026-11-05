// ============================================================================
// Index manifest: which embedder built a vector store, and the boot-time check
// that refuses to query a store with any other embedder (plan §5.9, AC 35/39/41)
// ============================================================================

import { existsSync } from "node:fs";
import { open, readFile, rename, rm } from "node:fs/promises";
import type { config as appConfig } from "../shared/config";
import logger from "../shared/logger";

/** The part of the app config this module reads. */
export type EmbeddingConfig = Pick<
  typeof appConfig,
  "embedding" | "vectorStoreType"
>;

/** Document and query text templates for gemini-embedding-2 (no task_type). */
export const GEMINI_DOC_PREFIX = "title: {title} | text: {content}";
export const GEMINI_QUERY_PREFIX = "task: search result | query: {content}";

/** The legacy 384-d store, built by the transformers embedder. */
export const LEGACY_TRANSFORMERS_MODEL =
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export const LEGACY_TRANSFORMERS_DIM = 384;
export const LEGACY_TRANSFORMERS_INDEX_ID = "legacy-transformers-384";

export interface EmbedderDescription {
  provider: string;
  model: string;
  dim: number;
  doc_prefix: string;
  query_prefix: string;
}

export interface IndexManifest {
  index_id: string;
  provider: string;
  model: string;
  dim: number;
  doc_prefix: string;
  query_prefix: string;
  corpus_sha256: string | null;
  counts: Record<string, number>;
  created_at: string;
  legacy?: boolean;
  written_by?: string;
}

/** Thrown by assertNoManifestLock. B3 maps it to 409 with `path`. */
export class IndexManifestLockedError extends Error {
  readonly code = "index_locked_by_manifest";
  readonly path: string;

  constructor(path: string, manifestPath: string) {
    super(
      `Refusing to write ${path}: it has an index manifest (${manifestPath}). ` +
        "A manifested store is written only by the Gemini rebuild script.",
    );
    this.name = "IndexManifestLockedError";
    this.path = path;
  }
}

export function manifestPathFor(storePath: string): string {
  return `${storePath}.manifest.json`;
}

/** The embedder the configuration selects, in the shape the manifest stores. */
export function describeEmbedder(cfg: EmbeddingConfig): EmbedderDescription {
  const provider = cfg.embedding.provider;
  if (provider === "gemini") {
    const model = cfg.embedding.model;
    if (!model) {
      throw new Error(
        "EMBEDDING_MODEL is not set (required by EMBEDDING_PROVIDER=gemini)",
      );
    }
    return {
      provider: "gemini",
      model,
      dim: cfg.embedding.dim,
      doc_prefix: GEMINI_DOC_PREFIX,
      query_prefix: GEMINI_QUERY_PREFIX,
    };
  }
  if (provider === "transformers") {
    return {
      provider: "transformers",
      model: LEGACY_TRANSFORMERS_MODEL,
      dim: LEGACY_TRANSFORMERS_DIM,
      doc_prefix: "",
      query_prefix: "",
    };
  }
  throw new Error(
    'EMBEDDING_PROVIDER must be "gemini" (or "transformers" for the documented rollback); it is unset or not a supported value',
  );
}

/**
 * Boot-time configuration check, called before the vector store is opened.
 * Refuses an unset or unsupported provider, lancedb with gemini, and gemini
 * without its own key or model. Logs the rollback warning for transformers.
 */
export function assertServerEmbeddingConfig(cfg: EmbeddingConfig): void {
  const provider = cfg.embedding.provider;
  if (provider !== "gemini" && provider !== "transformers") {
    throw new Error(
      'EMBEDDING_PROVIDER must be "gemini" (or "transformers" for the documented rollback); it is unset or not a supported value',
    );
  }
  if (provider === "transformers") {
    logger.warn("embedding rollback mode: transformers 384-d");
    return;
  }
  if (cfg.vectorStoreType === "lancedb") {
    throw new Error(
      "VECTOR_STORE_TYPE=lancedb is not supported with EMBEDDING_PROVIDER=gemini (phase 01 rebuilds the congraph store only)",
    );
  }
  if (!cfg.embedding.apiKey) {
    throw new Error(
      "GEMINI_EMBEDDING_API_KEY is not set (required by EMBEDDING_PROVIDER=gemini)",
    );
  }
  if (!cfg.embedding.model) {
    throw new Error(
      "EMBEDDING_MODEL is not set (required by EMBEDDING_PROVIDER=gemini)",
    );
  }
}

export function hasManifest(storePath: string): boolean {
  return existsSync(manifestPathFor(storePath));
}

/** Throws when the store has a manifest. The legacy builder must never clear it. */
export function assertNoManifestLock(storePath: string): void {
  if (hasManifest(storePath)) {
    throw new IndexManifestLockedError(storePath, manifestPathFor(storePath));
  }
}

// The legacy transformers manifest has empty prefixes, so they may be "".
const REQUIRED_STRING_FIELDS = [
  "index_id",
  "provider",
  "model",
  "created_at",
] as const;
const STRING_FIELDS_ALLOWING_EMPTY = ["doc_prefix", "query_prefix"] as const;

function parseManifest(path: string, raw: string): IndexManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`index manifest ${path} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`index manifest ${path} is not a JSON object`);
  }
  const m = parsed as Record<string, unknown>;
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof m[field] !== "string" || m[field] === "") {
      throw new Error(
        `index manifest ${path}: field ${field} is missing or not a string`,
      );
    }
  }
  for (const field of STRING_FIELDS_ALLOWING_EMPTY) {
    if (typeof m[field] !== "string") {
      throw new Error(
        `index manifest ${path}: field ${field} is missing or not a string`,
      );
    }
  }
  if (typeof m.dim !== "number" || !Number.isInteger(m.dim) || m.dim <= 0) {
    throw new Error(
      `index manifest ${path}: field dim is missing or not a positive integer`,
    );
  }
  if (m.corpus_sha256 !== null && typeof m.corpus_sha256 !== "string") {
    throw new Error(
      `index manifest ${path}: field corpus_sha256 must be a string or null`,
    );
  }
  if (
    typeof m.counts !== "object" ||
    m.counts === null ||
    Array.isArray(m.counts)
  ) {
    throw new Error(`index manifest ${path}: field counts must be an object`);
  }
  return m as unknown as IndexManifest;
}

/**
 * Reads `<storePath>.manifest.json` and requires provider, model, dim and both
 * prefixes to equal the described embedder. Missing or mismatched: throws,
 * naming the path and the field.
 */
export async function assertIndexManifest(
  storePath: string,
  described: EmbedderDescription,
): Promise<IndexManifest> {
  const path = manifestPathFor(storePath);
  if (!existsSync(path)) {
    throw new Error(
      `index manifest missing: ${path}. The store was not built by a manifest-writing rebuild.`,
    );
  }
  const manifest = parseManifest(path, await readFile(path, "utf-8"));

  const fields = [
    "provider",
    "model",
    "dim",
    "doc_prefix",
    "query_prefix",
  ] as const;
  for (const field of fields) {
    if (manifest[field] !== described[field]) {
      throw new Error(
        `index manifest ${path}: field ${field} is ${JSON.stringify(manifest[field])} ` +
          `but the configured embedder has ${JSON.stringify(described[field])}`,
      );
    }
  }
  return manifest;
}

/**
 * Writes the manifest to a temp file beside it, fsyncs, then renames over the
 * final name, so a reader sees either the old manifest or the new one.
 */
export async function writeManifestAtomic(
  storePath: string,
  manifest: IndexManifest,
): Promise<void> {
  parseManifest(manifestPathFor(storePath), JSON.stringify(manifest));
  const path = manifestPathFor(storePath);
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    const handle = await open(tmp, "wx");
    try {
      await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}
