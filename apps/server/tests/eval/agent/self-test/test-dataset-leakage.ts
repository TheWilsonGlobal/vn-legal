import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { detectRecallIntent } from "../../../../src/agent/memory/intent";
import {
  CORPUS_PATH,
  SEED_DATASET_PATH,
  loadCorpus,
  loadDataset,
  validateDataset,
} from "../dataset";
import { CASE_TYPES, type EvalCase } from "../types";
import { TestContext, same } from "./context";

export function runDatasetAndLeakageTests(ctx: TestContext) {
  const { check } = { check: ctx.check.bind(ctx) };

  // ---------------------------------------------------------------------------
  // 1. Dataset against the corpus
  // ---------------------------------------------------------------------------
  const corpus = loadCorpus();
  const { file: dataset, sha256 } = loadDataset();
  const problems = validateDataset(dataset, corpus, detectRecallIntent);
  check(
    "dataset: validates against the corpus and the recall-intent rules",
    problems.length === 0,
    problems.slice(0, 5).join(" | "),
  );
  check(
    "dataset: total is 58 cases",
    dataset.cases.length === 58,
    String(dataset.cases.length),
  );
  const expectedCounts: Record<string, number> = {
    seed: 16,
    multi_hop: 6,
    global: 4,
    explicit_article: 5,
    small_talk: 3,
    recall_basic: 4,
    recall_fresh: 3,
    recall_far: 2,
    followup_window: 4,
    isolation: 3,
    false_trigger: 8,
  };
  check(
    "dataset: per-type counts as built",
    CASE_TYPES.every(
      (t) =>
        dataset.cases.filter((c) => c.type === t).length === expectedCounts[t],
    ),
  );
  check("dataset: sha256 is a 64-hex digest", /^[0-9a-f]{64}$/.test(sha256));

  const seeds = JSON.parse(readFileSync(SEED_DATASET_PATH, "utf8")) as {
    id: string;
    question: string;
    expected: number[];
  }[];
  check(
    "dataset: the 16 seeds equal retrieval-dataset.json (ids, questions, gold)",
    seeds.length === 16 &&
      seeds.every((s) => {
        const c = dataset.cases.find((x) => x.id === `seed-${s.id}`);
        return (
          c &&
          c.turns[0].query === s.question &&
          same(c.gold_articles, s.expected)
        );
      }),
  );
  const mustHave = [
    "Câu đầu tiên của khoản 2 Điều 5 là gì?",
    "Phải thông báo trước bao lâu khi chấm dứt hợp đồng?",
  ];
  check(
    "dataset: the two briefed false_trigger negatives are present",
    mustHave.every((q) =>
      dataset.cases.some(
        (c) => c.type === "false_trigger" && c.turns[0].query === q,
      ),
    ),
  );
  check(
    "dataset: false_trigger queries are not recall intents, recall queries are (intent.ts)",
    dataset.cases
      .filter((c) => c.type === "false_trigger")
      .every((c) => !detectRecallIntent(c.turns[0].query)) &&
      dataset.cases
        .filter((c) => c.type === "recall_fresh")
        .every((c) => detectRecallIntent(c.turns[0].query)),
  );

  // The validator must catch bad data (negative tests on copies).
  const clone = () => JSON.parse(JSON.stringify(dataset)) as typeof dataset;
  {
    const d = clone();
    d.cases[0].gold_articles = [99999];
    check(
      "validator: flags a gold article missing from the corpus",
      validateDataset(d, corpus, detectRecallIntent).some((e) =>
        e.includes("99999"),
      ),
    );
    const d2 = clone();
    d2.cases[1].id = d2.cases[0].id;
    check(
      "validator: flags a duplicate id",
      validateDataset(d2, corpus, detectRecallIntent).some((e) =>
        e.includes("duplicate id"),
      ),
    );
    const d3 = clone();
    d3.meta.declared_counts.seed = 15;
    check(
      "validator: flags a count that differs from the declared one",
      validateDataset(d3, corpus, detectRecallIntent).some((e) =>
        e.includes("count for seed"),
      ),
    );
    const d4 = clone();
    const mh = d4.cases.find((c) => c.type === "multi_hop") as EvalCase;
    mh.gold_articles = [1, 2];
    check(
      "validator: flags a multi_hop case without a reference edge",
      validateDataset(d4, corpus, detectRecallIntent).some((e) =>
        e.includes("reference edge"),
      ),
    );
    const d5 = clone();
    (
      d5.cases.find((c) => c.type === "false_trigger") as EvalCase
    ).turns[0].route = "recall";
    check(
      "validator: flags a route label that disagrees with detectRecallIntent",
      validateDataset(d5, corpus, detectRecallIntent).some((e) =>
        e.includes("detectRecallIntent"),
      ),
    );
  }

  // Hand check of two multi-hop edges straight from the corpus text.
  const art = (n: number) => corpus.find((a) => a.article_number === n);
  check(
    "corpus: Điều 623 cites Điều 236 and Điều 140 cites Điều 134",
    /Điều\s+236(?!\d)/.test(art(623)?.content ?? "") &&
      /Điều\s+134(?!\d)/.test(art(140)?.content ?? ""),
  );
  check(
    "corpus: Điều 117 exists and its article_id is article_117",
    art(117)?.id === "article_117",
  );

  // ---------------------------------------------------------------------------
  // 2. No leakage: case ids and leak markers must not appear in application code or the corpus
  // ---------------------------------------------------------------------------
  function walk(dir: string, out: string[] = []): string[] {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|json|md)$/.test(f)) out.push(p);
    }
    return out;
  }
  const repo = resolve(CORPUS_PATH, "../../..");
  const scan = [
    ...walk(join(repo, "apps/server/src")),
    CORPUS_PATH,
    join(repo, "data/community_reports.json"),
  ];
  const texts = scan.map((p) => ({ p, t: readFileSync(p, "utf8") }));
  const ids = dataset.cases.map((c) => c.id);
  const markers = dataset.cases.flatMap((c) => c.leak_markers ?? []);
  const idHits = ids.filter((id) => texts.some((x) => x.t.includes(id)));
  const markerHits = markers.filter((m) => texts.some((x) => x.t.includes(m)));
  check(
    `leakage: no case id appears in ${scan.length} source/corpus files`,
    idHits.length === 0,
    idHits.join(","),
  );
  check(
    "leakage: no isolation marker appears in source/corpus files",
    markerHits.length === 0,
    markerHits.join(","),
  );
  const queryHits = new Set<string>();
  for (const c of dataset.cases)
    for (const t of c.turns)
      for (const x of texts)
        if (
          x.p.startsWith(join(repo, "apps/server/src")) &&
          x.t.includes(t.query)
        )
          queryHits.add(`${c.id} in ${x.p.slice(repo.length + 1)}`);
  console.log(
    `info  exact query strings also present in src (UI suggestion lists are expected): ${queryHits.size ? [...queryHits].join("; ") : "none"}`,
  );
}
