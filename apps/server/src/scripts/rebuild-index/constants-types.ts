import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ArticleClause, ArticleNode } from "../../shared/types";

export const SCRIPT_NAME = "rebuild-index-gemini";
export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);
export const STORAGE_DIR = join(REPO_ROOT, "storage");
export const OLD_STORE = join(STORAGE_DIR, "congraph_vectors.cgraph");
export const OLD_STORE_PREFIX = "congraph_vectors.";
export const DATA_DIR = join(REPO_ROOT, "data");
export const COMMUNITY_EXPORT = join(DATA_DIR, "community_reports.json");
export const EXPECTED_ARTICLES = 689;
export const EXPECTED_DIM = 768;
export const INDEX_ID = "gemini-embedding-2-768";
export const PRICE_PER_MILLION_TOKENS_USD = 0.2;
export const COUNT_TOKENS_TIMEOUT_MS = 30_000;
export const MAX_LIVE_CONCURRENCY = 2;

export type Mode = "smoke" | "offline" | "dry-run" | "build";

/** A usage or configuration problem. Exit code 2. */
export class UsageError extends Error {}

/** A named step failed. Exit code 1. */
export class StepError extends Error {
  readonly step: string;

  constructor(step: string, detail: string) {
    super(detail);
    this.name = "StepError";
    this.step = step;
  }
}

export interface FileRecord {
  name: string;
  size: number;
  sha256: string;
}

export interface OldStoreCounts {
  articles: number;
  clauses: number;
  community_reports: number;
}

export interface ReportRow {
  id: string;
  level: number;
  title: string;
  summary: string;
  findings: string;
  rating: number;
  parent_id: string | null;
}

export type Kind = "article" | "clause" | "report";

export const KINDS: Kind[] = ["article", "clause", "report"];

/** One embedded input. The node is kept so its row can be written once the vector is back. */
export type Doc =
  | { kind: "article"; id: string; article: ArticleNode }
  | { kind: "clause"; id: string; article: ArticleNode; clause: ArticleClause }
  | { kind: "report"; id: string; report: ReportRow };

/** Ids already present in the target, per kind. */
export type StoreIds = Record<Kind, Set<string>>;

export interface Progress {
  written_by: string;
  target: string;
  started_at: string;
  updated_at: string;
  articles: string[];
  clauses: string[];
  community_reports: string[];
}
