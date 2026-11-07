import { describe, it, expect } from "vitest";
import type { SessionMemory } from "../../../../../src/agent/contract";
import {
  createSessionMemory,
} from "../../../../../src/agent/memory/session-memory";
import {
  FakeStore,
  LIMITS,
  OWNER,
  fixtureTurns,
  setup,
} from "./session-memory-fixtures";

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
    const QUERY_1 =
      "Thời hạn báo trước khi đơn phương chấm dứt hợp đồng lao động là bao lâu?";
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
