import { describe, it, expect } from "vitest";
import {
  createSessionMemory,
} from "../../../../../src/agent/memory/session-memory";
import { countTokens } from "../../../../../src/agent/memory";
import type { Turn } from "../../../../../src/agent/contract";
import {
  FakeStore,
  LIMITS,
  OTHER_QUERIES,
  OWNER,
  fixtureTurn,
  fixtureTurns,
  makeTurn,
  olderLinesOf,
  setup,
} from "./session-memory-fixtures";

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
