import { TestContext, approx } from "./context";
import { createFixtureWorld } from "./fixture-world";

export function runCaseScoringTests(ctx: TestContext) {
  const { check } = { check: ctx.check.bind(ctx) };
  const fixtures = createFixtureWorld();
  const { S } = fixtures;

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

  return fixtures;
}
