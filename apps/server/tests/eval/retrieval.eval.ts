// Retrieval eval for the Vietnamese Civil Code corpus.
//
// Each question in retrieval-dataset.json names the article(s) that answer it.
// The runner ranks every article with BM25 over its title and text and reports
// recall@K and MRR. It needs no LLM, no database and no installed packages, so
// it runs with plain `node`. Exit code 1 means recall@K fell below the gate.
//
// Usage: pnpm eval [--k 5] [--threshold 0.8] [--verbose]

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const corpusPath = resolve(
  here,
  "../../../../data/Docs/Vietnam Civil Law.json",
);
const datasetPath = resolve(here, "retrieval-dataset.json");

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
};
const K = argValue("--k", 5);
const THRESHOLD = argValue("--threshold", 0.8);
const verbose = args.includes("--verbose");

// Vietnamese function words that carry no article-specific signal.
const STOPWORDS = new Set([
  "la",
  "cua",
  "va",
  "co",
  "cac",
  "duoc",
  "do",
  "theo",
  "cho",
  "trong",
  "mot",
  "nhung",
  "gi",
  "thi",
  "ve",
  "voi",
  "khi",
  "nao",
  "bao",
  "nhieu",
  "khong",
  "the",
  "nay",
  "do",
  "tai",
  "tu",
  "den",
  "se",
  "bi",
  "hay",
  "hoac",
]);

// Lowercase, strip diacritics (đ -> d) so queries match with or without accents.
function normalise(text) {
  return text
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
}

function tokenise(text) {
  return normalise(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const dataset = JSON.parse(readFileSync(datasetPath, "utf8"));

const docs = corpus.map((a) => ({
  number: a.article_number,
  title: a.title,
  tokens: tokenise(`${a.title} ${a.title} ${a.content}`),
}));
const byNumber = new Set(docs.map((d) => d.number));

// Dataset validity: every label must point at an article that exists.
const missing = dataset.flatMap((q) =>
  q.expected.filter((n) => !byNumber.has(n)).map((n) => `${q.id}: Điều ${n}`),
);
if (missing.length > 0) {
  console.error("Dataset labels point at articles not in the corpus:");
  for (const m of missing) console.error(`  ${m}`);
  process.exit(2);
}

// BM25 over the article documents.
const K1 = 1.2;
const B = 0.75;
const avgLen = docs.reduce((s, d) => s + d.tokens.length, 0) / docs.length;
const df = new Map();
for (const d of docs) {
  for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
}
const N = docs.length;

function score(queryTokens, doc) {
  const tf = new Map();
  for (const t of doc.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  let s = 0;
  for (const q of new Set(queryTokens)) {
    const f = tf.get(q);
    if (!f) continue;
    const idf = Math.log(1 + (N - df.get(q) + 0.5) / (df.get(q) + 0.5));
    s +=
      (idf * f * (K1 + 1)) /
      (f + K1 * (1 - B + (B * doc.tokens.length) / avgLen));
  }
  return s;
}

function rank(question) {
  const q = tokenise(question);
  return docs
    .map((d) => ({ number: d.number, score: score(q, d) }))
    .sort((a, b) => b.score - a.score || a.number - b.number)
    .map((r) => r.number);
}

let hits = 0;
let reciprocal = 0;
for (const item of dataset) {
  const ranking = rank(item.question);
  const firstHit = ranking.findIndex((n) => item.expected.includes(n));
  const hit = firstHit >= 0 && firstHit < K;
  if (hit) hits += 1;
  reciprocal += firstHit >= 0 ? 1 / (firstHit + 1) : 0;
  const status = hit ? "PASS" : "MISS";
  const found = firstHit >= 0 ? `rank ${firstHit + 1}` : "not retrieved";
  console.log(
    `${status}  ${item.id.padEnd(24)} expected [${item.expected.join(", ")}] ${found}`,
  );
  if (verbose && !hit) {
    console.log(`        top ${K}: [${ranking.slice(0, K).join(", ")}]`);
  }
}

const recall = hits / dataset.length;
const mrr = reciprocal / dataset.length;
console.log("");
console.log(
  `questions: ${dataset.length}  recall@${K}: ${recall.toFixed(2)}  MRR: ${mrr.toFixed(2)}  gate: ${THRESHOLD}`,
);

if (recall < THRESHOLD) {
  console.error(`FAIL: recall@${K} ${recall.toFixed(2)} is below ${THRESHOLD}`);
  process.exit(1);
}
