// ============================================================================
// RB1: non-destructive rebuild of the Gemini 768-d congraph index
// (plan §5.9: steps 1, 1a, 2-7)
// ============================================================================
//
// Modes (exactly one):
//   --smoke      step 1 only: one document embedding. Live Gemini call.
//   --offline    steps 0, 1a, 2, 3 and a labelled char-based estimate for step 4.
//                No Gemini call. Exits 3: partial, the live steps did not run.
//   --dry-run    steps 0, 1, 1a, 2, 3, 4. Exact token count via countTokens.
//                Writes nothing into the target store.
//   --build      guard, then steps 0-7. Refuses a target that has store files
//                but no .progress.json written by this script. Embeds through
//                embedDocuments in slices of EMBED_BATCH_SIZE x
//                EMBED_MAX_CONCURRENCY inputs, per kind (articles, clauses,
//                reports).
//
// Flags:
//   --run-dir <absolute path outside the repo>   default: OS temp directory
//
// Exit codes: 0 success for the mode, 1 a named step failed, 2 usage or
// configuration, 3 offline partial.
//
// The old store (storage/congraph_vectors.*) is only ever read through a temp
// copy. Its files are hashed before anything else and hashed again at the end.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
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
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { createVectorStore } from "congraphdb";
import { config, configIssues } from "../shared/config";
import { parseLegalFile } from "../graph/parser";
import { getEmbedder, type IEmbedder } from "../embeddings/embedder-factory";
import {
  createConGraphVectorStore,
  type ConGraphVectorStore,
} from "../embeddings/congraph";
import {
  estimateInputTokens,
  GEMINI_MAX_INPUT_TOKENS,
  type GeminiDocument,
  type GeminiEmbedder,
} from "../embeddings/embedder-gemini";
import {
  GEMINI_DOC_PREFIX,
  GEMINI_QUERY_PREFIX,
  LEGACY_TRANSFORMERS_DIM,
  LEGACY_TRANSFORMERS_INDEX_ID,
  LEGACY_TRANSFORMERS_MODEL,
  assertIndexManifest,
  assertServerEmbeddingConfig,
  describeEmbedder,
  hasManifest,
  manifestPathFor,
  writeManifestAtomic,
  type IndexManifest,
} from "../embeddings/index-manifest";
import type { ArticleClause, ArticleNode } from "../shared/types";

const SCRIPT_NAME = "rebuild-index-gemini";
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const STORAGE_DIR = join(REPO_ROOT, "storage");
const OLD_STORE = join(STORAGE_DIR, "congraph_vectors.cgraph");
const OLD_STORE_PREFIX = "congraph_vectors.";
const DATA_DIR = join(REPO_ROOT, "data");
const COMMUNITY_EXPORT = join(DATA_DIR, "community_reports.json");
const EXPECTED_ARTICLES = 689;
const EXPECTED_DIM = 768;
const INDEX_ID = "gemini-embedding-2-768";
const PRICE_PER_MILLION_TOKENS_USD = 0.2;
const COUNT_TOKENS_TIMEOUT_MS = 30_000;
const MAX_LIVE_CONCURRENCY = 2;

type Mode = "smoke" | "offline" | "dry-run" | "build";

/** A usage or configuration problem. Exit code 2. */
class UsageError extends Error {}

/** A named step failed. Exit code 1. */
class StepError extends Error {
  readonly step: string;

  constructor(step: string, detail: string) {
    super(detail);
    this.name = "StepError";
    this.step = step;
  }
}

interface FileRecord {
  name: string;
  size: number;
  sha256: string;
}

interface OldStoreCounts {
  articles: number;
  clauses: number;
  community_reports: number;
}

interface ReportRow {
  id: string;
  level: number;
  title: string;
  summary: string;
  findings: string;
  rating: number;
  parent_id: string | null;
}

type Kind = "article" | "clause" | "report";

const KINDS: Kind[] = ["article", "clause", "report"];

/** One embedded input. The node is kept so its row can be written once the vector is back. */
type Doc =
  | { kind: "article"; id: string; article: ArticleNode }
  | { kind: "clause"; id: string; article: ArticleNode; clause: ArticleClause }
  | { kind: "report"; id: string; report: ReportRow };

/** Ids already present in the target, per kind. */
type StoreIds = Record<Kind, Set<string>>;

interface Progress {
  written_by: string;
  target: string;
  started_at: string;
  updated_at: string;
  articles: string[];
  clauses: string[];
  community_reports: string[];
}

let logFile = "";

function log(line: string): void {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(text);
  appendFileSync(logFile, `${text}\n`, "utf-8");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  log(`STEP ${name}`);
  try {
    const result = await fn();
    log(`STEP ${name}: ok`);
    return result;
  } catch (error) {
    throw new StepError(name, errorMessage(error));
  }
}

function parseArgs(argv: string[]): { mode: Mode; runDir: string | undefined } {
  const modes: Mode[] = [];
  let runDir: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--smoke") modes.push("smoke");
    else if (arg === "--offline") modes.push("offline");
    else if (arg === "--dry-run") modes.push("dry-run");
    else if (arg === "--build") modes.push("build");
    else if (arg === "--run-dir") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new UsageError("--run-dir needs a path");
      }
      runDir = value;
      i += 1;
    } else {
      throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  if (modes.length !== 1) {
    throw new UsageError(
      "choose exactly one mode: --smoke | --offline | --dry-run | --build",
    );
  }
  return { mode: modes[0], runDir };
}

function checkConfig(): void {
  if (process.cwd() !== REPO_ROOT) {
    throw new UsageError(`run from the repo root: ${REPO_ROOT}`);
  }
  if (configIssues.length > 0) {
    throw new UsageError(configIssues.join("; "));
  }
  if (config.embedding.provider !== "gemini") {
    throw new UsageError(
      `EMBEDDING_PROVIDER must be "gemini" for this script (got ${config.embedding.provider ?? "unset"})`,
    );
  }
  assertServerEmbeddingConfig(config);
  if (config.embedding.dim !== EXPECTED_DIM) {
    throw new UsageError(`EMBEDDING_DIM must be ${EXPECTED_DIM}`);
  }
  const concurrency = config.embedding.maxConcurrency;
  if (!(concurrency >= 1 && concurrency <= MAX_LIVE_CONCURRENCY)) {
    throw new UsageError(
      `EMBED_MAX_CONCURRENCY must be 1 or ${MAX_LIVE_CONCURRENCY} for live Gemini runs`,
    );
  }
  if (!(config.embedding.batchSize >= 1)) {
    throw new UsageError("EMBED_BATCH_SIZE must be a positive integer");
  }
  if (!(config.embedding.maxTokensBudget >= 1)) {
    throw new UsageError("EMBED_MAX_TOKENS_BUDGET must be a positive integer");
  }
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function fingerprint(dir: string, name: string): Promise<FileRecord> {
  const path = join(dir, name);
  const info = await stat(path);
  const buffer = await readFile(path);
  return { name, size: info.size, sha256: sha256(buffer) };
}

async function listOldStoreFiles(): Promise<string[]> {
  const names = await readdir(STORAGE_DIR);
  const matches: string[] = [];
  for (const name of names) {
    if (!name.startsWith(OLD_STORE_PREFIX)) continue;
    if (name.endsWith(".manifest.json")) continue;
    if ((await stat(join(STORAGE_DIR, name))).isFile()) matches.push(name);
  }
  return matches.sort();
}

async function recordOldStore(label: string): Promise<FileRecord[]> {
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

/**
 * Re-hashes the files recorded at the start, by the names recorded then. A
 * store file that was not on that list but appeared during the run is also a
 * failure, so the directory is listed again for that check only.
 */
async function verifyOldStore(pre: FileRecord[]): Promise<void> {
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

function vectorDimOf(
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

/**
 * Opens the copy read-only and runs fn. The original store is never opened.
 */
async function withOldCopy<T>(
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

async function readOldCounts(copyStore: string): Promise<{
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

/** Order of the export and of the comparison with the file on disk. */
function sortReports(rows: ReportRow[]): ReportRow[] {
  return [...rows].sort(
    (a, b) => a.level - b.level || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

async function exportCommunityReports(copyStore: string): Promise<ReportRow[]> {
  return withOldCopy(copyStore, async (store) => {
    const result = await store.connection.query(
      "MATCH (r:community_reports) RETURN r.id AS id, r.level AS level, " +
        "r.title AS title, r.summary AS summary, r.findings AS findings, " +
        "r.rating AS rating, r.parent_id AS parent_id " +
        "ORDER BY r.level, r.id",
    );
    const rows = (await result.getAll()) as unknown as ReportRow[];
    return sortReports(
      rows.map((r) => ({
        id: r.id,
        level: r.level,
        title: r.title,
        summary: r.summary,
        findings: r.findings,
        rating: r.rating,
        parent_id: r.parent_id,
      })),
    );
  });
}

async function writeFileAtomic(path: string, text: string): Promise<void> {
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

/** Single-pass template fill, so "{content}" inside a title is not replaced. */
function docText(title: string, content: string): string {
  return GEMINI_DOC_PREFIX.replace(/\{title\}|\{content\}/g, (m) =>
    m === "{title}" ? title : content,
  );
}

function clauseContent(clause: ArticleClause): string {
  return `Khoản ${clause.clause_number}: ${clause.text}`;
}

function reportContent(report: ReportRow): string {
  return `${report.summary}\n${report.findings}`;
}

/** A document node for the embedder's single-document path (smoke test only). */
function documentNode(id: string, title: string, content: string): ArticleNode {
  return {
    id,
    article_number: 0,
    title,
    content,
    metadata: { part: "", chapter: "", section: "", subsection: "" },
    keywords: [],
    hierarchical_path: "",
    clause_count: 0,
    clauses: [],
  };
}

function buildDocs(articles: ArticleNode[], reports: ReportRow[]): Doc[] {
  const docs: Doc[] = [];
  for (const article of articles) {
    docs.push({ kind: "article", id: article.id, article });
  }
  for (const article of articles) {
    for (const clause of article.clauses) {
      docs.push({ kind: "clause", id: clause.id, article, clause });
    }
  }
  for (const report of reports) {
    docs.push({ kind: "report", id: report.id, report });
  }
  return docs;
}

/** The document the embedder receives. embedDocuments adds the title/text prefix. */
function toGeminiDocument(doc: Doc): GeminiDocument {
  if (doc.kind === "article") {
    return { id: doc.id, title: doc.article.title, text: doc.article.content };
  }
  if (doc.kind === "clause") {
    return {
      id: doc.id,
      title: doc.article.title,
      text: clauseContent(doc.clause),
    };
  }
  return {
    id: doc.id,
    title: doc.report.title,
    text: reportContent(doc.report),
  };
}

/**
 * The exact string the embedder sends for this document. The prefix matches
 * documentText() in embedder-gemini.ts, which is "title: T | text: C". The dry
 * run counts this string, so the count and the embedded text cannot drift.
 */
function embeddedText(doc: Doc): string {
  const document = toGeminiDocument(doc);
  return docText(document.title, document.text);
}

/**
 * Checks every input against the 8,192-token limit with the embedder's own
 * char-based estimate (not a tokenizer count). Returns the largest estimate.
 */
function checkEstimatedLimits(docs: Doc[]): number {
  let largest = 0;
  for (const doc of docs) {
    const estimate = estimateInputTokens(embeddedText(doc));
    if (estimate > GEMINI_MAX_INPUT_TOKENS) {
      throw new Error(
        `input ${doc.id} is over the ${GEMINI_MAX_INPUT_TOKENS}-token embedding limit: ` +
          `estimated ${estimate} tokens (an estimate, not a tokenizer count; ` +
          "the text is not truncated)",
      );
    }
    largest = Math.max(largest, estimate);
  }
  return largest;
}

/** Requests for a set of inputs: each kind goes out in chunks of batchSize. */
function plannedRequests(docs: Doc[]): number {
  const batch = config.embedding.batchSize;
  return KINDS.reduce(
    (n, kind) =>
      n + Math.ceil(docs.filter((d) => d.kind === kind).length / batch),
    0,
  );
}

function emptyStoreIds(): StoreIds {
  return { article: new Set(), clause: new Set(), report: new Set() };
}

/** The embedder's batch document path lives on GeminiEmbedder, not on IEmbedder. */
function asDocumentEmbedder(embedder: IEmbedder): GeminiEmbedder {
  if (
    typeof (embedder as Partial<GeminiEmbedder>).embedDocuments !== "function"
  ) {
    throw new Error(
      "embedder has no embedDocuments; EMBEDDING_PROVIDER must be gemini",
    );
  }
  return embedder as GeminiEmbedder;
}

async function countExactTokens(docs: Doc[]): Promise<number> {
  const ai = new GoogleGenAI({
    apiKey: config.embedding.apiKey,
    httpOptions: { timeout: COUNT_TOKENS_TIMEOUT_MS },
  });
  const texts = docs.map(embeddedText);
  const batch = config.embedding.batchSize;
  let total = 0;
  for (let i = 0; i < texts.length; i += batch) {
    const chunk = texts.slice(i, i + batch);
    const response = await ai.models.countTokens({
      model: config.embedding.model,
      contents: chunk.map((text) => ({ parts: [{ text }] })),
    });
    if (typeof response.totalTokens !== "number") {
      throw new Error("countTokens returned no totalTokens");
    }
    total += response.totalTokens;
  }
  return total;
}

function approximateTokens(docs: Doc[]): number {
  let chars = 0;
  for (const doc of docs) chars += [...embeddedText(doc)].length;
  return Math.ceil(chars / 4);
}

function costUsd(tokens: number): number {
  return (tokens * PRICE_PER_MILLION_TOKENS_USD) / 1_000_000;
}

function readProgressFile(
  path: string,
  text: string,
  target: string,
): Progress {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`progress file ${path} is not valid JSON`);
  }
  const p = parsed as Partial<Progress>;
  const arrays = [p.articles, p.clauses, p.community_reports];
  if (
    p.written_by !== SCRIPT_NAME ||
    !arrays.every(
      (a) => Array.isArray(a) && a.every((x) => typeof x === "string"),
    )
  ) {
    throw new Error(
      `progress file ${path} was not written by ${SCRIPT_NAME}; refusing to use it`,
    );
  }
  if (p.target !== target) {
    throw new Error(
      `progress file ${path} is for ${p.target}, not ${target}; refusing to use it`,
    );
  }
  return p as Progress;
}

function progressPathFor(target: string): string {
  return `${target}.progress.json`;
}

function progressIds(progress: Progress, kind: Kind): string[] {
  if (kind === "article") return progress.articles;
  if (kind === "clause") return progress.clauses;
  return progress.community_reports;
}

async function saveProgress(path: string, progress: Progress): Promise<void> {
  progress.updated_at = new Date().toISOString();
  await writeFileAtomic(path, `${JSON.stringify(progress, null, 2)}\n`);
}

/**
 * Refuses a target that already has store files, a manifest, or leftovers that
 * this script did not write. Only hashes files. It never opens them.
 */
async function buildGuard(target: string): Promise<void> {
  if (target === OLD_STORE) {
    throw new Error(
      "CONGRAPH_VECTOR_DB_PATH points at the old 384-d store; refusing",
    );
  }
  if (hasManifest(target)) {
    throw new Error(
      `target has an index manifest: ${manifestPathFor(target)}. It is already built or locked; refusing to build`,
    );
  }
  const dir = dirname(target);
  const stem = basename(target).replace(/\.cgraph$/, "");
  const leftovers: string[] = [];
  for (const name of await readdir(dir)) {
    if (!name.startsWith(`${stem}.`)) continue;
    if (name.endsWith(".progress.json") || name.endsWith(".manifest.json"))
      continue;
    leftovers.push(name);
  }
  for (const name of leftovers) {
    const rec = await fingerprint(dir, name);
    log(
      `GUARD leftover ${join(dir, rec.name)}\tsize=${rec.size}\tsha256=${rec.sha256}`,
    );
  }
  const progressPath = progressPathFor(target);
  if (existsSync(progressPath)) {
    readProgressFile(
      progressPath,
      await readFile(progressPath, "utf-8"),
      target,
    );
    return;
  }
  if (leftovers.length > 0) {
    throw new Error(
      `refusing --build: target store files already exist without a .progress.json written by ${SCRIPT_NAME}: ` +
        `${leftovers.map((n) => join(dir, n)).join(", ")}. ` +
        "Nothing was written, deleted or opened in them.",
    );
  }
}

async function smokeTest(embedder: IEmbedder): Promise<void> {
  const node = documentNode("smoke-1", "Smoke test", "One document embedding.");
  const vector = await embedder.embedArticle(node);
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  log(
    `SMOKE document embedding: length=${vector.length} l2norm=${norm.toFixed(6)}`,
  );
  if (vector.length !== EXPECTED_DIM || Math.abs(norm - 1) > 1e-3) {
    throw new Error(
      `smoke vector failed: length=${vector.length} (want ${EXPECTED_DIM}), l2norm=${norm} (want 1 +/- 1e-3)`,
    );
  }
}

async function protectOldStore(
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

async function writeLegacyManifest(counts: OldStoreCounts): Promise<void> {
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

async function loadInputs(): Promise<{
  articles: ArticleNode[];
  clauseCount: number;
  corpusSha256: string;
}> {
  const source = config.dataSourcePath;
  if (!existsSync(source)) {
    throw new Error(`DATA_SOURCE_PATH file not found: ${source}`);
  }
  const parsed = await parseLegalFile(source);
  const articles = Array.from(parsed.articles.values()) as ArticleNode[];
  if (articles.length !== EXPECTED_ARTICLES) {
    throw new Error(
      `expected ${EXPECTED_ARTICLES} articles in ${source}, parsed ${articles.length}`,
    );
  }
  const clauseCount = articles.reduce((n, a) => n + a.clauses.length, 0);
  const corpusSha256 = sha256(await readFile(source));
  log(
    `inputs: file=${source} articles=${articles.length} clauses=${clauseCount}`,
  );
  log(`inputs: corpus_sha256=${corpusSha256}`);
  return { articles, clauseCount, corpusSha256 };
}

async function loadReports(copyStore: string): Promise<ReportRow[]> {
  const fromCopy = await exportCommunityReports(copyStore);
  if (fromCopy.length === 0) {
    throw new Error(
      "community report export yielded 0 rows from the old store copy; escalating, no index is built without global-mode data",
    );
  }
  if (existsSync(COMMUNITY_EXPORT)) {
    const existing = sortReports(
      JSON.parse(await readFile(COMMUNITY_EXPORT, "utf-8")) as ReportRow[],
    );
    if (JSON.stringify(existing) !== JSON.stringify(fromCopy)) {
      throw new Error(
        `${COMMUNITY_EXPORT} exists and differs from the old store export (${existing.length} vs ${fromCopy.length} rows); not overwritten`,
      );
    }
    log(
      `community reports: ${COMMUNITY_EXPORT} already matches the export (${fromCopy.length} rows)`,
    );
    return fromCopy;
  }
  await mkdir(DATA_DIR, { recursive: true });
  await writeFileAtomic(
    COMMUNITY_EXPORT,
    `${JSON.stringify(fromCopy, null, 2)}\n`,
  );
  log(
    `community reports exported: ${COMMUNITY_EXPORT} rows=${fromCopy.length}`,
  );
  return fromCopy;
}

async function dryRun(docs: Doc[], offline: boolean): Promise<void> {
  const articles = docs.filter((d) => d.kind === "article").length;
  const clauses = docs.filter((d) => d.kind === "clause").length;
  const reports = docs.filter((d) => d.kind === "report").length;
  const inputs = docs.length;
  const largestEstimate = checkEstimatedLimits(docs);
  const requests = plannedRequests(docs);
  const budget = config.embedding.maxTokensBudget;
  const batch = config.embedding.batchSize;

  if (offline) {
    const approx = approximateTokens(docs);
    log(
      `DRY RUN (OFFLINE, NOT A GEMINI COUNT): inputs=${inputs} articles=${articles} ` +
        `clauses=${clauses} reports=${reports} batch=${batch} requests_planned=${requests}`,
    );
    log(
      `DRY RUN (OFFLINE): tokens_approx=${approx} (char-based approximation: chars/4, heuristic) ` +
        `est_cost_usd_approx=${costUsd(approx).toFixed(4)} budget=${budget}`,
    );
    log(
      `DRY RUN (OFFLINE): max_input_estimate_tokens=${largestEstimate} ` +
        `(limit ${GEMINI_MAX_INPUT_TOKENS}; char-based estimate, not a tokenizer count)`,
    );
    return;
  }

  let tokens: number;
  try {
    tokens = await countExactTokens(docs);
  } catch (error) {
    const approx = approximateTokens(docs);
    log(
      `DRY RUN: exact token count failed; char-based approximation for reference only: ` +
        `tokens_approx=${approx} (chars/4, heuristic, not a Gemini count)`,
    );
    throw error;
  }
  log(
    `DRY RUN: inputs=${inputs} articles=${articles} clauses=${clauses} ` +
      `reports=${reports} batch=${batch} requests_planned=${requests} tokens=${tokens} ` +
      `est_cost_usd=${costUsd(tokens).toFixed(4)} (at $${PRICE_PER_MILLION_TOKENS_USD}/1M input tokens, standard price; free tier may apply) ` +
      `budget=${budget}`,
  );
  log(
    `DRY RUN: max_input_estimate_tokens=${largestEstimate} ` +
      `(limit ${GEMINI_MAX_INPUT_TOKENS}; char-based estimate, not a tokenizer count)`,
  );
  if (tokens > budget) {
    throw new Error(
      `token total ${tokens} exceeds EMBED_MAX_TOKENS_BUDGET=${budget}; aborting`,
    );
  }
}

/** Ids already in the target, read on a read-only handle before the write handle opens. */
const STORE_ID_QUERIES: Record<Kind, string> = {
  article: "MATCH (a:articles) RETURN a.article_id AS id",
  clause: "MATCH (c:clauses) RETURN c.clause_id AS id",
  report: "MATCH (r:community_reports) RETURN r.id AS id",
};

async function readStoreIds(target: string): Promise<StoreIds> {
  const store = createVectorStore(target, { readOnly: true });
  try {
    await store.init();
    const ids = emptyStoreIds();
    for (const kind of KINDS) {
      const result = await store.connection.query(STORE_ID_QUERIES[kind]);
      const rows = (await result.getAll()) as unknown as Array<{ id: string }>;
      for (const row of rows) ids[kind].add(row.id);
    }
    return ids;
  } finally {
    await store.close();
  }
}

/**
 * Writes one request's worth of vectors, then records them in the progress file.
 * An id already in the store is skipped, so a crash between the add and the
 * progress save cannot write the same row twice.
 */
async function persistChunk(
  store: ConGraphVectorStore,
  progress: Progress,
  progressPath: string,
  storeIds: StoreIds,
  group: Doc[],
  vectors: number[][],
): Promise<void> {
  const articleRows: Parameters<ConGraphVectorStore["addArticles"]>[0] = [];
  const clauseRows: Parameters<ConGraphVectorStore["addClauses"]>[0] = [];
  const reportRows: Parameters<ConGraphVectorStore["addCommunityReports"]>[0] =
    [];
  const written: Record<Kind, string[]> = {
    article: [],
    clause: [],
    report: [],
  };
  group.forEach((doc, i) => {
    const vector = vectors[i];
    if (vector.length !== EXPECTED_DIM) {
      throw new Error(
        `vector length ${vector.length} for ${doc.kind} ${doc.id}, expected ${EXPECTED_DIM}`,
      );
    }
    if (storeIds[doc.kind].has(doc.id)) return;
    storeIds[doc.kind].add(doc.id);
    written[doc.kind].push(doc.id);
    if (doc.kind === "article") {
      const a = doc.article;
      articleRows.push({
        vector,
        article_id: a.id,
        article_number: a.article_number,
        title: a.title,
        part: a.metadata.part,
        chapter: a.metadata.chapter,
        section: a.metadata.section,
        subsection: a.metadata.subsection,
        keywords: a.keywords.join(", "),
        content: a.content,
      });
    } else if (doc.kind === "clause") {
      const a = doc.article;
      const c = doc.clause;
      clauseRows.push({
        vector,
        clause_id: c.id,
        article_id: a.id,
        clause_number: c.clause_number,
        text: c.text,
        article_title: a.title,
        part: a.metadata.part,
        chapter: a.metadata.chapter,
      });
    } else {
      const r = doc.report;
      reportRows.push({
        vector,
        id: r.id,
        level: r.level,
        title: r.title,
        summary: r.summary,
        findings: r.findings,
        rating: r.rating,
        parent_id: r.parent_id || "",
      });
    }
  });
  if (articleRows.length > 0) await store.addArticles(articleRows);
  if (clauseRows.length > 0) await store.addClauses(clauseRows);
  if (reportRows.length > 0) await store.addCommunityReports(reportRows);
  progress.articles.push(...written.article);
  progress.clauses.push(...written.clause);
  progress.community_reports.push(...written.report);
  await saveProgress(progressPath, progress);
}

async function buildIndex(
  target: string,
  docs: Doc[],
  clauseCount: number,
  reportCount: number,
  embedder: IEmbedder,
): Promise<OldStoreCounts> {
  const documents = asDocumentEmbedder(embedder);
  const progressPath = progressPathFor(target);
  let progress: Progress;
  let storeIds = emptyStoreIds();
  if (existsSync(progressPath)) {
    progress = readProgressFile(
      progressPath,
      await readFile(progressPath, "utf-8"),
      target,
    );
    const listed = KINDS.reduce(
      (n, kind) => n + progressIds(progress, kind).length,
      0,
    );
    if (listed > 0 && !existsSync(target)) {
      throw new Error(
        `progress file ${progressPath} lists ${listed} embedded rows but ${target} is missing; ` +
          "refusing to resume. Nothing was deleted or written.",
      );
    }
    if (existsSync(target)) storeIds = await readStoreIds(target);
    for (const kind of KINDS) {
      const missing = progressIds(progress, kind).filter(
        (id) => !storeIds[kind].has(id),
      );
      if (missing.length > 0) {
        throw new Error(
          `progress file lists ${missing.length} ${kind} ids the store does not contain ` +
            `(first: ${missing[0]}); refusing to resume`,
        );
      }
    }
    log(
      `resuming from ${progressPath}: stored articles=${storeIds.article.size} ` +
        `clauses=${storeIds.clause.size} reports=${storeIds.report.size}`,
    );
  } else {
    const now = new Date().toISOString();
    progress = {
      written_by: SCRIPT_NAME,
      target,
      started_at: now,
      updated_at: now,
      articles: [],
      clauses: [],
      community_reports: [],
    };
    await saveProgress(progressPath, progress);
  }

  const pending = emptyPending();
  for (const doc of docs) {
    if (!storeIds[doc.kind].has(doc.id)) pending[doc.kind].push(doc);
  }
  const pendingTotal = KINDS.reduce((n, kind) => n + pending[kind].length, 0);
  log(`build: ${pendingTotal} of ${docs.length} inputs pending`);

  const store = await createConGraphVectorStore();
  try {
    const slice = config.embedding.batchSize * config.embedding.maxConcurrency;
    for (const kind of KINDS) {
      const todo = pending[kind];
      for (let i = 0; i < todo.length; i += slice) {
        const group = todo.slice(i, i + slice);
        // Sequential: each slice finishes and is persisted before the next starts.
        // Within a slice, embedDocuments sends up to maxConcurrency requests.
        const vectors = await documents.embedDocuments(
          group.map(toGeminiDocument),
        );
        if (vectors.length !== group.length) {
          throw new Error(
            `embedder returned ${vectors.length} vectors for ${group.length} ${kind} inputs`,
          );
        }
        await persistChunk(
          store,
          progress,
          progressPath,
          storeIds,
          group,
          vectors,
        );
        log(
          `build progress: ${kind} ${Math.min(i + slice, todo.length)}/${todo.length}`,
        );
      }
    }
    await store.checkpoint();
    const stats = await store.getStats();
    const reports = await store.getCommunityReportCount();
    const counts: OldStoreCounts = {
      articles: stats.articleCount,
      clauses: stats.clauseCount,
      community_reports: reports,
    };
    if (
      counts.articles !== EXPECTED_ARTICLES ||
      counts.clauses !== clauseCount ||
      counts.community_reports !== reportCount
    ) {
      throw new Error(
        `row counts ${JSON.stringify(counts)} differ from source ` +
          `(articles ${EXPECTED_ARTICLES}, clauses ${clauseCount}, reports ${reportCount})`,
      );
    }
    return counts;
  } finally {
    await store.close();
  }
}

function emptyPending(): Record<Kind, Doc[]> {
  return { article: [], clause: [], report: [] };
}

async function verifyTargetDims(target: string): Promise<void> {
  const store = createVectorStore(target, { readOnly: true });
  try {
    await store.init();
    const tables = await store.getTables();
    for (const table of ["articles", "clauses", "community_reports"]) {
      const dim = vectorDimOf(tables, table);
      if (dim !== EXPECTED_DIM) {
        throw new Error(
          `table ${table} has vector dim ${dim}, expected ${EXPECTED_DIM}`,
        );
      }
    }
  } finally {
    await store.close();
  }
  log(`verify: all three tables have FLOAT_VECTOR[${EXPECTED_DIM}]`);
}

async function main(): Promise<number> {
  let mode: Mode;
  let runDir: string;
  try {
    const parsed = parseArgs(process.argv.slice(2));
    mode = parsed.mode;
    runDir = resolve(
      parsed.runDir ??
        join(
          tmpdir(),
          `${SCRIPT_NAME}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
        ),
    );
    const rel = relative(REPO_ROOT, runDir);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
      throw new UsageError("--run-dir must be outside the repo");
    }
    checkConfig();
  } catch (error) {
    console.error(`[${SCRIPT_NAME}] ${errorMessage(error)}`);
    return 2;
  }

  mkdirSync(runDir, { recursive: true });
  logFile = join(runDir, "run.log");
  const copyDir = join(runDir, "old-store-copy");
  const copyStore = join(copyDir, basename(OLD_STORE));
  const target = config.conGraphVectorDbPath;
  log(`mode=${mode} repo=${REPO_ROOT} run_dir=${runDir}`);
  log(`old store=${OLD_STORE} target=${target}`);
  log(
    `model=${config.embedding.model} dim=${config.embedding.dim} batch=${config.embedding.batchSize} concurrency=${config.embedding.maxConcurrency} budget=${config.embedding.maxTokensBudget}`,
  );

  let code = 0;
  let embedder: IEmbedder | undefined;
  let pre: FileRecord[] = [];
  try {
    pre = await step("0 hash old store (pre-run list)", () =>
      recordOldStore("PRE-RUN"),
    );
    if (mode === "build") {
      await step("0b build guard", () => buildGuard(target));
    }
    if (mode !== "offline") {
      embedder = await step("1 smoke: one document embedding", async () => {
        const e = await getEmbedder();
        await smokeTest(e);
        return e;
      });
    }
    if (mode === "smoke") {
      log("SMOKE ONLY: steps 1a-7 not run");
    } else {
      const counts = await step(
        "1a protect old store (copy, legacy manifest)",
        async () => {
          const c = await protectOldStore(pre, copyDir);
          await writeLegacyManifest(c);
          return c;
        },
      );
      const inputs = await step("2 inputs", () => loadInputs());
      const reports = await step("3 community reports export", () =>
        loadReports(copyStore),
      );
      const docs = buildDocs(inputs.articles, reports);
      if (mode === "offline") {
        await step("4 dry run (offline estimate)", () => dryRun(docs, true));
        log(
          "PARTIAL: offline steps only. Live smoke, live token count and build were not run.",
        );
        code = 3;
      } else {
        await step("4 dry run (exact count)", () => dryRun(docs, false));
        if (mode === "build") {
          if (!embedder)
            throw new StepError("5 build", "embedder not initialised");
          const built = await step("5 build", () =>
            buildIndex(
              target,
              docs,
              inputs.clauseCount,
              reports.length,
              embedder,
            ),
          );
          await step("6 verify", async () => {
            await verifyTargetDims(target);
            log(`verify: counts ${JSON.stringify(built)}`);
            log("recall@5 not computed (informational; ER1 gates)");
          });
          await step("7 manifest (written last)", async () => {
            const manifest: IndexManifest = {
              index_id: INDEX_ID,
              provider: "gemini",
              model: config.embedding.model,
              dim: EXPECTED_DIM,
              doc_prefix: GEMINI_DOC_PREFIX,
              query_prefix: GEMINI_QUERY_PREFIX,
              corpus_sha256: inputs.corpusSha256,
              counts: { ...built },
              created_at: new Date().toISOString(),
            };
            await writeManifestAtomic(target, manifest);
            await assertIndexManifest(target, describeEmbedder(config));
            log(`manifest written and read back: ${manifestPathFor(target)}`);
          });
        } else {
          log("DRY RUN complete. Nothing written to the target store.");
        }
      }
      log(`old store copy counts recorded: ${JSON.stringify(counts)}`);
    }
    if (code === 0) log(`RESULT: ${mode} succeeded`);
  } catch (error) {
    if (error instanceof StepError) {
      log(`FAILED at step "${error.step}": ${error.message}`);
    } else {
      log(`FAILED: ${errorMessage(error)}`);
    }
    code = 1;
  } finally {
    if (embedder) await embedder.dispose();
    await rm(copyDir, { recursive: true, force: true });
  }

  try {
    if (pre.length > 0) await verifyOldStore(pre);
    else throw new Error("no pre-run list was recorded");
  } catch (error) {
    log(
      `FAILED at step "8 end-of-run old store hash check": ${errorMessage(error)}`,
    );
    code = 1;
  }
  log(`exit=${code}`);
  return code;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`[${SCRIPT_NAME}] unexpected: ${errorMessage(error)}`);
    process.exit(1);
  },
);
