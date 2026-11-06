// Self-test of the agent eval suite. MODE: mock. Scorers, report assembly and the
// dataset validator are exercised on hand-written fixtures and on the corpus.
// NO KPI IS CLAIMED FROM THIS RUN: the fixtures are invented, not model output.
//
//   pnpm exec tsx apps/server/tests/eval/agent/self-test.ts      (exit 0 = all checks pass)

import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  AgentRunResponse,
  AgentStep,
  Citation,
} from "../../../src/agent/contract";
import { detectRecallIntent } from "../../../src/agent/memory/intent";
import { loadBl2 } from "./bl2-load";
import {
  rankedArticles,
  recallAtK,
  reciprocalRank,
  scoreBl2Case,
  summarizeBl2,
} from "./bl2-metrics";
import {
  CookieJar,
  type Header,
  checkAgainstHeader,
  classifyFailure,
} from "./client";
import {
  TOKENS_PER_LEGACY_CALL,
  TOKENS_PER_LLM_CALL,
  CostGuardError,
  assertWithinBudget,
  estimateTokens,
  exceedsTokenBudget,
  parseBudget,
  sumReportedTokens,
} from "./cost";
import {
  CORPUS_PATH,
  SEED_DATASET_PATH,
  loadCorpus,
  loadDataset,
  validateDataset,
} from "./dataset";
import { buildLangfuseScores, langfuseTagNote, pushScores } from "./langfuse";
import {
  assertLegacyPrecondition,
  effectiveEnv,
  isTemplateFallback,
  parseLegacyBody,
} from "./legacy";
import {
  type ReportInput,
  buildReport,
  computeKpiRows,
  kpiGateFailures,
  toMarkdown,
  writeReport,
} from "./report";
import {
  aggregate,
  assertsPriorQuestion,
  chapterHit,
  checkToolCall,
  citationRecall,
  citedArticles,
  compareBl1,
  namesAnyArticle,
  namesArticle,
  scoreCase,
} from "./scorers";
import { mean, percentile, rate, wilson } from "./stats";
import { KPI_DEFS, meetsTarget } from "./thresholds";
import {
  CASE_TYPES,
  type CaseRun,
  type EvalCase,
  type LegacyOutcome,
  type TurnOutcome,
} from "./types";

let failures = 0;
let total = 0;
function check(name: string, ok: boolean, detail = ""): void {
  total += 1;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : detail ? `  -> ${detail}` : ""}`,
  );
}
const approx = (a: number | null, b: number, eps = 1e-6) =>
  a !== null && Math.abs(a - b) <= eps;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

console.log(
  "MODE: mock (self-test on hand-written fixtures; no KPI is claimed)\n",
);

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

// ---------------------------------------------------------------------------
// 3. Statistics and scorer fixtures, worked by hand
// ---------------------------------------------------------------------------
check(
  "percentile: nearest-rank p50 of [10..50] is 30, p95 is 50",
  percentile([50, 10, 30, 20, 40], 50) === 30 &&
    percentile([50, 10, 30, 20, 40], 95) === 50,
);
const oneTo20 = Array.from({ length: 20 }, (_, i) => i + 1);
check(
  "percentile: p95 of 1..20 is 19, p50 is 10",
  percentile(oneTo20, 95) === 19 && percentile(oneTo20, 50) === 10,
);
check("percentile: empty list is null", percentile([], 95) === null);
{
  const w0 = wilson(0, 30) as [number, number];
  const w5 = wilson(5, 10) as [number, number];
  check(
    "wilson: 0/30 upper bound is z^2/(n+z^2) = 0.11352",
    approx(w0[0], 0, 1e-9) && approx(w0[1], 0.11352, 1e-4),
    String(w0),
  );
  check(
    "wilson: 5/10 is [0.2366, 0.7634]",
    approx(w5[0], 0.2366, 1e-3) && approx(w5[1], 0.7634, 1e-3),
    String(w5),
  );
  check(
    "rate: n=0 has null value and null interval",
    rate(0, 0).value === null && rate(0, 0).ci === null,
  );
  check("mean: [1,0.5] is 0.75", mean([1, 0.5]) === 0.75);
}
check(
  "citationRecall: gold [117,119] cited {117} = 0.5",
  citationRecall([117, 119], new Set([117])) === 0.5,
);
check(
  "citationRecall: gold [25] cited {25,26} = 1; no gold = null",
  citationRecall([25], new Set([25, 26])) === 1 &&
    citationRecall([], new Set([1])) === null,
);
check(
  "namesArticle: Điều 25 matches 'Điều 25', 'điều  25', not 'Điều 250'",
  namesArticle("Theo Điều 25", 25) &&
    namesArticle("theo điều  25.", 25) &&
    !namesArticle("Điều 250", 25),
);
check(
  "namesAnyArticle",
  namesAnyArticle("xem Điều 3") && !namesAnyArticle("không có điều khoản nào"),
);
check(
  "checkToolCall: valid get_article",
  checkToolCall("get_article", '{"article_number":25}') === null,
);
check(
  "checkToolCall: string article_number fails zod",
  checkToolCall("get_article", '{"article_number":"25"}') ===
    "arguments fail zod",
);
check(
  "checkToolCall: malformed JSON",
  checkToolCall("get_article", "{bad") === "malformed JSON",
);
check(
  "checkToolCall: unknown tool",
  (checkToolCall("web_search", '{"q":"x"}') ?? "").startsWith("unknown tool"),
);
check(
  "checkToolCall: traverse_references accepts article_id or query, rejects empty",
  checkToolCall("traverse_references", '{"query":"x"}') === null &&
    checkToolCall("traverse_references", '{"article_id":"article_62"}') ===
      null &&
    checkToolCall("traverse_references", '{"article_id":""}') !== null,
);
check(
  "checkToolCall: null tool_input is malformed",
  checkToolCall("recall_session", null) !== null,
);
{
  const cit = (n: number, crumb: string[] = []): Citation => ({
    article_id: `article_${n}`,
    article_number: n,
    breadcrumb: crumb,
    via: "vector",
  });
  const o = (cs: Citation[]): AgentStep => ({
    index: 1,
    kind: "observation",
    content: "",
    tool: "x",
    tool_input: null,
    ok: true,
    duration_ms: 0,
    citations: cs,
  });
  check(
    "citedArticles: union over observations, ignores other step kinds",
    same(
      [
        ...citedArticles([
          o([cit(1)]),
          o([cit(2), cit(1)]),
          { ...o([cit(9)]), kind: "thought" },
        ]),
      ].sort(),
      [1, 2],
    ),
  );
  const ch = { label: "XXIII", first: 649, last: 655 };
  check(
    "chapterHit: article inside the range",
    chapterHit([o([cit(650)])], ch),
  );
  check(
    "chapterHit: breadcrumb 'Chương XXIII: …' matches outside the range",
    chapterHit([o([cit(700, ["Chương XXIII: THỪA KẾ"])])], ch),
  );
  check(
    "chapterHit: label X does not match 'Chương XI'",
    !chapterHit([o([cit(1, ["Chương XI"])])], {
      label: "X",
      first: 144,
      last: 157,
    }),
  );
  check(
    "chapterHit: label III does not match 'Chương XIII'",
    !chapterHit([o([cit(1, ["Chương XIII"])])], {
      label: "III",
      first: 16,
      last: 73,
    }),
  );
}

// --- fixture world -------------------------------------------------------------------------
const cit = (
  n: number,
  crumb: string[] = ["Bộ luật Dân sự 2015", "Chương I"],
): Citation => ({
  article_id: `article_${n}`,
  article_number: n,
  breadcrumb: crumb,
  via: "vector",
});
let ix = 0;
const act = (tool: string, input: string | null): AgentStep => ({
  index: ++ix,
  kind: "action",
  content: `Model chose ${tool}`,
  tool,
  tool_input: input,
  ok: true,
  duration_ms: 0,
});
const obs = (content: string, cs: number[] = []): AgentStep => ({
  index: ++ix,
  kind: "observation",
  content,
  tool: null,
  tool_input: null,
  ok: true,
  duration_ms: 5,
  citations: cs.map((n) => cit(n)),
});
const emptyContext: AgentRunResponse["context"] = {
  query: "",
  seed_articles: [],
  path_context: [],
  community_context: {
    hierarchical_context: "",
    part: undefined,
    chapter: undefined,
    section: undefined,
    subsection: undefined,
  },
  relevant_concepts: [],
  community_reports: [],
};
function ok(
  steps: AgentStep[],
  answer: string,
  wall = 100,
  tokens: number | null = 100,
): TurnOutcome {
  ix = 0;
  return {
    ok: true,
    wall_ms: wall,
    response: {
      session_id: "s",
      run_id: "r",
      answer,
      steps,
      tool_mode: "native",
      provider: "gemini",
      model: "fixture-model",
      endpoint: "fixture",
      embedding: {
        provider: "gemini",
        model: "fixture",
        dim: 768,
        index_id: "fixture-index",
      },
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: tokens,
      context: emptyContext,
      duration_ms: wall,
      memory: {
        window_turns: 0,
        window_tokens: 0,
        summarized_turns: 0,
        recalled: 0,
      },
      trace_id: null,
      trace_url: null,
    },
  };
}
const T = (
  query: string,
  route: "legal" | "recall" | "smalltalk" = "legal",
  session = "main",
) => ({ session, query, route });
const mk = (
  id: string,
  type: EvalCase["type"],
  turns: EvalCase["turns"],
  extra: Partial<EvalCase> = {},
): EvalCase => ({ id, type, turns, gold_articles: [], ...extra });
const run = (c: EvalCase, turns: TurnOutcome[]): CaseRun => ({
  case: c,
  turns,
});

const FRESH = "chưa có nội dung nào trước đó trong phiên này.";
const Q25 = "Quyền nhân thân theo Điều 25 là gì?";
const runs: CaseRun[] = [];
const push = (c: EvalCase, turns: TurnOutcome[]) =>
  void runs.push(run(c, turns));

// F1 explicit ok
ix = 0;
push(
  mk("F1", "explicit_article", [T("Điều 8?")], {
    gold_articles: [8],
    expected_first_tool: "get_article",
  }),
  [
    ok(
      [act("get_article", '{"article_number":8}'), obs("text", [8])],
      "Điều 8 quy định căn cứ xác lập quyền dân sự",
      1000,
    ),
  ],
);
// F2 multi-hop wrong first tool, one invalid call
push(
  mk("F2", "multi_hop", [T("mh?")], {
    gold_articles: [623, 236],
    expected_first_tool: "traverse_references",
  }),
  [
    ok(
      [
        act("search_legal_articles", '{"query":"x"}'),
        obs("t", [623]),
        act("web_search", '{"q":"x"}'),
        obs("err"),
      ],
      "Theo Điều 623",
      3000,
      200,
    ),
  ],
);
// F3 global, budget exhausted (4 calls), tokens unreported
push(
  mk("F3", "global", [T("tóm tắt?")], {
    gold_chapter: { label: "XXIII", first: 649, last: 655 },
    expected_first_tool: "get_community_context",
  }),
  [
    ok(
      [1, 2, 3, 4].flatMap(() => [
        act("get_community_context", '{"query":"c"}'),
        obs("c", [1]),
      ]),
      "tóm tắt",
      5000,
      null,
    ),
  ],
);
// F4 recall_basic ok
push(
  mk("F4", "recall_basic", [T(Q25), T("Tôi vừa hỏi về điều nào?", "recall")], {
    answer_names: [25],
  }),
  [
    ok(
      [act("get_article", '{"article_number":25}'), obs("t", [25])],
      "Điều 25 nói về quyền nhân thân",
    ),
    ok(
      [act("recall_session", '{"key":"vừa hỏi"}'), obs(`[query] ${Q25}`)],
      "Bạn vừa hỏi về Điều 25",
      700,
    ),
  ],
);
// F5 recall_fresh, fabricated (names an article)
push(mk("F5", "recall_fresh", [T("Tôi đã hỏi gì trước đó?", "recall")]), [
  ok(
    [act("recall_session", '{"key":"trước đó"}'), obs(FRESH)],
    "Bạn chưa hỏi gì trước đó; hãy hỏi về Điều 25.",
  ),
]);
// F6 recall_fresh, clean
push(mk("F6", "recall_fresh", [T("Lúc nãy tôi hỏi gì vậy?", "recall")]), [
  ok(
    [act("recall_session", '{"key":"lúc nãy"}'), obs(FRESH)],
    "Chưa có câu hỏi nào trước đó.",
  ),
]);
// F7 isolation leak, F8 isolation clean
push(
  mk(
    "F7",
    "isolation",
    [
      T("Ông Lê Hoàng Tuấn muốn đổi họ?", "legal", "A"),
      T("Tôi đã hỏi gì?", "recall", "B"),
    ],
    { leak_markers: ["Lê Hoàng Tuấn"], leak_topics: ["đổi họ"] },
  ),
  [
    ok([act("search_legal_articles", '{"query":"a"}'), obs("t")], "a"),
    ok(
      [act("recall_session", '{"key":"đã hỏi"}'), obs(FRESH)],
      "Bạn đã hỏi về ông Lê Hoàng Tuấn",
    ),
  ],
);
push(
  mk(
    "F8",
    "isolation",
    [
      T("Công ty Hải Âu Xanh giao sai?", "legal", "A"),
      T("Tôi đã hỏi gì?", "recall", "B"),
    ],
    { leak_markers: ["Hải Âu Xanh"], leak_topics: ["giao sai"] },
  ),
  [
    ok([act("search_legal_articles", '{"query":"a"}'), obs("t")], "a"),
    ok(
      [act("recall_session", '{"key":"đã hỏi"}'), obs(FRESH)],
      "Chưa có câu hỏi nào trước đó.",
    ),
  ],
);
// F9 false trigger fired, F10 clean
push(mk("F9", "false_trigger", [T("Phải thông báo trước bao lâu?")]), [
  ok([act("recall_session", '{"key":"trước"}'), obs("x")], "x"),
]);
push(mk("F10", "false_trigger", [T("Câu đầu tiên của khoản 2 Điều 5?")]), [
  ok([act("search_legal_articles", '{"query":"q"}'), obs("x", [5])], "x"),
]);
// F11 errored (429 beyond the retry budget)
push(mk("F11", "seed", [T("seed?")], { gold_articles: [117, 119] }), [
  {
    ok: false,
    wall_ms: 10_000,
    error: { kind: "rate_limited", status: 502, detail: "x" },
  },
]);
// F12 followup ok (gold hit, no recall)
push(
  mk("F12", "followup_window", [T("Giám hộ?"), T("Người đó có nghĩa vụ gì?")], {
    gold_articles: [46, 48, 55],
  }),
  [
    ok([], "t1"),
    ok(
      [act("search_legal_articles", '{"query":"nghĩa vụ"}'), obs("t", [55])],
      "Họ phải chăm sóc",
    ),
  ],
);
// F13 recall_far ok
push(
  mk(
    "F13",
    "recall_far",
    [
      T("FAR-FIRST-QUERY-ABC"),
      T("filler"),
      T("Câu hỏi đầu tiên của tôi là gì?", "recall"),
    ],
    { recall_target_turn: 0 },
  ),
  [
    ok([], "a"),
    ok([], "b"),
    ok(
      [
        act("recall_session", '{"key":"câu hỏi đầu tiên của tôi"}'),
        obs("[query] FAR-FIRST-QUERY-ABC"),
      ],
      "Câu đầu tiên là FAR-FIRST-QUERY-ABC",
    ),
  ],
);
// F14 recall_basic failing (answer does not name Điều 25)
push(
  mk("F14", "recall_basic", [T(Q25), T("Tôi vừa hỏi về điều nào?", "recall")], {
    answer_names: [25],
  }),
  [
    ok([act("get_article", '{"article_number":25}'), obs("t", [25])], "ok"),
    ok(
      [act("recall_session", '{"key":"vừa hỏi"}'), obs(`[query] ${Q25}`)],
      "Bạn vừa hỏi về quyền nhân thân",
    ),
  ],
);

const ctx = { max_steps: 4, all_queries: [Q25, "Hợp đồng mua bán tài sản"] };
const scores = runs.map((r) => scoreCase(r, ctx));
const S = (id: string) =>
  scores.find((s) => s.case_id === id) as (typeof scores)[number];

check(
  "scoreCase F1: recall 1, tool choice ok, answer cites gold, not exhausted",
  S("F1").citation_recall === 1 &&
    S("F1").tool_choice_ok === true &&
    S("F1").answer_cites_gold === true &&
    S("F1").budget_exhausted === false,
);
check(
  "scoreCase F2: recall 0.5, wrong first tool, 1 invalid of 2 calls",
  S("F2").citation_recall === 0.5 &&
    S("F2").tool_choice_ok === false &&
    S("F2").tool_calls === 2 &&
    S("F2").invalid_calls === 1,
);
check(
  "scoreCase F3: 4 calls at max_steps 4 and no chapter hit = budget exhausted; null tokens counted as unreported",
  S("F3").budget_exhausted === true &&
    S("F3").tool_choice_ok === true &&
    S("F3").tokens_unreported === 1 &&
    S("F3").total_tokens === 0,
);
check(
  "scoreCase F4: recall_basic needs called + T1 in observation + Điều 25 in answer",
  S("F4").recall_ok === true,
);
check(
  "scoreCase F14: recall_basic fails when the answer names no article",
  S("F14").recall_ok === false &&
    S("F14").checks.answer_names_article === false,
);
check(
  "scoreCase F5: recall_fresh answer naming an article is fabricated",
  S("F5").fabricated === true && S("F5").recall_ok === false,
);
check(
  "scoreCase F6: clean recall_fresh is not fabricated and passes",
  S("F6").fabricated === false && S("F6").recall_ok === true,
);
check(
  "scoreCase F7: marker of session A in B's answer is a leak",
  S("F7").isolation_leak === true,
);
check(
  "scoreCase F8: clean isolation has no leak",
  S("F8").isolation_leak === false,
);
check(
  "scoreCase F9/F10: recall_session called on a false_trigger case is detected",
  S("F9").recall_called === true && S("F10").recall_called === false,
);
check(
  "scoreCase F11: a 429 error marks the case errored and scores nothing",
  S("F11").errored === true &&
    S("F11").citation_recall === null &&
    (S("F11").error ?? "").startsWith("rate_limited"),
);
check(
  "scoreCase F12: followup passes when a gold neighbour is in T2 citations, without recall",
  S("F12").recall_ok === true &&
    S("F12").recall_called === false &&
    approx(S("F12").citation_recall, 1 / 3),
);
check(
  "scoreCase F13: recall_far needs the T1 query in the recall observation",
  S("F13").recall_ok === true,
);

const agg = aggregate(scores);
check(
  "aggregate: 14 cases, 1 errored (F11)",
  agg.n_cases === 14 && agg.n_errored === 1 && same(agg.errored_ids, ["F11"]),
);
check(
  "aggregate: run error rate 1/14",
  agg.run_error.k === 1 && agg.run_error.n === 14,
);
check(
  "aggregate: invalid tool-call rate 1/21 (21 calls, errored cases included)",
  agg.invalid_tool_call.k === 1 && agg.invalid_tool_call.n === 21,
  `${agg.invalid_tool_call.k}/${agg.invalid_tool_call.n}`,
);
check(
  "aggregate: tool-choice accuracy 2/3",
  agg.tool_choice.k === 2 && agg.tool_choice.n === 3,
);
check(
  "aggregate: budget-exhausted 2/4 (F3 exhausted; errored seed F11 stays in n and counts as a failure)",
  agg.budget_exhausted.k === 2 &&
    agg.budget_exhausted.n === 4 &&
    same(agg.failing.budget_exhausted, ["F3", "F11"]) &&
    same(agg.errored_by_kpi.budget_exhausted, ["F11"]),
  `${agg.budget_exhausted.k}/${agg.budget_exhausted.n}`,
);
check(
  "aggregate: recall accuracy 3/4 (F4, F12, F13 pass; F14 fails)",
  agg.recall_accuracy.k === 3 &&
    agg.recall_accuracy.n === 4 &&
    same(agg.failing.recall, ["F14"]),
);
check(
  "aggregate: isolation leak 1/2, fabricated 1/2",
  agg.isolation_leak.k === 1 &&
    agg.isolation_leak.n === 2 &&
    agg.fabricated_recall.k === 1 &&
    agg.fabricated_recall.n === 2,
);
check(
  "aggregate: false recall triggers 1/2 on false_trigger; 2/6 on all non-recall single-turn cases (F9 fired, errored F11 counted)",
  agg.false_recall_trigger.k === 1 &&
    agg.false_recall_trigger.n === 2 &&
    agg.recall_calls_on_non_recall_cases.k === 2 &&
    agg.recall_calls_on_non_recall_cases.n === 6,
  `${agg.recall_calls_on_non_recall_cases.k}/${agg.recall_calls_on_non_recall_cases.n}`,
);
check(
  "aggregate: answer-citation rate 2/3",
  agg.answer_citation_rate.k === 2 && agg.answer_citation_rate.n === 3,
);
check(
  "aggregate: mean citation recall (1, 0.5, 0, 1/3) = 0.458333, n=4",
  approx(agg.citation_recall_mean, 0.458333, 1e-5) &&
    agg.citation_recall_n === 4,
);
check(
  "aggregate: steps per run 42/20 = 2.1; latency n=20; tokens 2000 with 1 unreported",
  approx(agg.steps_per_run_mean, 2.1) &&
    agg.steps_per_run_n === 20 &&
    agg.latency_n === 20 &&
    agg.total_tokens === 2000 &&
    agg.tokens_unreported_runs === 1,
  JSON.stringify([
    agg.steps_per_run_mean,
    agg.steps_per_run_n,
    agg.latency_n,
    agg.total_tokens,
    agg.tokens_unreported_runs,
  ]),
);

// --- BL1 -------------------------------------------------------------------------------------
const legacyOk = (cited: number[], wall: number): LegacyOutcome => ({
  ok: true,
  cited_articles: cited,
  wall_ms: wall,
});
const legacy1 = new Map<string, LegacyOutcome>([
  ["F1", legacyOk([8, 9], 2000)],
  ["F2", legacyOk([623], 6000)],
  [
    "F11",
    {
      ok: false,
      wall_ms: 1,
      error: { kind: "legacy_template_fallback", detail: "x" },
    },
  ],
]);
const bl1 = compareBl1(runs, scores, legacy1);
check(
  "BL1: 2 paired cases, legacy template fallback listed as an error and excluded",
  bl1.n_cases === 3 &&
    bl1.n_paired === 2 &&
    bl1.legacy_errors.length === 1 &&
    same(bl1.agent_errors_in_bl1_set, ["F11"]),
);
check(
  "BL1: agent 0.75 vs legacy 0.75, delta 0",
  approx(bl1.agent_mean_recall, 0.75) &&
    approx(bl1.legacy_mean_recall, 0.75) &&
    approx(bl1.delta, 0),
);
check(
  "BL1: p95 ratio = 3000 / 6000 = 0.5",
  bl1.agent_p95_ms === 3000 &&
    bl1.legacy_p95_ms === 6000 &&
    approx(bl1.p95_ratio, 0.5),
);
const legacy2 = new Map(legacy1);
legacy2.set("F2", legacyOk([623, 236], 6000));
const bl1b = compareBl1(runs, scores, legacy2);
check(
  "BL1: legacy recall 1.0 on F2 gives delta -0.25",
  approx(bl1b.delta, -0.25),
);
check(
  "target comparison: -0.02 passes the >= -0.02 target, -0.0201 fails",
  meetsTarget(">=", -0.02, -0.02) && !meetsTarget(">=", -0.0201, -0.02),
);
check(
  "target comparison: == 0 and <= 0.05 boundaries",
  meetsTarget("==", 0, 0) &&
    !meetsTarget("==", 1, 0) &&
    meetsTarget("<=", 0.05, 0.05) &&
    !meetsTarget("<=", 0.0501, 0.05),
);

// --- BL2 metrics -----------------------------------------------------------------------------
check(
  "BL2 reciprocalRank: first relevant at rank 2 gives 0.5 even when a later hit exists",
  reciprocalRank([10, 20], [5, 10, 20, 7]) === 0.5,
);
check(
  "BL2 recallAtK: gold [10,20] ranked [5,10,20,7] has 0.5 at k=2 and 1 at k=3",
  recallAtK([10, 20], [5, 10, 20, 7], 2) === 0.5 &&
    recallAtK([10, 20], [5, 10, 20, 7], 3) === 1,
);
check(
  "BL2 rankedArticles: seeds first, path after, de-duplicated",
  same(
    rankedArticles({
      seed_articles: [
        { article: { article_number: 117 } },
        { article: { article_number: 119 } },
      ],
      path_context: [
        { article: { article_number: 119 } },
        { article: { article_number: 120 } },
      ],
    }),
    [117, 119, 120],
  ),
);
{
  const a = scoreBl2Case("a", [10, 20], [5, 10, 20], [10, 20, 5]);
  const b = scoreBl2Case("b", [1], [2, 3], [1]);
  const s = summarizeBl2([a, b]);
  // old recall@5: a = 1, b = 0 -> 0.5; new: a = 1, b = 1 -> 1.0; MRR old (0.5 + 0)/2 = 0.25, new (1 + 1)/2 = 1
  check(
    "BL2 summary: recall@5 old 0.5, new 1.0, delta 0.5; MRR old 0.25, new 1.0",
    s.old.recall5 === 0.5 &&
      s.new.recall5 === 1 &&
      s.delta_recall5 === 0.5 &&
      s.old.mrr === 0.25 &&
      s.new.mrr === 1,
  );
}

// --- cost guard ------------------------------------------------------------------------------
{
  const cs = [
    mk("c1", "seed", [T("a"), T("b")]),
    mk("c2", "recall_basic", [T("c", "recall"), T("d", "smalltalk")]),
  ];
  const est = estimateTokens(cs, 4, 2, 96_000);
  // 2 legal x (4+1) + 1 recall x 2 + 1 smalltalk x 1 = 13 calls x 7000 + 2 legacy x 2500 = 96000
  check(
    "cost: 13 calls x 7000 + 2 x 2500 = 96000 tokens",
    TOKENS_PER_LLM_CALL === 7000 &&
      est.estimated_tokens ===
        13 * TOKENS_PER_LLM_CALL + 2 * TOKENS_PER_LEGACY_CALL &&
      est.estimated_tokens === 96_000 &&
      est.cases === 2 &&
      est.turns === 4,
  );
  let blocked = false;
  try {
    assertWithinBudget({ ...est, budget: 95_999 });
  } catch (e) {
    blocked = e instanceof CostGuardError;
  }
  let allowed = true;
  try {
    assertWithinBudget(est);
  } catch {
    allowed = false;
  }
  check(
    "cost: aborts above the budget, passes at the budget",
    blocked && allowed,
  );
  let bad = false;
  try {
    parseBudget("abc");
  } catch {
    bad = true;
  }
  check(
    "cost: default budget 1,000,000; a non-integer budget throws",
    parseBudget(undefined) === 1_000_000 &&
      parseBudget("250000") === 250000 &&
      bad,
  );
}

// --- legacy precondition and parsing ---------------------------------------------------------
{
  const throws = (f: () => unknown) => {
    try {
      f();
      return false;
    } catch {
      return true;
    }
  };
  check(
    "BL1 precondition: provider gemini, LLM_API_URL unset passes",
    assertLegacyPrecondition({ LLM_PROVIDER: "gemini" }, null)
      .llm_api_url_host === null,
  );
  check(
    "BL1 precondition: LLM_API_URL on Google passes (host only)",
    assertLegacyPrecondition(
      {
        LLM_PROVIDER: "gemini",
        LLM_API_URL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      },
      null,
    ).llm_api_url_host === "generativelanguage.googleapis.com",
  );
  check(
    "BL1 precondition: LLM_API_URL on :5814 throws",
    throws(() =>
      assertLegacyPrecondition(
        { LLM_PROVIDER: "gemini", LLM_API_URL: "http://127.0.0.1:5814" },
        null,
      ),
    ),
  );
  check(
    "BL1 precondition: LLM_PROVIDER=llama throws",
    throws(() => assertLegacyPrecondition({ LLM_PROVIDER: "llama" }, null)),
  );
  check(
    "BL1 precondition: value read from the .env text when the process env is empty; process env wins",
    effectiveEnv("LLM_API_URL", {}, "# c\nLLM_API_URL=http://x:1 # note\n") ===
      "http://x:1" &&
      effectiveEnv(
        "LLM_API_URL",
        { LLM_API_URL: "http://y" },
        "LLM_API_URL=http://x",
      ) === "http://y",
  );
  check(
    "BL1 precondition: a .env LLM_API_URL on :5814 throws",
    throws(() =>
      assertLegacyPrecondition(
        { LLM_PROVIDER: "gemini" },
        "LLM_API_URL=http://127.0.0.1:5814\n",
      ),
    ),
  );
  const tpl = "# Tư vấn pháp luật dân sự\n\n## 1. Pháp luật áp dụng\n";
  check(
    "legacy: template fallback is detected",
    isTemplateFallback(tpl) && !isTemplateFallback("Theo Điều 8 ..."),
  );
  const body = (response: string, llm = true) => ({
    context: {
      seed_articles: [{ article_number: 8 }],
      path_context: [{ article_number: 9 }, { article_number: 8 }],
    },
    response,
    ...(llm ? { llmDetails: { output: response } } : {}),
  });
  const good = parseLegacyBody(body("Theo Điều 8"));
  check(
    "legacy: a real answer yields the de-duplicated cited articles",
    good.ok && same([...good.cited_articles].sort(), [8, 9]),
  );
  const tp = parseLegacyBody(body(tpl));
  check(
    "legacy: a template answer is an error, not a score",
    tp.ok === false && tp.error.kind === "legacy_template_fallback",
  );
  const nollm = parseLegacyBody(body("x", false));
  check("legacy: a body without llmDetails is an error", !nollm.ok);
  check(
    "legacy: a body without context is bad_response",
    (() => {
      const r = parseLegacyBody({});
      return r.ok === false && r.error.kind === "bad_response";
    })(),
  );
}

// --- header consistency, failure classes, cookies ---------------------------------------------
{
  const base = (ok([], "a") as Extract<TurnOutcome, { ok: true }>).response;
  const header: Header = {
    provider: "gemini",
    model: "fixture-model",
    index_id: "fixture-index",
  };
  check(
    "header: matching done passes; a null header model accepts the first done",
    checkAgainstHeader(base, header) === null &&
      checkAgainstHeader(base, { ...header, model: null }) === null,
  );
  check(
    "header: done.model differing from the header is an error",
    checkAgainstHeader({ ...base, model: "other" }, header)?.kind ===
      "model_mismatch",
  );
  check(
    "header: done.embedding.index_id differing from C9 is an error",
    checkAgainstHeader(
      {
        ...base,
        embedding: { ...base.embedding, index_id: "legacy-transformers-384" },
      },
      header,
    )?.kind === "index_mismatch",
  );
  check(
    "failure: 502 llm_rate_limited maps to rate_limited (counted separately)",
    classifyFailure(502, { error: "llm_rate_limited", detail: "d" }).kind ===
      "rate_limited",
  );
  check(
    "failure: other codes keep their name, unknown bodies become http_<status>",
    classifyFailure(502, { error: "llm_unreachable" }).kind ===
      "llm_unreachable" &&
      classifyFailure(500, null).kind === "http_500" &&
      classifyFailure(404, { error: "session_not_found" }).kind ===
        "session_not_found",
  );
  const jar = new CookieJar();
  jar.absorb(["vl_owner=abc123; Path=/; HttpOnly", "x=1; Max-Age=5"]);
  check(
    "cookie jar: keeps name=value pairs for the next request (same owner across sessions)",
    jar.header() === "vl_owner=abc123; x=1",
  );
}

// --- langfuse --------------------------------------------------------------------------------
{
  const traced = ok(
    [act("get_article", '{"article_number":8}'), obs("t", [8])],
    "Điều 8",
    10,
  ) as Extract<TurnOutcome, { ok: true }>;
  traced.response.trace_id = "a".repeat(32);
  const r1 = run(
    mk("L1", "explicit_article", [T("q")], {
      gold_articles: [8],
      expected_first_tool: "get_article",
    }),
    [traced],
  );
  const r2 = run(
    mk("L2", "explicit_article", [T("q")], {
      gold_articles: [8],
      expected_first_tool: "get_article",
    }),
    [ok([], "x")],
  );
  const built = buildLangfuseScores(
    [r1, r2],
    [scoreCase(r1, ctx), scoreCase(r2, ctx)],
  );
  check(
    "langfuse: citation_recall (NUMERIC) and tool_choice_ok (BOOLEAN) attached to the trace; the case without trace id is counted",
    built.scores.length === 2 &&
      built.cases_without_trace === 1 &&
      built.scores[0].name === "citation_recall" &&
      built.scores[0].dataType === "NUMERIC" &&
      built.scores[1].name === "tool_choice_ok" &&
      built.scores[1].value === 1,
  );
  const line = await pushScores({}, [r1], [scoreCase(r1, ctx)]);
  check(
    "langfuse: not pushed unless LANGFUSE_ENABLED=true",
    line.startsWith("langfuse_push: disabled"),
  );
}

// ---------------------------------------------------------------------------
// 4. Report assembly (MODE: mock) and the plan KPI table
// ---------------------------------------------------------------------------
const reportInput = (mode: "mock" | "live"): ReportInput => ({
  meta: {
    mode,
    label:
      "SELF-TEST FIXTURES: hand-written AgentRunResponse objects, not model output",
    run_name: "selftest",
    provider: "gemini",
    chat_model: "fixture-model",
    embedding_index_id: "fixture-index",
    server_url: null,
    dataset_sha256: sha256,
    commit: null,
    started_at: "t0",
    finished_at: "t1",
    max_steps: 4,
    bl1_precondition: null,
  },
  runs,
  scores,
  agg,
  bl1,
  bl2: null,
  bl2_source: null,
  cost: estimateTokens(dataset.cases, 4, 27, 1_000_000),
  rate_limited_count: 1,
  langfuse_push: "langfuse_push: disabled (LANGFUSE_ENABLED is not true)",
});
const mockReport = buildReport(reportInput("mock"));
check(
  "report (mock): header says MODE mock with the fixture label and claims 0 KPIs",
  mockReport.header.MODE === "mock" &&
    mockReport.header.kpis_claimed === 0 &&
    mockReport.header.label.startsWith("SELF-TEST FIXTURES"),
);
check(
  "report (mock): all 11 KPI rows are NOT MEASURED, none observed",
  mockReport.kpis.length === 11 &&
    mockReport.kpis.every(
      (k) =>
        k.status === "NOT MEASURED" && k.observed === null && k.mode === "mock",
    ),
);
const md = toMarkdown(mockReport);
check(
  "report (mock): markdown carries MODE: mock and no PASS/FAIL cell",
  md.includes("MODE: mock") && !/\| (PASS|FAIL) \|/.test(md),
);
check(
  "report: 429 count and langfuse_push line are separate fields",
  mockReport.rate_limited_429_count === 1 &&
    mockReport.langfuse_push.startsWith("langfuse_push: disabled"),
);
{
  const tmp = mkdtempSync(join(tmpdir(), "agent-eval-selftest-"));
  const paths = writeReport(mockReport, tmp, "stamp", "selftest");
  const onDisk = JSON.parse(readFileSync(paths.json, "utf8"));
  check(
    "report: the JSON artifact equals the in-memory report that the console prints",
    same(onDisk, JSON.parse(JSON.stringify(mockReport))) &&
      readFileSync(paths.md, "utf8") === md,
  );
  rmSync(tmp, { recursive: true, force: true });
}
// Verdicts must follow the numbers (computed rows, not claimed).
const rows = Object.fromEntries(
  computeKpiRows(reportInput("live")).map((r) => [r.id, r]),
);
check(
  "verdict: invalid tool-call rate 1/21 = 4.76% <= 5% is PASS",
  rows.invalid_tool_call_rate.status === "PASS",
);
check(
  "verdict: tool choice 2/3 < 0.85, budget 2/4 > 10%, run error 1/14 > 0, recall accuracy 3/4 < 0.9 are FAIL",
  [
    "tool_choice_accuracy",
    "budget_exhausted_rate",
    "run_error_rate",
    "recall_accuracy",
  ].every((k) => rows[k].status === "FAIL"),
);
check(
  "verdict: isolation 1, fabricated 1, false trigger 1/2 are FAIL",
  ["isolation_leak", "fabricated_recall", "false_recall_trigger_rate"].every(
    (k) => rows[k].status === "FAIL",
  ),
);
check(
  "verdict: BL1 delta 0 and p95 ratio 0.5 are PASS; BL2 without a report is NOT MEASURED",
  rows.bl1_citation_recall_delta.status === "PASS" &&
    rows.p95_latency_ratio.status === "PASS" &&
    rows.bl2_recall5_delta.status === "NOT MEASURED",
);
check(
  "verdict: zero-failure hard KPI note carries the 3/n bound",
  (() => {
    const z = aggregate(scores.filter((s) => s.case_id !== "F7"));
    const r = computeKpiRows({ ...reportInput("live"), agg: z }).find(
      (k) => k.id === "isolation_leak",
    );
    return r?.status === "PASS" && (r?.note ?? "").includes("3/n");
  })(),
);

// ---------------------------------------------------------------------------
// 5. Review R12 (EB1 attempt 2): errored cases never improve or hide a KPI
// ---------------------------------------------------------------------------
const errTurn = (kind = "rate_limited"): TurnOutcome => ({
  ok: false,
  wall_ms: 9000,
  error: { kind, status: 502, detail: "x" },
});
const liveRows = (
  sc: ReturnType<typeof scoreCase>[],
  b1: ReturnType<typeof compareBl1> | null = null,
) =>
  Object.fromEntries(
    computeKpiRows({
      ...reportInput("live"),
      agg: aggregate(sc),
      scores: sc,
      bl1: b1,
    }).map((r) => [r.id, r]),
  );
const sc1 = (c: EvalCase, turns: TurnOutcome[]) =>
  scoreCase(run(c, turns), ctx);
const isoCase = (id: string) =>
  mk(
    id,
    "isolation",
    [
      T("Công ty Hải Âu Xanh giao sai?", "legal", "A"),
      T("Tôi đã hỏi gì?", "recall", "B"),
    ],
    { leak_markers: ["Hải Âu Xanh"], leak_topics: ["giao sai"] },
  );
const isoCleanTurns = (): TurnOutcome[] => [
  ok([act("search_legal_articles", '{"query":"a"}'), obs("t")], "a"),
  ok([act("recall_session", '{"key":"đã hỏi"}'), obs(FRESH)], "Chưa có."),
];

// R12-01 (old code: errored cases were dropped from every denominator below)
{
  const clean = isoCase("ISO-OK");
  const bad = isoCase("ISO-ERR");
  const sOk = sc1(clean, isoCleanTurns());
  const rowsOnlyOk = liveRows([sOk]);
  const sErr = sc1(bad, [isoCleanTurns()[0], errTurn()]);
  const rowsE = liveRows([sOk, sErr]);
  check(
    "R12-01 isolation: a clean case alone is PASS (0/1) ...",
    rowsOnlyOk.isolation_leak.status === "PASS" &&
      rowsOnlyOk.isolation_leak.n === 1,
  );
  check(
    "R12-01 isolation: ... adding an errored case turns it into FAIL, n=2, reason 'errored' (old code: PASS 0/1)",
    rowsE.isolation_leak.status === "FAIL" &&
      rowsE.isolation_leak.n === 2 &&
      rowsE.isolation_leak.note.includes("1 errored") &&
      rowsE.isolation_leak.note.includes("ISO-ERR"),
    JSON.stringify(rowsE.isolation_leak),
  );
  const fc = mk("FR-OK", "recall_fresh", [T("Tôi đã hỏi gì?", "recall")]);
  const fe = mk("FR-ERR", "recall_fresh", [T("Lúc nãy hỏi gì?", "recall")]);
  const freshOk = ok(
    [act("recall_session", '{"key":"k"}'), obs(FRESH)],
    "Chưa có câu hỏi nào.",
  );
  const rowsF = liveRows([sc1(fc, [freshOk]), sc1(fe, [errTurn()])]);
  check(
    "R12-01 fabricated: an errored recall_fresh case cannot PASS the hard gate (old code: PASS 0/1)",
    rowsF.fabricated_recall.status === "FAIL" &&
      rowsF.fabricated_recall.n === 2 &&
      rowsF.fabricated_recall.note.includes("errored"),
  );
  const e1 = mk("EX-ERR", "explicit_article", [T("Điều 8?")], {
    gold_articles: [8],
    expected_first_tool: "get_article",
  });
  const e0 = mk("EX-OK", "explicit_article", [T("Điều 9?")], {
    gold_articles: [9],
    expected_first_tool: "get_article",
  });
  const exOk = ok(
    [act("get_article", '{"article_number":9}'), obs("t", [9])],
    "Điều 9",
  );
  const rowsT = liveRows([sc1(e0, [exOk]), sc1(e1, [errTurn()])]);
  check(
    "R12-01 tool choice: 1 ok + 1 errored = 1/2 FAIL, not 1/1 (old code: PASS 100%)",
    rowsT.tool_choice_accuracy.status === "FAIL" &&
      rowsT.tool_choice_accuracy.n === 2 &&
      rowsT.tool_choice_accuracy.observed === 0.5,
  );
  check(
    "R12-01 budget: 1 ok + 1 errored = 1/2 FAIL (old code: 0/1 PASS)",
    rowsT.budget_exhausted_rate.status === "FAIL" &&
      rowsT.budget_exhausted_rate.n === 2,
  );
  const rbTurns = [T(Q25), T("Tôi vừa hỏi về điều nào?", "recall")];
  const rb = mk("RB-OK", "recall_basic", rbTurns, { answer_names: [25] });
  const rbE = mk("RB-ERR", "recall_basic", rbTurns, { answer_names: [25] });
  const rbOk = [
    ok(
      [act("get_article", '{"article_number":25}'), obs("t", [25])],
      "Điều 25",
    ),
    ok(
      [act("recall_session", '{"key":"k"}'), obs(`[query] ${Q25}`)],
      "Bạn hỏi về Điều 25",
    ),
  ];
  const rowsR = liveRows([sc1(rb, rbOk), sc1(rbE, [rbOk[0], errTurn()])]);
  check(
    "R12-01 recall accuracy: 1 ok + 1 errored = 0.5 FAIL (old code: 1/1 PASS)",
    rowsR.recall_accuracy.status === "FAIL" && rowsR.recall_accuracy.n === 2,
  );
  const ftOk = mk("FT-OK", "false_trigger", [
    T("Câu đầu tiên của khoản 2 Điều 5?"),
  ]);
  const ftE = mk("FT-ERR", "false_trigger", [T("Phải báo trước bao lâu?")]);
  const rowsX = liveRows([
    sc1(ftOk, [
      ok([act("search_legal_articles", '{"query":"q"}'), obs("x", [5])], "x"),
    ]),
    sc1(ftE, [errTurn()]),
  ]);
  check(
    "R12-01 false trigger: 1 ok + 1 errored = 1/2 FAIL (old code: 0/1 PASS)",
    rowsX.false_recall_trigger_rate.status === "FAIL" &&
      rowsX.false_recall_trigger_rate.n === 2,
  );
  // All cases errored: every non-BL KPI is FAIL, none NOT MEASURED.
  const allErr = [
    sc1(e1, [errTurn()]),
    sc1(bad, [errTurn()]),
    sc1(fe, [errTurn()]),
    sc1(rbE, [errTurn()]),
    sc1(ftE, [errTurn()]),
  ];
  const rowsA = liveRows(allErr);
  const notFail = Object.values(rowsA)
    .filter(
      (r) =>
        r.id !== "bl1_citation_recall_delta" &&
        r.id !== "bl2_recall5_delta" &&
        r.id !== "p95_latency_ratio",
    )
    .filter((r) => r.status !== "FAIL")
    .map((r) => `${r.id}=${r.status}`);
  check(
    "R12-01 all cases errored: every non-BL KPI is FAIL (invalid tool-call rate with no calls included)",
    notFail.length === 0,
    notFail.join(", "),
  );
  // --fail-on-kpi gate
  const emptyRows = Object.values(liveRows([]));
  const gEmpty = kpiGateFailures(emptyRows, { noBl1: true }).map(
    (x) => x.split(":")[0],
  );
  check(
    "R12-01 --fail-on-kpi: NOT MEASURED sign-off/hard KPIs fail the gate; BL2 and (with --no-bl1) BL1/p95 do not",
    gEmpty.includes("isolation_leak") &&
      gEmpty.includes("fabricated_recall") &&
      gEmpty.includes("tool_choice_accuracy") &&
      !gEmpty.includes("bl2_recall5_delta") &&
      !gEmpty.includes("bl1_citation_recall_delta") &&
      !gEmpty.includes("p95_latency_ratio"),
    gEmpty.join(","),
  );
  const gWith = kpiGateFailures(emptyRows, { noBl1: false }).map(
    (x) => x.split(":")[0],
  );
  check(
    "R12-01 --fail-on-kpi: without --no-bl1 a NOT MEASURED BL1 delta and p95 fail the gate, BL2 still does not",
    gWith.includes("bl1_citation_recall_delta") &&
      gWith.includes("p95_latency_ratio") &&
      !gWith.includes("bl2_recall5_delta"),
  );
}

// R12-02 BL1: an agent error with a working legacy run scores 0 and keeps p95 honest
{
  const legacy3 = new Map(legacy1);
  legacy3.set("F11", legacyOk([117], 1000));
  const b3 = compareBl1(runs, scores, legacy3);
  check(
    "R12-02 BL1: errored agent case F11 + working legacy is paired with recall 0 (agent 0.5 vs legacy 0.6667, delta -0.1667); old code dropped it (delta 0, n=2)",
    b3.n_paired === 3 &&
      approx(b3.agent_mean_recall, 0.5) &&
      approx(b3.legacy_mean_recall, 2 / 3) &&
      approx(b3.delta, -1 / 6) &&
      same(b3.agent_errors_paired, ["F11"]),
    JSON.stringify(b3),
  );
  check(
    "R12-02 BL1: p95 ratio is unmeasurable when an agent error is paired (old code: 0.5)",
    b3.p95_ratio === null && b3.agent_p95_ms === null,
  );
  const r3 = liveRows(scores, b3);
  check(
    "R12-02 BL1: the row note lists the agent errors; the p95 row says UNMEASURABLE and is NOT MEASURED",
    r3.bl1_citation_recall_delta.note.includes(
      "Agent errors (kept, recall 0): F11",
    ) &&
      r3.bl1_citation_recall_delta.status === "FAIL" &&
      r3.p95_latency_ratio.status === "NOT MEASURED" &&
      r3.p95_latency_ratio.note.includes("UNMEASURABLE"),
  );
}

// R12-03 fabricated recall
{
  const q = [T("Tôi đã hỏi gì trước đó?", "recall")];
  const fr = (id: string) => mk(id, "recall_fresh", q);
  const noCall = sc1(fr("FR1"), [ok([], "Chưa có câu hỏi nào trước đó.")]);
  check(
    "R12-03 recall_fresh: no recall_session call = fabricated even with a clean answer (old code: not fabricated)",
    noCall.fabricated === true,
  );
  const badObs = sc1(fr("FR2"), [
    ok(
      [act("recall_session", '{"key":"k"}'), obs("[query] một câu hỏi nào đó")],
      "Chưa có câu hỏi nào.",
    ),
  ]);
  check(
    "R12-03 recall_fresh: recall_session called but the observation does not show the fresh-session result = fabricated (old code: not fabricated)",
    badObs.fabricated === true,
  );
  const asserts = sc1(fr("FR3"), [
    ok(
      [act("recall_session", '{"key":"k"}'), obs(FRESH)],
      "Bạn đã hỏi một câu về hợp đồng.",
    ),
  ]);
  const english = sc1(fr("FR4"), [
    ok(
      [act("recall_session", '{"key":"k"}'), obs(FRESH)],
      "As you asked earlier, contracts need consent.",
    ),
  ]);
  check(
    "R12-03 recall_fresh: an answer asserting a prior question ('bạn đã hỏi', 'you asked') is fabricated (old code: not fabricated)",
    asserts.fabricated === true && english.fabricated === true,
  );
  const good = sc1(fr("FR5"), [
    ok(
      [act("recall_session", '{"key":"k"}'), obs(FRESH)],
      "Bạn chưa hỏi câu nào trong phiên này.",
    ),
  ]);
  check(
    "R12-03 recall_fresh: tool called + fresh observation + clean answer is not fabricated; marker helper",
    good.fabricated === false &&
      good.recall_ok === true &&
      assertsPriorQuestion("Câu hỏi trước của bạn là gì") &&
      !assertsPriorQuestion("Bạn chưa hỏi gì"),
  );
}

// R12-04 the BL2 report must belong to this run
{
  const tmp = mkdtempSync(join(tmpdir(), "agent-eval-bl2-"));
  const path = join(tmp, "bl2.json");
  const summary = summarizeBl2([scoreBl2Case("a", [10], [5], [10])]);
  writeFileSync(
    path,
    JSON.stringify({
      header: { new_index_id: "idx-A", dataset_sha256: "sha-A" },
      summary,
    }),
  );
  const okLoad = loadBl2(path, { index_id: "idx-A", dataset_sha256: "sha-A" });
  const badIdx = loadBl2(path, { index_id: "idx-B", dataset_sha256: "sha-A" });
  const badSha = loadBl2(path, { index_id: "idx-A", dataset_sha256: "sha-B" });
  check(
    "R12-04 BL2: matching index_id and dataset sha load; another index or dataset is refused with the reason (old code: loaded both)",
    okLoad.summary !== null &&
      badIdx.summary === null &&
      (badIdx.refused ?? "").includes(
        "new_index_id idx-A != C9 index_id idx-B",
      ) &&
      badSha.summary === null &&
      (badSha.refused ?? "").includes("dataset_sha256"),
  );
  const refusedRow = computeKpiRows({
    ...reportInput("live"),
    bl2: badIdx.summary,
    bl2_source: path,
    bl2_refused: badIdx.refused,
  }).find((k) => k.id === "bl2_recall5_delta");
  check(
    "R12-04 BL2: a refused report leaves the KPI NOT MEASURED and the row says why",
    refusedRow?.status === "NOT MEASURED" &&
      (refusedRow?.note ?? "").includes("refused"),
  );
  rmSync(tmp, { recursive: true, force: true });
}

// R12-05 isolation not exercised, R12-06 followup must not recall
{
  const c = isoCase("ISO-NOREC");
  const s = sc1(c, [
    ok([act("search_legal_articles", '{"query":"a"}'), obs("t")], "a"),
    ok([act("search_legal_articles", '{"query":"b"}'), obs("t")], "Chưa có."),
  ]);
  const a2 = aggregate([s]);
  check(
    "R12-05 isolation: session B never called recall_session = not exercised = 1/1 failing, no leak found (old code: 0 leaks, PASS)",
    s.isolation_leak === false &&
      s.isolation_exercised === false &&
      a2.isolation_leak.k === 1 &&
      same(a2.failing.isolation_not_exercised, ["ISO-NOREC"]),
  );
  const f = mk(
    "FW-REC",
    "followup_window",
    [T("Giám hộ?"), T("Người đó có nghĩa vụ gì?")],
    { gold_articles: [55] },
  );
  const viaRecall = sc1(f, [
    ok([], "t1"),
    ok(
      [act("recall_session", '{"key":"k"}'), obs("t", [55])],
      "Họ phải chăm sóc",
    ),
  ]);
  check(
    "R12-06 followup_window: gold cited but recall_session was called = recall_ok false (old code: true)",
    viaRecall.gold_hit === true && viaRecall.recall_ok === false,
  );
}

// R12-07 running token sum
{
  const cs = mk("TK", "seed", [T("q")]);
  const r1 = run(cs, [ok([], "a", 10, 600)]);
  const r2 = run(cs, [ok([], "a", 10, 500), ok([], "b", 10, null)]);
  const used = sumReportedTokens([r1, r2]);
  check(
    "R12-07 token meter: sums done.total_tokens (null as 0) and aborts only above the budget",
    used === 1100 &&
      exceedsTokenBudget(used, 1000) &&
      !exceedsTokenBudget(1000, 1000),
  );
  const notAttempted = sc1(
    mk("NA", "isolation", [T("a", "legal", "A"), T("b", "recall", "B")]),
    [],
  );
  check(
    "R12-07 a case not attempted after the abort scores as errored ('turns not attempted'), never as a pass",
    notAttempted.errored === true &&
      notAttempted.error === "turns not attempted",
  );
}

// R12-10 langfuse run name
{
  const t = ok(
    [act("get_article", '{"article_number":8}'), obs("t", [8])],
    "Điều 8",
    10,
  ) as Extract<TurnOutcome, { ok: true }>;
  t.response.trace_id = "b".repeat(32);
  const c = mk("LF", "explicit_article", [T("q")], {
    gold_articles: [8],
    expected_first_tool: "get_article",
  });
  const rr = run(c, [t]);
  const built = buildLangfuseScores([rr], [scoreCase(rr, ctx)], "agent-eval-X");
  check(
    "R12-10 langfuse: every score carries the run name in comment and metadata; the push line states the tag was not applied (old code: no run name)",
    built.scores.length === 2 &&
      built.scores.every(
        (x) =>
          (x.comment ?? "").includes("agent-eval-X") &&
          x.metadata?.eval_run === "agent-eval-X",
      ) &&
      langfuseTagNote("agent-eval-X").includes(
        "tag eval:agent-eval-X not applied (C2 has no tag param)",
      ),
  );
}

// KPI definitions vs the plan table (verbatim).
{
  const planPath =
    process.env.EVAL_PLAN_PATH ??
    "C:/Git/.notes/JOBs/xAie/legal/vn-legal/changes-02/phase-01/plan.md";
  const lines = readFileSync(planPath, "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) =>
    l.trim().startsWith("| KPI | Target | Gate |"),
  );
  const cells = lines.slice(start + 2, start + 13).map((l) =>
    l
      .trim()
      .replace(/^\|\s*/, "")
      .replace(/\s*\|$/, "")
      .split(/\s+\|\s+/)
      .map((c) => c.trim()),
  );
  const mismatches: string[] = [];
  KPI_DEFS.forEach((k, i) => {
    const c = cells[i];
    if (!c || c[0] !== k.name || c[1] !== k.target || c[2] !== k.gate)
      mismatches.push(`${k.id}: plan=${JSON.stringify(c)}`);
  });
  check(
    `thresholds: 11 KPI rows equal plan lines ${start + 3}-${start + 13} verbatim (name, target, gate)`,
    KPI_DEFS.length === 11 && cells.length === 11 && mismatches.length === 0,
    mismatches.join(" | "),
  );
}

console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures === 0 ? 0 : 1);
