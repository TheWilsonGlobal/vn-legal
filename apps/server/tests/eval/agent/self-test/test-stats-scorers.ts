import type { AgentStep, Citation } from "../../../../src/agent/contract";
import {
  chapterHit,
  checkToolCall,
  citationRecall,
  citedArticles,
  namesAnyArticle,
  namesArticle,
} from "../scorers";
import { mean, percentile, rate, wilson } from "../stats";
import { TestContext, approx, same } from "./context";

export function runStatsAndScorersTests(ctx: TestContext) {
  const { check } = { check: ctx.check.bind(ctx) };

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
}
