import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { config } from "../../shared/config";
import { parseLegalFile } from "../../graph/parser";
import type { ArticleClause, ArticleNode } from "../../shared/types";
import {
  type GeminiDocument,
} from "../../embeddings/embedder-gemini";
import {
  GEMINI_DOC_PREFIX,
} from "../../embeddings/index-manifest";
import {
  COMMUNITY_EXPORT,
  DATA_DIR,
  type Doc,
  EXPECTED_ARTICLES,
  type ReportRow,
} from "./constants-types";
import { sha256, withOldCopy, writeFileAtomic } from "./fingerprint-old-store";
import { log } from "./logger";

export function docText(title: string, content: string): string {
  return GEMINI_DOC_PREFIX.replace(/\{title\}|\{content\}/g, (m) =>
    m === "{title}" ? title : content,
  );
}

export function clauseContent(clause: ArticleClause): string {
  return `Khoản ${clause.clause_number}: ${clause.text}`;
}

export function reportContent(report: ReportRow): string {
  return `${report.summary}\n${report.findings}`;
}

export function documentNode(id: string, title: string, content: string): ArticleNode {
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

export function buildDocs(articles: ArticleNode[], reports: ReportRow[]): Doc[] {
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

export function toGeminiDocument(doc: Doc): GeminiDocument {
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

export function embeddedText(doc: Doc): string {
  const document = toGeminiDocument(doc);
  return docText(document.title, document.text);
}

export function sortReports(rows: ReportRow[]): ReportRow[] {
  return [...rows].sort(
    (a, b) => a.level - b.level || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export async function exportCommunityReports(copyStore: string): Promise<ReportRow[]> {
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

export async function loadInputs(): Promise<{
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

export async function loadReports(copyStore: string): Promise<ReportRow[]> {
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
