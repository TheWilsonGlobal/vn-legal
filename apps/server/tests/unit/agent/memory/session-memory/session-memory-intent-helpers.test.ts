import { describe, it, expect } from "vitest";
import {
  detectRecallIntent,
  capObservation,
  countTokens,
  isFirstKey,
  isRecentKey,
  MAX_OBSERVATION_TOKENS,
} from "../../../../../src/agent/memory";
import {
  createWindowState,
  renderSummary,
} from "../../../../../src/agent/memory/window-state";

describe("recall-intent detector", () => {
  it.each([
    "Tôi vừa hỏi về điều nào?",
    "Câu hỏi đầu tiên của tôi là gì?",
    "Câu đầu tiên của tôi là gì?",
    "Tôi hỏi câu đầu tiên là gì?",
    "Tôi đã hỏi gì trước đó?",
    "Lúc nãy bạn nói gì?",
    "Nhắc lại điều vừa rồi cho tôi",
    "Lần trước chúng ta nói về gì?",
    "What did I ask earlier?",
    "Do you still remember my name?",
    "Do you recall what I asked?",
    "Remember what I said about Article 5?",
    "I asked about Article 5 last time",
    "You said 45 days earlier",
    "Did I mention my deadline?",
  ])("detects recall in %s", (text) => {
    expect(detectRecallIntent(text)).toBe(true);
  });

  it.each([
    "Phải thông báo trước bao lâu khi chấm dứt hợp đồng?",
    "thông báo trước khi chấm dứt hợp đồng",
    "Điều 25 quy định gì về di chúc?",
    // R8-01: first-question phrasing without a first-person marker is a legal question.
    "Câu đầu tiên của khoản 2 Điều 5 là gì?",
    "Câu hỏi đầu tư nước ngoài cần giấy phép gì?",
    // R8-07: "trước đó" in a legal sense, with no conversational context.
    "Người lao động phải báo cho người sử dụng lao động 30 ngày trước đó.",
    "Do you know the notice period?",
    "I want to ask about Article 5",
    // RX-02: a first-person pronoun plus "trước đó" is a legal sentence, not recall.
    "Tôi đã báo cho công ty 30 ngày trước đó.",
    "Em đã nộp đơn 15 ngày trước đó.",
    // RX-03: a bare first-question phrase in a sentence is not a recall marker.
    "Câu đầu tiên là gì?",
    "Câu hỏi đầu là gì?",
  ])("does not treat ordinary legal text as recall: %s", (text) => {
    expect(detectRecallIntent(text)).toBe(false);
  });

  it("respects letter boundaries: 'lần trướcx' is not 'lần trước'", () => {
    expect(detectRecallIntent("lần trước")).toBe(true);
    expect(detectRecallIntent("lần trướcx")).toBe(false);
  });

  it.each([
    "Câu hỏi đầu tiên của tôi là gì?",
    "Tôi đã hỏi gì trước đó?",
    "Nhắc lại câu trả lời trước đó",
    "Lúc nãy bạn nói gì?",
    "Tôi vừa hỏi về điều nào?",
    // RX-02: "bạn" keeps the sentence-final "trước đó" rule working without a verb.
    "Bạn đã trả lời gì trước đó?",
  ])("matches decomposed (NFD) input: %s", (text) => {
    const nfd = text.normalize("NFD");
    expect(nfd).not.toBe(text);
    expect(detectRecallIntent(nfd)).toBe(true);
  });
});

describe("recall key classification (R8-01, R8-02)", () => {
  it.each([
    "tôi đã hỏi gì",
    "tôi đã đề cập gì",
    "nhắc lại",
    "lúc nãy",
    "trước đó",
    "lần trước",
    "earlier",
    "what did I ask",
  ])("'%s' is a recent key", (key) => {
    expect(isRecentKey(key)).toBe(true);
    expect(isFirstKey(key)).toBe(false);
  });

  it.each([
    "Câu hỏi đầu tiên của tôi",
    "câu đầu tiên của tôi",
    "câu hỏi đầu tiên",
    "first question",
    // RX-03: the model's own key needs no first-person marker.
    "câu đầu tiên",
    "câu hỏi đầu",
  ])("'%s' is a first key", (key) => {
    expect(isFirstKey(key)).toBe(true);
    expect(isRecentKey(key)).toBe(false);
  });

  it.each([
    "Câu đầu tiên của khoản 2 Điều 5",
    "Câu hỏi đầu tư nước ngoài",
    "thời hạn báo trước",
    // RX-03: the bare-phrase rule is anchored, so a phrase with more words stays topical.
    "câu đầu tiên của hợp đồng",
    "câu hỏi đầu tư",
  ])("'%s' is a topical key, neither first nor recent", (key) => {
    expect(isFirstKey(key)).toBe(false);
    expect(isRecentKey(key)).toBe(false);
  });
});

describe("history summary bound (R8-03)", () => {
  it("countTokens(summary) stays within the budget for many short lines", () => {
    const state = createWindowState();
    state.heads = Array.from({ length: 200 }, () => "abcd");

    const s = renderSummary(state, {
      maxTurns: 8,
      maxTokens: 512,
      historyMaxTokens: 64,
    });

    expect(countTokens(s)).toBeLessThanOrEqual(64);
    expect(s.split("\n")[0]).toMatch(/^\[\d+ earlier lines condensed out\]$/);
  });

  it.each([64, 65, 100, 257, 1500])(
    "holds budget %i for every line count, with a tail",
    (budget) => {
      for (const n of [0, 1, 2, 5, 17, 60, 201, 400]) {
        const state = createWindowState();
        state.heads = Array.from({ length: n }, (_, k) =>
          k % 2 === 0 ? "abcd" : "ab cd ef gh",
        );
        state.tail = ["User: a", "Assistant: bc", "User: xyzw"];

        const s = renderSummary(state, {
          maxTurns: 8,
          maxTokens: 512,
          historyMaxTokens: budget,
        });

        expect(countTokens(s)).toBeLessThanOrEqual(budget);
      }
    },
  );
});

describe("observation cap", () => {
  it("truncates to the limit", () => {
    const long = Array.from({ length: 10000 }, (_, k) => `từ${k}`).join(" ");
    const out = capObservation(long, 100);
    expect(countTokens(out)).toBeLessThanOrEqual(100);
    expect(out.length).toBeLessThan(long.length);
    expect(out.endsWith("[truncated]")).toBe(true);
  });

  it("leaves shorter text unchanged", () => {
    const short = "Điều 25 quy định về thời hạn báo trước.";
    expect(capObservation(short, 100)).toBe(short);
    expect(capObservation(short, MAX_OBSERVATION_TOKENS)).toBe(short);
  });

  it("rejects a limit that cannot hold the truncation mark", () => {
    expect(() => capObservation("abc", 2)).toThrow(RangeError);
  });
});
