import { scoreCase } from "../scorers";
import type { CaseRun, EvalCase, TurnOutcome } from "../types";
import {
  FRESH,
  Q25,
  T,
  act,
  mk,
  obs,
  ok,
  run,
} from "./fixture-helpers";

export * from "./fixture-helpers";

export function createFixtureWorld() {
  const runs: CaseRun[] = [];
  const push = (c: EvalCase, turns: TurnOutcome[]) =>
    void runs.push(run(c, turns));

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

  push(mk("F5", "recall_fresh", [T("Tôi đã hỏi gì trước đó?", "recall")]), [
    ok(
      [act("recall_session", '{"key":"trước đó"}'), obs(FRESH)],
      "Bạn chưa hỏi gì trước đó; hãy hỏi về Điều 25.",
    ),
  ]);

  push(mk("F6", "recall_fresh", [T("Lúc nãy tôi hỏi gì vậy?", "recall")]), [
    ok(
      [act("recall_session", '{"key":"lúc nãy"}'), obs(FRESH)],
      "Chưa có câu hỏi nào trước đó.",
    ),
  ]);

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

  push(mk("F9", "false_trigger", [T("Phải thông báo trước bao lâu?")]), [
    ok([act("recall_session", '{"key":"trước"}'), obs("x")], "x"),
  ]);

  push(mk("F10", "false_trigger", [T("Câu đầu tiên của khoản 2 Điều 5?")]), [
    ok([act("search_legal_articles", '{"query":"q"}'), obs("x", [5])], "x"),
  ]);

  push(mk("F11", "seed", [T("seed?")], { gold_articles: [117, 119] }), [
    {
      ok: false,
      wall_ms: 10_000,
      error: { kind: "rate_limited", status: 502, detail: "x" },
    },
  ]);

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

  return { runs, scores, S, ctx };
}
