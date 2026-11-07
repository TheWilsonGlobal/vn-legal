import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { createVectorStore } from "congraphdb";
import {
  type IndexManifest,
  LEGACY_TRANSFORMERS_DIM,
  LEGACY_TRANSFORMERS_INDEX_ID,
  LEGACY_TRANSFORMERS_MODEL,
  manifestPathFor,
  writeManifestAtomic,
} from "../../embeddings/index-manifest";
import {
  type FileRecord,
  type OldStoreCounts,
  OLD_STORE,
  OLD_STORE_PREFIX,
  STORAGE_DIR,
} from "./constants-types";
import { log } from "./logger";

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function fingerprint(dir: string, name: string): Promise<FileRecord> {
  const path = join(dir, name);
  const info = await stat(path);
  const buffer = await readFile(path);
  return { name, size: info.size, sha256: sha256(buffer) };
}

export async function listOldStoreFiles(): Promise<string[]> {
  const names = await readdir(STORAGE_DIR);
  const matches: string[] = [];
  for (const name of names) {
    if (!name.startsWith(OLD_STORE_PREFIX)) continue;
    if (name.endsWith(".manifest.json")) continue;
    if ((await stat(join(STORAGE_DIR, name))).isFile()) matches.push(name);
  }
  return matches.sort();
}

export async function recordOldStore(label: string): Promise<FileRecord[]> {
  const names = await listOldStoreFiles();
  const records: FileRecord[] = [];
  for (const name of names) {
    const rec = await fingerprint(STORAGE_DIR, name);
    records.push(rec);
    log(`${label} ${rec.name}\tsize=${rec.size}\tsha256=${rec.sha256}`);
  }
  if (records.length === 0) {
    throw new Error(
      `no old store files matching ${OLD_STORE_PREFIX}* in ${STORAGE_DIR}`,
    );
  }
  return records;
}

export async function verifyOldStore(pre: FileRecord[]): Promise<void> {
  const mismatches: string[] = [];
  const now: FileRecord[] = [];
  for (const before of pre) {
    if (!existsSync(join(STORAGE_DIR, before.name))) {
      mismatches.push(`${before.name} disappeared`);
      continue;
    }
    const rec = await fingerprint(STORAGE_DIR, before.name);
    now.push(rec);
    if (before.size !== rec.size || before.sha256 !== rec.sha256) {
      mismatches.push(`${rec.name} changed`);
    }
  }
  const recorded = new Set(pre.map((r) => r.name));
  for (const name of await listOldStoreFiles()) {
    if (!recorded.has(name)) mismatches.push(`${name} appeared during the run`);
  }
  if (mismatches.length > 0) {
    throw new Error(`old store changed: ${mismatches.join("; ")}`);
  }
  for (const rec of now) {
    log(`END-OF-RUN ${rec.name}\tsize=${rec.size}\tsha256=${rec.sha256}`);
  }
  log(`END-OF-RUN old store: ${now.length} files match the pre-run list`);
}

export function vectorDimOf(
  tables: Array<{
    name: string;
    properties: Array<{ name: string; type: string }>;
  }>,
  table: string,
): number {
  const found = tables.find((t) => t.name === table);
  const prop = found?.properties.find((p) => p.name === "vector");
  const match = prop ? /^FLOAT_VECTOR\[(\d+)\]$/.exec(prop.type) : null;
  if (!match) {
    throw new Error(`table ${table} has no FLOAT_VECTOR vector column`);
  }
  return Number(match[1]);
}

export async function withOldCopy<T>(
  copyStore: string,
  fn: (store: ReturnType<typeof createVectorStore>) => Promise<T>,
): Promise<T> {
  const store = createVectorStore(copyStore, { readOnly: true });
  try {
    await store.init();
    return await fn(store);
  } finally {
    await store.close();
  }
}

export async function readOldCounts(copyStore: string): Promise<{
  counts: OldStoreCounts;
  vectorDim: number;
}> {
  return withOldCopy(copyStore, async (store) => {
    const counts: OldStoreCounts = {
      articles: await store.count("articles"),
      clauses: await store.count("clauses"),
      community_reports: await store.count("community_reports"),
    };
    const tables = await store.getTables();
    const vectorDim = vectorDimOf(tables, "articles");
    for (const table of ["clauses", "community_reports"]) {
      if (vectorDimOf(tables, table) !== vectorDim) {
        throw new Error(
          `vector dimension differs across tables in the old store`,
        );
      }
    }
    return { counts, vectorDim };
  });
}

export async function protectOldStore(
  pre: FileRecord[],
  copyDir: string,
): Promise<OldStoreCounts> {
  await mkdir(copyDir, { recursive: true });
  for (const rec of pre) {
    await copyFile(join(STORAGE_DIR, rec.name), join(copyDir, rec.name));
  }
  for (const rec of pre) {
    const copy = await fingerprint(copyDir, rec.name);
    if (copy.size !== rec.size || copy.sha256 !== rec.sha256) {
      throw new Error(`copy of ${rec.name} does not match the original`);
    }
  }
  const copyStore = join(copyDir, basename(OLD_STORE));
  const { counts, vectorDim } = await readOldCounts(copyStore);
  if (vectorDim !== LEGACY_TRANSFORMERS_DIM) {
    throw new Error(
      `old store vector dim is ${vectorDim}, expected ${LEGACY_TRANSFORMERS_DIM}`,
    );
  }
  log(
    `old store copy counts: articles=${counts.articles} clauses=${counts.clauses} ` +
      `community_reports=${counts.community_reports} vector_dim=${vectorDim}`,
  );
  return counts;
}

export async function writeLegacyManifest(counts: OldStoreCounts): Promise<void> {
  const legacy: IndexManifest = {
    index_id: LEGACY_TRANSFORMERS_INDEX_ID,
    provider: "transformers",
    model: LEGACY_TRANSFORMERS_MODEL,
    dim: LEGACY_TRANSFORMERS_DIM,
    doc_prefix: "",
    query_prefix: "",
    corpus_sha256: null,
    counts: { ...counts },
    created_at: new Date().toISOString(),
    legacy: true,
    written_by: "RB1",
  };
  const path = manifestPathFor(OLD_STORE);
  if (existsSync(path)) {
    const existing = JSON.parse(await readFile(path, "utf-8")) as IndexManifest;
    const same =
      existing.index_id === legacy.index_id &&
      existing.provider === legacy.provider &&
      existing.dim === legacy.dim &&
      existing.legacy === true &&
      JSON.stringify(existing.counts) === JSON.stringify(counts);
    if (!same) {
      throw new Error(
        `legacy manifest ${path} exists and does not match the old store`,
      );
    }
    log(`legacy manifest already present and matching: ${path}`);
    return;
  }
  await writeManifestAtomic(OLD_STORE, legacy);
  log(`legacy manifest written: ${path}`);
}

export async function writeFileAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    const handle = await open(tmp, "wx");
    try {
      await handle.writeFile(text, "utf-8");
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
