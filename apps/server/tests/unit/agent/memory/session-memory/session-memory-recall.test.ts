import { describe, it, expect } from "vitest";
import {
  OTHER_QUERIES,
  OWNER,
  QUERY_1,
  fixtureTurn,
  fixtureTurns,
  makeTurn,
  setup,
} from "./session-memory-fixtures";

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
