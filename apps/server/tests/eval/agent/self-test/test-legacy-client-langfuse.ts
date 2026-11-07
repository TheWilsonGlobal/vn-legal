import {
  CookieJar,
  type Header,
  checkAgainstHeader,
  classifyFailure,
} from "../client";
import { buildLangfuseScores, pushScores } from "../langfuse";
import {
  assertLegacyPrecondition,
  effectiveEnv,
  isTemplateFallback,
  parseLegacyBody,
} from "../legacy";
import { scoreCase } from "../scorers";
import type { TurnOutcome } from "../types";
import { TestContext, same } from "./context";
import { T, act, mk, obs, ok, run } from "./fixture-world";

export async function runLegacyClientLangfuseTests(ctx: TestContext) {
  const { check } = { check: ctx.check.bind(ctx) };

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
          LLM_API_URL:
            "https://generativelanguage.googleapis.com/v1beta/openai/",
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
      effectiveEnv(
        "LLM_API_URL",
        {},
        "# c\nLLM_API_URL=http://x:1 # note\n",
      ) === "http://x:1" &&
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
    const evalCtx = {
      max_steps: 4,
      all_queries: ["Quyền nhân thân theo Điều 25 là gì?"],
    };
    const built = buildLangfuseScores(
      [r1, r2],
      [scoreCase(r1, evalCtx), scoreCase(r2, evalCtx)],
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
    const line = await pushScores({}, [r1], [scoreCase(r1, evalCtx)]);
    check(
      "langfuse: not pushed unless LANGFUSE_ENABLED=true",
      line.startsWith("langfuse_push: disabled"),
    );
  }
}
