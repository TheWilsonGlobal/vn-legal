import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createVectorStore } from "congraphdb";
import { config } from "../../shared/config";
import type { IEmbedder } from "../../embeddings/embedder-factory";
import {
  createConGraphVectorStore,
  type ConGraphVectorStore,
} from "../../embeddings/congraph";
import {
  type Doc,
  EXPECTED_ARTICLES,
  EXPECTED_DIM,
  type Kind,
  KINDS,
  type OldStoreCounts,
  type Progress,
  SCRIPT_NAME,
  type StoreIds,
} from "./constants-types";
import {
  documentNode,
  toGeminiDocument,
} from "./document-builder";
import { vectorDimOf } from "./fingerprint-old-store";
import { log } from "./logger";
import {
  progressIds,
  progressPathFor,
  readProgressFile,
  saveProgress,
} from "./progress-guard";
import { asDocumentEmbedder } from "./token-cost-meter";

export async function smokeTest(embedder: IEmbedder): Promise<void> {
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

export function emptyStoreIds(): StoreIds {
  return { article: new Set(), clause: new Set(), report: new Set() };
}

const STORE_ID_QUERIES: Record<Kind, string> = {
  article: "MATCH (a:articles) RETURN a.article_id AS id",
  clause: "MATCH (c:clauses) RETURN c.clause_id AS id",
  report: "MATCH (r:community_reports) RETURN r.id AS id",
};

export async function readStoreIds(target: string): Promise<StoreIds> {
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

export async function persistChunk(
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

function emptyPending(): Record<Kind, Doc[]> {
  return { article: [], clause: [], report: [] };
}

export async function buildIndex(
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

export async function verifyTargetDims(target: string): Promise<void> {
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
