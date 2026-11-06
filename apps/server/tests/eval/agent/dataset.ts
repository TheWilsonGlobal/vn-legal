// Dataset loading and validation. Labels are checked against the corpus
// (data/Docs/Vietnam Civil Law.json), never against the system under test.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CASE_TYPES, type DatasetFile, type EvalCase } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
export const DATASET_PATH = resolve(here, "dataset.json");
export const CORPUS_PATH = resolve(
  here,
  "../../../../../data/Docs/Vietnam Civil Law.json",
);
export const SEED_DATASET_PATH = resolve(here, "../retrieval-dataset.json");

export interface CorpusArticle {
  id: string;
  article_number: number;
  title: string;
  content: string;
  metadata: { part?: string; chapter?: string };
}

export function loadCorpus(): CorpusArticle[] {
  return JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as CorpusArticle[];
}

export function loadDataset(): { file: DatasetFile; sha256: string } {
  const raw = readFileSync(DATASET_PATH);
  return {
    file: JSON.parse(raw.toString("utf8")) as DatasetFile,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
}

const ROUTES = new Set(["legal", "recall", "smalltalk"]);
const MAX_QUERY_CHARS = 1000; // C2 request limit

function referencesArticle(text: string, n: number): boolean {
  return new RegExp(`Điều\\s+${n}(?!\\d)`, "u").test(text);
}

/** Returns a list of problems; empty means the dataset is valid. */
export function validateDataset(
  file: DatasetFile,
  corpus: readonly CorpusArticle[],
  detectRecall: (q: string) => boolean,
): string[] {
  const errs: string[] = [];
  const byNumber = new Map(corpus.map((a) => [a.article_number, a]));
  const ids = new Set<string>();
  const counts: Record<string, number> = {};

  for (const c of file.cases) {
    const tag = c.id;
    if (!c.id || typeof c.id !== "string") errs.push(`case without id`);
    if (ids.has(c.id)) errs.push(`${tag}: duplicate id`);
    ids.add(c.id);
    if (!(CASE_TYPES as readonly string[]).includes(c.type)) {
      errs.push(`${tag}: invalid type ${c.type}`);
      continue;
    }
    counts[c.type] = (counts[c.type] ?? 0) + 1;
    if (!Array.isArray(c.turns) || c.turns.length === 0) {
      errs.push(`${tag}: no turns`);
      continue;
    }
    for (const t of c.turns) {
      if (!ROUTES.has(t.route)) errs.push(`${tag}: invalid route ${t.route}`);
      if (!t.query || t.query.length > MAX_QUERY_CHARS)
        errs.push(`${tag}: query empty or over ${MAX_QUERY_CHARS} chars`);
      if (!t.session) errs.push(`${tag}: turn without session label`);
      // The routing label must agree with the recall-intent rules in src/agent/memory/intent.ts.
      const wantsRecall = t.route === "recall";
      if (t.query && detectRecall(t.query) !== wantsRecall)
        errs.push(
          `${tag}: route ${t.route} but detectRecallIntent(${JSON.stringify(t.query)}) is ${!wantsRecall}`,
        );
    }
    if (!Array.isArray(c.gold_articles))
      errs.push(`${tag}: gold_articles missing`);
    for (const g of c.gold_articles ?? []) {
      if (!byNumber.has(g))
        errs.push(`${tag}: gold Điều ${g} is not in the corpus`);
    }
    errs.push(...validateByType(c, byNumber, corpus));
  }

  for (const type of CASE_TYPES) {
    const declared = file.meta.declared_counts[type] ?? 0;
    if ((counts[type] ?? 0) !== declared)
      errs.push(
        `count for ${type}: declared ${declared}, actual ${counts[type] ?? 0}`,
      );
  }
  if (file.meta.declared_total !== file.cases.length)
    errs.push(
      `declared_total ${file.meta.declared_total} != ${file.cases.length} cases`,
    );
  return errs;
}

function validateByType(
  c: EvalCase,
  byNumber: ReadonlyMap<number, CorpusArticle>,
  corpus: readonly CorpusArticle[],
): string[] {
  const e: string[] = [];
  const tag = c.id;
  const need = (cond: boolean, msg: string) => {
    if (!cond) e.push(`${tag}: ${msg}`);
  };
  const t0 = c.turns[0]?.query ?? "";
  switch (c.type) {
    case "seed":
      need(
        c.turns.length === 1 && c.gold_articles.length >= 1,
        "seed needs 1 turn and gold",
      );
      break;
    case "multi_hop": {
      need(c.gold_articles.length >= 2, "multi_hop needs >= 2 gold articles");
      const edge = c.gold_articles.some((a) =>
        c.gold_articles.some(
          (b) =>
            a !== b && referencesArticle(byNumber.get(a)?.content ?? "", b),
        ),
      );
      need(
        edge,
        "no gold article cites another gold article (no reference edge)",
      );
      need(
        c.expected_first_tool === "traverse_references",
        "expected_first_tool must be traverse_references",
      );
      break;
    }
    case "explicit_article": {
      need(
        c.gold_articles.length === 1,
        "explicit_article needs exactly 1 gold",
      );
      const n = c.gold_articles[0];
      need(referencesArticle(t0, n), `query does not name Điều ${n}`);
      need(
        (byNumber.get(n)?.title ?? "").startsWith(`Điều ${n}.`),
        `corpus title of ${n} does not start with "Điều ${n}."`,
      );
      need(
        c.expected_first_tool === "get_article",
        "expected_first_tool must be get_article",
      );
      break;
    }
    case "global": {
      const ch = c.gold_chapter;
      need(ch !== undefined, "global needs gold_chapter");
      need(c.gold_articles.length === 0, "global has no gold article ids");
      need(
        c.expected_first_tool === "get_community_context",
        "expected_first_tool must be get_community_context",
      );
      if (ch) {
        const members = corpus
          .filter((a) =>
            (a.metadata.chapter ?? "").startsWith(`Chương ${ch.label}:`),
          )
          .map((a) => a.article_number);
        need(members.length > 0, `corpus has no chapter ${ch.label}`);
        if (members.length > 0) {
          const lo = Math.min(...members);
          const hi = Math.max(...members);
          need(
            lo === ch.first && hi === ch.last,
            `chapter ${ch.label} spans ${lo}-${hi} in the corpus, dataset says ${ch.first}-${ch.last}`,
          );
          need(
            hi - lo + 1 === members.length,
            `chapter ${ch.label} is not contiguous in the corpus`,
          );
          const chapterTitle = (byNumber.get(lo)?.metadata.chapter ?? "")
            .split(":")
            .slice(1)
            .join(":")
            .trim()
            .replace(/[,.\s]+$/u, "")
            .toLowerCase();
          need(
            chapterTitle.length > 0 &&
              t0.normalize("NFC").toLowerCase().includes(chapterTitle),
            `query does not mention the chapter title "${chapterTitle}"`,
          );
        }
      }
      break;
    }
    case "small_talk":
      need(
        c.gold_articles.length === 0 && c.turns[0].route === "smalltalk",
        "small_talk: no gold, smalltalk route",
      );
      break;
    case "recall_basic": {
      need(
        c.turns.length === 2 && c.turns[1].route === "recall",
        "recall_basic: T1 + recall T2",
      );
      need(
        (c.answer_names ?? []).length > 0,
        "recall_basic needs answer_names",
      );
      for (const n of c.answer_names ?? [])
        need(referencesArticle(t0, n), `T1 does not name Điều ${n}`);
      break;
    }
    case "recall_fresh":
      need(
        c.turns.length === 1 && c.turns[0].route === "recall",
        "recall_fresh: single recall turn",
      );
      break;
    case "recall_far": {
      need(
        c.turns.length === 11,
        "recall_far: 10 factual turns + 1 recall turn",
      );
      need(
        c.turns[c.turns.length - 1].route === "recall",
        "recall_far: last turn is the recall",
      );
      need(c.recall_target_turn === 0, "recall_far: target is T1");
      need(
        new Set(c.turns.map((t) => t.query)).size === c.turns.length,
        "recall_far: duplicate queries",
      );
      break;
    }
    case "followup_window":
      need(
        c.turns.length === 2 && c.gold_articles.length >= 2,
        "followup_window: 2 turns, referent + neighbours as gold",
      );
      need(
        c.turns.every((t) => t.route === "legal"),
        "followup_window: both turns legal",
      );
      break;
    case "isolation":
      need(
        c.turns.length === 2 &&
          c.turns[0].session === "A" &&
          c.turns[1].session === "B",
        "isolation: turn 1 in session A, turn 2 in session B",
      );
      need((c.leak_markers ?? []).length > 0, "isolation needs leak_markers");
      for (const m of c.leak_markers ?? [])
        need(
          t0.includes(m),
          `leak marker ${JSON.stringify(m)} is not in the session A query`,
        );
      break;
    case "false_trigger":
      need(
        c.turns.length === 1 && c.turns[0].route === "legal",
        "false_trigger: single legal turn",
      );
      break;
  }
  return e;
}
