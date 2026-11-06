import { describe, it, expect } from "vitest";
import type {
  SessionMemory,
  SessionMeta,
  SessionRecord,
  SessionStore,
  Turn,
} from "../../../../src/agent/contract";
import {
  createSessionMemory,
  type MemoryLimits,
} from "../../../../src/agent/memory/session-memory";
import {
  detectRecallIntent,
  capObservation,
  countTokens,
  isFirstKey,
  isRecentKey,
  MAX_OBSERVATION_TOKENS,
} from "../../../../src/agent/memory";
import {
  createWindowState,
  renderSummary,
} from "../../../../src/agent/memory/window-state";

// ----------------------------------------------------------------------------
// In-test fake of the SessionStore port. Only `turns` is implemented: it is the
// only method SessionMemory may call, and `calls` lets tests assert that.
// ----------------------------------------------------------------------------

class FakeStore implements SessionStore {
  readonly sessions = new Map<string, { owner: string; turns: Turn[] }>();
  readonly calls: string[] = [];
  failNextTurns: Error | null = null;

  seed(owner: string, id: string, turns: Turn[]): void {
    this.sessions.set(id, { owner, turns: [...turns] });
  }

  addTurn(turn: Turn, id: string, owner: string): void {
    const s = this.sessions.get(id) ?? { owner, turns: [] };
    s.turns.push(turn);
    this.sessions.set(id, s);
  }

  async turns(owner: string, id: string): Promise<Turn[]> {
    this.calls.push("turns");
    if (this.failNextTurns !== null) {
      const err = this.failNextTurns;
      this.failNextTurns = null;
      throw err;
    }
    const s = this.sessions.get(id);
    if (s === undefined || s.owner !== owner) return [];
    return [...s.turns];
  }

  async create(_owner: string): Promise<SessionMeta> {
    this.calls.push("create");
    throw new Error("FakeStore.create is not used by SessionMemory");
  }
  async list(_owner: string): Promise<SessionMeta[]> {
    this.calls.push("list");
    throw new Error("FakeStore.list is not used by SessionMemory");
  }
  async get(_owner: string, _id: string): Promise<SessionMeta | null> {
    this.calls.push("get");
    throw new Error("FakeStore.get is not used by SessionMemory");
  }
  async append(_id: string, _rec: SessionRecord): Promise<void> {
    this.calls.push("append");
    throw new Error("FakeStore.append is not used by SessionMemory");
  }
  async records(): Promise<{ records: SessionRecord[]; total: number }> {
    this.calls.push("records");
    throw new Error("FakeStore.records is not used by SessionMemory");
  }
  async softDelete(_owner: string, _id: string): Promise<boolean> {
    this.calls.push("softDelete");
    throw new Error("FakeStore.softDelete is not used by SessionMemory");
  }
  async verify(): Promise<never> {
    this.calls.push("verify");
    throw new Error("FakeStore.verify is not used by SessionMemory");
  }
  async counts(): Promise<{
    sessions: number;
    records: number;
    hidden: number;
  }> {
    this.calls.push("counts");
    throw new Error("FakeStore.counts is not used by SessionMemory");
  }
}

const OWNER = "owner-1";

const LIMITS: MemoryLimits = {
  shortTermMaxTurns: 8,
  shortTermMaxTokens: 512,
  historyMaxTokens: 1500,
  maxObservationTokens: 6000,
  maxSessions: 1000,
  sessionTtlS: 3600,
};

function makeTurn(i: number, query: string, answer: string): Turn {
  return {
    run_id: `run-${i}`,
    query,
    answer,
    steps: [],
    created_at: new Date(Date.UTC(2026, 10, 6, 0, 0, i)).toISOString(),
    ok: true,
    trace_id: null,
    trace_url: null,
  };
}

const QUERY_1 =
  "Thời hạn báo trước khi đơn phương chấm dứt hợp đồng lao động là bao lâu?";
const OTHER_QUERIES = [
  "Di chúc bằng văn bản cần có những nội dung gì?",
  "Điều kiện kết hôn của công dân Việt Nam là gì?",
  "Quyền thừa kế của con nuôi được quy định thế nào?",
  "Giao dịch dân sự vô hiệu do nhầm lẫn có hậu quả gì?",
  "Thời hiệu khởi kiện đòi nợ là bao nhiêu năm?",
  "Tài sản chung của vợ chồng gồm những gì?",
  "Đại diện theo ủy quyền có phải lập văn bản không?",
  "Bồi thường thiệt hại ngoài hợp đồng cần những yếu tố nào?",
  "Lãi suất chậm trả theo quy định hiện hành là bao nhiêu?",
  "Hiệu lực của di chúc miệng được xác định ra sao?",
  "Quyền sở hữu nhà ở hình thành trong tương lai thế nào?",
];

/** Turn i (1-based) of the 12-turn fixture. Turn 1 is the lao-dong question. */
function fixtureTurn(i: number): Turn {
  if (i === 1) {
    return makeTurn(
      1,
      QUERY_1,
      "Theo Điều 35, người lao động phải báo trước ít nhất 45 ngày.",
    );
  }
  return makeTurn(
    i,
    OTHER_QUERIES[i - 2],
    `Câu trả lời số ${i}: nội dung tham chiếu tới điều ${i + 20} của bộ luật.`,
  );
}

function fixtureTurns(n: number): Turn[] {
  return Array.from({ length: n }, (_, k) => fixtureTurn(k + 1));
}

function setup(opts: { maxSessions?: number; now?: () => number } = {}) {
  const store = new FakeStore();
  const memory = createSessionMemory({
    store,
    limits: { ...LIMITS, maxSessions: opts.maxSessions ?? LIMITS.maxSessions },
    now: opts.now,
  });
  return { store, memory };
}

/** Lines of the window's older turns, as the summary renders them. */
function olderLinesOf(turns: Turn[], olderCount: number): string[] {
  const lines: string[] = [];
  for (const t of turns.slice(0, olderCount)) {
    lines.push(`User: ${t.query}`);
    for (const l of t.answer.split(/\r?\n/)) {
      if (l.trim().length > 0) lines.push(`Assistant: ${l.trim()}`);
    }
  }
  return lines;
}

describe("SessionMemory window", () => {
  it("keeps 8 turns verbatim and summarises the rest after 12 turns", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "s1", fixtureTurns(12));
    memory.bindOwner(OWNER, "s1");

    const w = await memory.window("s1");

    expect(w.turns).toBeLessThanOrEqual(8);
    expect(w.turns).toBe(8);
    expect(w.tokens).toBeLessThanOrEqual(512);
    expect(w.summarized_turns).toBeGreaterThanOrEqual(4);
    expect(w.summarized_turns).toBe(4);
    expect(countTokens(w.summary)).toBeLessThanOrEqual(1500);
    expect(w.messages[0]).toEqual({ role: "user", content: OTHER_QUERIES[3] });
    expect(w.messages).toHaveLength(16);
  });

  it("the summary contains the last 3 older lines verbatim", async () => {
    const { store, memory } = setup();
    const turns = fixtureTurns(12);
    store.seed(OWNER, "s1", turns);
    memory.bindOwner(OWNER, "s1");

    const w = await memory.window("s1");
    const older = olderLinesOf(turns, 4);
    const lastThree = older.slice(-3);

    expect(lastThree).toEqual([
      "Assistant: Câu trả lời số 3: nội dung tham chiếu tới điều 23 của bộ luật.",
      "User: " + OTHER_QUERIES[2],
      "Assistant: Câu trả lời số 4: nội dung tham chiếu tới điều 24 của bộ luật.",
    ]);
    for (const line of lastThree) {
      expect(w.summary).toContain(line);
    }
  });

  it("a fresh session has an empty window", async () => {
    const { memory } = setup();
    memory.bindOwner(OWNER, "empty");
    const w = await memory.window("empty");
    expect(w).toEqual({
      messages: [],
      summary: "",
      turns: 0,
      tokens: 0,
      summarized_turns: 0,
    });
  });

  it("keeps the summary within the history budget when answers are huge", async () => {
    const { store, memory } = setup();
    const bigAnswer = Array.from({ length: 3000 }, (_, k) => `từ${k}`).join(
      " ",
    );
    const turns = Array.from({ length: 40 }, (_, k) =>
      makeTurn(
        k + 1,
        `Câu hỏi số ${k + 1} về hợp đồng?`,
        `${bigAnswer}\n${bigAnswer}`,
      ),
    );
    store.seed(OWNER, "big", turns);
    memory.bindOwner(OWNER, "big");

    const w = await memory.window("big");

    expect(countTokens(w.summary)).toBeLessThanOrEqual(1500);
    expect(w.tokens).toBeLessThanOrEqual(512);
    expect(w.turns).toBe(1);
    expect(w.summarized_turns).toBe(39);
  });

  it("recordTurn keeps the RAM window identical to a rebuild from the store", async () => {
    const { store, memory } = setup();
    const turns = fixtureTurns(12);
    store.seed(OWNER, "live", []);
    memory.bindOwner(OWNER, "live");
    await memory.window("live");
    for (const t of turns) {
      store.addTurn(t, "live", OWNER);
      expect(memory.recordTurn("live", t)).toBe(true);
    }
    const inRam = await memory.window("live");

    const rebuilt = createSessionMemory({ store, limits: LIMITS });
    rebuilt.bindOwner(OWNER, "live");
    const fromStore = await rebuilt.window("live");

    expect(inRam).toEqual(fromStore);
  });

  it("recordTurn ignores a run id it has already recorded", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "d", []);
    memory.bindOwner(OWNER, "d");
    await memory.window("d");
    const t = fixtureTurn(1);
    expect(memory.recordTurn("d", t)).toBe(true);
    expect(memory.recordTurn("d", t)).toBe(false);
    expect((await memory.window("d")).turns).toBe(1);
  });

  it("propagates store errors and never returns an empty window", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "boom", fixtureTurns(3));
    memory.bindOwner(OWNER, "boom");
    store.failNextTurns = new Error("disk gone");

    await expect(memory.window("boom")).rejects.toThrow("disk gone");
    // The failed load is not cached: the next call reads the log again.
    const w = await memory.window("boom");
    expect(w.turns).toBe(3);
  });

  it("refuses memory access for a session with no bound owner", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "s1", fixtureTurns(2));
    await expect(memory.window("s1")).rejects.toThrow(/no bound owner/);
    await expect(
      memory.recall("s1", "x", { excludeRunId: "none" }),
    ).rejects.toThrow(/no bound owner/);
  });

  it("refuses to rebind a session to a different owner", () => {
    const { memory } = setup();
    memory.bindOwner(OWNER, "s1");
    expect(() => memory.bindOwner("owner-2", "s1")).toThrow(/different owner/);
  });

  it("concurrent window() calls share one store read", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "s1", fixtureTurns(5));
    memory.bindOwner(OWNER, "s1");

    const [a, b] = await Promise.all([
      memory.window("s1"),
      memory.window("s1"),
    ]);

    expect(store.calls.filter((c) => c === "turns")).toHaveLength(1);
    expect(a).toEqual(b);
    expect(a.turns).toBe(5);
  });

  it("recordTurn dedupes a run id that is in the window but not the last one (R8-04)", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "d2", []);
    memory.bindOwner(OWNER, "d2");
    await memory.window("d2");
    const turns = fixtureTurns(3);
    for (const t of turns) {
      store.addTurn(t, "d2", OWNER);
      expect(memory.recordTurn("d2", t)).toBe(true);
    }

    expect(memory.recordTurn("d2", turns[0])).toBe(false);
    expect((await memory.window("d2")).turns).toBe(3);
  });

  it("a failed turn with no answer never makes two user messages in a row (R8-06)", async () => {
    const { store, memory } = setup();
    const failed = { ...makeTurn(2, "Câu hỏi bị lỗi?", ""), ok: false };
    store.seed(OWNER, "f", [fixtureTurn(1), failed, fixtureTurn(3)]);
    memory.bindOwner(OWNER, "f");

    const w = await memory.window("f");

    expect(w.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(w.messages[2].content).toBe(fixtureTurn(3).query);
  });

  it("a trailing failed turn leaves the messages ending on an assistant turn (R8-06)", async () => {
    const { store, memory } = setup();
    const failed = { ...makeTurn(2, "Câu hỏi bị lỗi?", ""), ok: false };
    store.seed(OWNER, "f2", [fixtureTurn(1), failed]);
    memory.bindOwner(OWNER, "f2");

    const w = await memory.window("f2");

    expect(w.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("failed turns take no window slot and no tokens, so 8 answered turns stay verbatim (RX-01)", async () => {
    const { store, memory } = setup();
    const answered = fixtureTurns(10);
    const withFailures: Turn[] = [];
    for (const t of answered) {
      withFailures.push(t);
      if (
        t.run_id === "run-2" ||
        t.run_id === "run-4" ||
        t.run_id === "run-6"
      ) {
        withFailures.push({
          ...makeTurn(0, "Câu hỏi bị lỗi?", ""),
          run_id: `failed-after-${t.run_id}`,
          ok: false,
        });
      }
    }
    store.seed(OWNER, "rf", withFailures);
    memory.bindOwner(OWNER, "rf");

    const w = await memory.window("rf");

    const shown = answered.slice(2);
    expect(w.turns).toBe(8);
    expect(w.summarized_turns).toBe(2);
    expect(w.messages).toEqual(
      shown.flatMap((t) => [
        { role: "user", content: t.query },
        { role: "assistant", content: t.answer },
      ]),
    );
    expect(w.tokens).toBe(
      shown.reduce(
        (sum, t) => sum + countTokens(t.query) + countTokens(t.answer),
        0,
      ),
    );
  });

  it("recording a failed turn changes nothing and does not evict an answered turn (RX-01)", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "rf2", []);
    memory.bindOwner(OWNER, "rf2");
    await memory.window("rf2");
    for (const t of fixtureTurns(8)) {
      store.addTurn(t, "rf2", OWNER);
      expect(memory.recordTurn("rf2", t)).toBe(true);
    }
    const failed = { ...makeTurn(9, "Câu hỏi bị lỗi?", ""), ok: false };
    store.addTurn(failed, "rf2", OWNER);

    expect(memory.recordTurn("rf2", failed)).toBe(false);
    const inRam = await memory.window("rf2");
    expect(inRam.turns).toBe(8);
    expect(inRam.summarized_turns).toBe(0);
    expect(inRam.messages).toHaveLength(16);

    const rebuilt = createSessionMemory({ store, limits: LIMITS });
    rebuilt.bindOwner(OWNER, "rf2");
    expect(inRam).toEqual(await rebuilt.window("rf2"));
  });

  it("accepts historyMaxTokens at its minimum of 64 and keeps the summary within it", async () => {
    const store = new FakeStore();
    const memory = createSessionMemory({
      store,
      limits: { ...LIMITS, historyMaxTokens: 64 },
    });
    store.seed(OWNER, "tiny", fixtureTurns(12));
    memory.bindOwner(OWNER, "tiny");

    const w = await memory.window("tiny");

    expect(w.summary.length).toBeGreaterThan(0);
    expect(countTokens(w.summary)).toBeLessThanOrEqual(64);
  });

  it("refuses historyMaxTokens below 64", () => {
    const store = new FakeStore();
    expect(() =>
      createSessionMemory({
        store,
        limits: { ...LIMITS, historyMaxTokens: 63 },
      }),
    ).toThrow(RangeError);
  });
});

describe("SessionMemory recall", () => {
  it("finds the turn-1 query after 12 turns (reads the full log, not the window)", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "s1", fixtureTurns(12));
    memory.bindOwner(OWNER, "s1");
    await memory.window("s1");

    const r = await memory.recall(
      "s1",
      "thời hạn báo trước chấm dứt hợp đồng lao động",
      {
        excludeRunId: "run-12",
      },
    );

    expect(r.fresh_session).toBe(false);
    expect(r.items[0]).toEqual({
      kind: "query",
      run_id: "run-1",
      content: QUERY_1,
    });
    expect(r.items.length).toBeLessThanOrEqual(3);
  });

  it("excludes the in-flight run id", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "s1", fixtureTurns(12));
    memory.bindOwner(OWNER, "s1");

    const r = await memory.recall(
      "s1",
      "thời hạn báo trước chấm dứt hợp đồng lao động",
      {
        excludeRunId: "run-1",
      },
    );

    expect(r.items.some((i) => i.run_id === "run-1")).toBe(false);
  });

  it("'recent' keys return the latest queries, newest first", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "s1", fixtureTurns(12));
    memory.bindOwner(OWNER, "s1");

    const r = await memory.recall("s1", "trước đó", { excludeRunId: "run-12" });

    expect(r.items.map((i) => i.run_id)).toEqual(["run-11", "run-10", "run-9"]);
    expect(r.items.every((i) => i.kind === "query")).toBe(true);
  });

  it("'first question' keys return the earliest queries", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "s1", fixtureTurns(5));
    memory.bindOwner(OWNER, "s1");

    const r = await memory.recall("s1", "Câu hỏi đầu tiên của tôi là gì?", {
      excludeRunId: "run-5",
    });

    expect(r.items[0]).toEqual({
      kind: "query",
      run_id: "run-1",
      content: QUERY_1,
    });
  });

  it("returns no items rather than inventing history when nothing overlaps", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "s1", fixtureTurns(3));
    memory.bindOwner(OWNER, "s1");

    const r = await memory.recall("s1", "xe hơi nhập khẩu thuế suất", {
      excludeRunId: "run-3",
    });

    expect(r).toEqual({ items: [], fresh_session: false });
  });

  it("a fresh session returns fresh_session:true and no items", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "new", [fixtureTurn(1)]);
    memory.bindOwner(OWNER, "new");

    // The only turn is the in-flight one, so there is nothing earlier to recall.
    const r = await memory.recall("new", "trước đó", { excludeRunId: "run-1" });

    expect(r).toEqual({ items: [], fresh_session: true });
  });

  it("never crosses sessions", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "A", fixtureTurns(4));
    store.seed(OWNER, "B", [
      makeTurn(100, "Di chúc bằng văn bản cần gì?", "Cần chữ ký."),
    ]);
    memory.bindOwner(OWNER, "A");
    memory.bindOwner(OWNER, "B");

    const fromB = await memory.recall("B", QUERY_1, { excludeRunId: "run-x" });
    expect(fromB.items).toEqual([]);
    expect(fromB.fresh_session).toBe(false);

    const fromA = await memory.recall("A", QUERY_1, { excludeRunId: "run-x" });
    expect(fromA.items[0].run_id).toBe("run-1");
  });

  it("rejects a limit outside 1..3", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "s1", fixtureTurns(2));
    memory.bindOwner(OWNER, "s1");
    await expect(
      memory.recall("s1", "x", { excludeRunId: "none", limit: 4 }),
    ).rejects.toThrow(RangeError);
  });

  it.each([
    "tôi đã hỏi gì",
    "nhắc lại",
    "lúc nãy",
    "lần trước",
    "what did I ask",
  ])(
    "conversation key '%s' on a non-fresh session returns the latest query (R8-02)",
    async (key) => {
      const { store, memory } = setup();
      store.seed(OWNER, "s1", fixtureTurns(3));
      memory.bindOwner(OWNER, "s1");

      const r = await memory.recall("s1", key, { excludeRunId: "run-3" });

      expect(r.fresh_session).toBe(false);
      expect(r.items).toEqual([
        { kind: "query", run_id: "run-2", content: OTHER_QUERIES[0] },
        { kind: "query", run_id: "run-1", content: QUERY_1 },
      ]);
    },
  );

  it("a topical key with zero overlap still returns no items (R8-02)", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "s1", fixtureTurns(3));
    memory.bindOwner(OWNER, "s1");

    const r = await memory.recall("s1", "xe hơi nhập khẩu thuế suất", {
      excludeRunId: "run-3",
    });

    expect(r).toEqual({ items: [], fresh_session: false });
  });

  it("limit 1 and limit 2 return that many of the newest queries", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "s1", fixtureTurns(12));
    memory.bindOwner(OWNER, "s1");

    const one = await memory.recall("s1", "trước đó", {
      excludeRunId: "run-12",
      limit: 1,
    });
    const two = await memory.recall("s1", "trước đó", {
      excludeRunId: "run-12",
      limit: 2,
    });

    expect(one.items.map((i) => i.run_id)).toEqual(["run-11"]);
    expect(two.items.map((i) => i.run_id)).toEqual(["run-11", "run-10"]);
  });

  it("returns answer items when the key matches an answer", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "s1", fixtureTurns(3));
    memory.bindOwner(OWNER, "s1");

    const r = await memory.recall("s1", "Điều 35 45 ngày", {
      excludeRunId: "run-3",
    });

    expect(r.items[0]).toEqual({
      kind: "answer",
      run_id: "run-1",
      content: fixtureTurn(1).answer,
    });
  });

  it("reads only the store's turns() method", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "s1", fixtureTurns(3));
    memory.bindOwner(OWNER, "s1");
    await memory.window("s1");
    await memory.recall("s1", QUERY_1, { excludeRunId: "run-9" });
    expect(new Set(store.calls)).toEqual(new Set(["turns"]));
  });
});

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

describe("LRU and idle TTL", () => {
  it("evicts the least recently used window beyond the cap, then rebuilds it from the store", async () => {
    const { store, memory } = setup({ maxSessions: 2 });
    store.seed(OWNER, "A", fixtureTurns(3));
    store.seed(OWNER, "B", fixtureTurns(2));
    store.seed(OWNER, "C", fixtureTurns(2));
    for (const id of ["A", "B"]) memory.bindOwner(OWNER, id);
    await memory.window("A");
    await memory.window("B");
    await memory.window("A"); // A is now the most recent
    memory.bindOwner(OWNER, "C");
    await memory.window("C"); // evicts B

    expect(memory.isActive("A")).toBe(true);
    expect(memory.isActive("B")).toBe(false);
    expect(memory.isActive("C")).toBe(true);

    const before = store.calls.length;
    const rebuilt = await memory.window("B");
    expect(store.calls.length).toBe(before + 1);
    expect(rebuilt.turns).toBe(2);
    expect(memory.isActive("B")).toBe(true);
  });

  it("drops the window after the idle TTL and rebuilds it from the store", async () => {
    let t = 0;
    const { store, memory } = setup({ now: () => t });
    store.seed(OWNER, "s1", fixtureTurns(4));
    memory.bindOwner(OWNER, "s1");
    const first = await memory.window("s1");
    expect(memory.isActive("s1")).toBe(true);

    t += LIMITS.sessionTtlS * 1000 - 1;
    expect(memory.isActive("s1")).toBe(true);

    t += 1;
    expect(memory.isActive("s1")).toBe(false);

    const callsBefore = store.calls.length;
    const second = await memory.window("s1");
    expect(store.calls.length).toBe(callsBefore + 1);
    expect(second).toEqual(first);
    expect(memory.isActive("s1")).toBe(true);
  });

  it("forget() drops the window and keeps the log intact", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "s1", fixtureTurns(2));
    memory.bindOwner(OWNER, "s1");
    await memory.window("s1");
    expect(memory.forget("s1")).toBe(true);
    expect(memory.isActive("s1")).toBe(false);
    expect((await memory.window("s1")).turns).toBe(2);
  });
});

describe("stats (C10)", () => {
  it("reports short-term counters consistent with window() and recall counters", async () => {
    const { store, memory } = setup();
    store.seed(OWNER, "A", fixtureTurns(12));
    store.seed(OWNER, "B", fixtureTurns(1));
    memory.bindOwner(OWNER, "A");
    memory.bindOwner(OWNER, "B");
    const wa = await memory.window("A");
    const wb = await memory.window("B");

    await memory.recall("A", QUERY_1, { excludeRunId: "run-12" }); // hit
    await memory.recall("B", "trước đó", { excludeRunId: "run-1" }); // fresh, empty

    const s = memory.stats();
    expect(s.short_term).toEqual({
      active_sessions: 2,
      turns: wa.turns + wb.turns,
      tokens: wa.tokens + wb.tokens,
      max_turns: 8,
      max_tokens: 512,
      max_sessions: 1000,
      ttl_s: 3600,
    });
    expect(s.recall).toEqual({ calls: 2, hits: 1, empty: 1 });
  });

  it("active_sessions drops after an LRU eviction", async () => {
    const { store, memory } = setup({ maxSessions: 1 });
    store.seed(OWNER, "A", fixtureTurns(1));
    store.seed(OWNER, "B", fixtureTurns(1));
    memory.bindOwner(OWNER, "A");
    memory.bindOwner(OWNER, "B");
    await memory.window("A");
    await memory.window("B");
    expect(memory.stats().short_term.active_sessions).toBe(1);
  });
});

describe("limit validation", () => {
  it("refuses a non-positive limit at construction", () => {
    const store = new FakeStore();
    expect(() =>
      createSessionMemory({
        store,
        limits: { ...LIMITS, shortTermMaxTurns: 0 },
      }),
    ).toThrow(RangeError);
    expect(() =>
      createSessionMemory({ store, limits: { ...LIMITS, sessionTtlS: 0 } }),
    ).toThrow(RangeError);
  });
});

describe("port shape", () => {
  it("the service satisfies the contract SessionMemory port", () => {
    const { memory } = setup();
    const port: SessionMemory = memory;
    expect(typeof port.window).toBe("function");
    expect(typeof port.recall).toBe("function");
  });
});
