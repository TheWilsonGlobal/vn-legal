import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  OWNER_A,
  OWNER_B,
  FakeStore,
  type RunScript,
  as,
  doneFor,
  harness,
} from "./agent-fixtures";

// ----------------------------------------------------------------------------
// 404 for unknown, hidden, foreign and malformed session ids (AC 19, 22)
// ----------------------------------------------------------------------------

describe("404 session_not_found on C1 and C2", () => {
  for (const path of ["/api/agent/stream", "/api/agent/run"]) {
    it(`${path}: unknown id gives 404 before any run`, async () => {
      const { app, runner, store } = await harness();
      const res = await app.inject({
        method: "POST",
        url: path,
        headers: as(OWNER_A),
        payload: { query: "q", session_id: randomUUID() },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "session_not_found" });
      expect(runner.inputs).toHaveLength(0);
      expect(store.calls.some((c) => c.startsWith("create"))).toBe(false);
    });

    it(`${path}: hidden session gives 404`, async () => {
      const store = new FakeStore();
      const id = store.seed(OWNER_A);
      await store.softDelete(OWNER_A, id);
      const { app, runner } = await harness({ store });
      const res = await app.inject({
        method: "POST",
        url: path,
        headers: as(OWNER_A),
        payload: { query: "q", session_id: id },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "session_not_found" });
      expect(runner.inputs).toHaveLength(0);
    });

    it(`${path}: foreign session gives 404 with the same body as unknown`, async () => {
      const store = new FakeStore();
      const id = store.seed(OWNER_A);
      const { app, runner } = await harness({ store });
      const res = await app.inject({
        method: "POST",
        url: path,
        headers: as(OWNER_B),
        payload: { query: "q", session_id: id },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "session_not_found" });
      expect(runner.inputs).toHaveLength(0);
    });

    it(`${path}: a malformed id gives 404 and no store call is made with it (AC 22)`, async () => {
      const bad = [
        "../../package.json",
        "x",
        "a/b",
        "..\\..\\package.json",
        "A".repeat(36),
        "a".repeat(35),
      ];
      for (const id of bad) {
        const store = new FakeStore();
        const { app, runner } = await harness({ store });
        const res = await app.inject({
          method: "POST",
          url: path,
          headers: as(OWNER_A),
          payload: { query: "q", session_id: id },
        });
        expect(res.statusCode, id).toBe(404);
        expect(res.json()).toEqual({ error: "session_not_found" });
        expect(store.calls, id).toHaveLength(0);
        expect(runner.inputs, id).toHaveLength(0);
      }
    });

    it(`${path}: a visible session is claimed and passed to the runner with created=false`, async () => {
      const store = new FakeStore();
      const id = store.seed(OWNER_A);
      const { app, runner } = await harness({ store });
      const res = await app.inject({
        method: "POST",
        url: path,
        headers: as(OWNER_A),
        payload: { query: "q", session_id: id },
      });
      expect(res.statusCode).toBe(200);
      expect(runner.inputs[0]).toMatchObject({
        sessionId: id,
        created: false,
        owner: OWNER_A,
      });
    });

    it(`${path}: with no session_id a new session is created and passed with created=true`, async () => {
      const store = new FakeStore();
      const { app, runner } = await harness({ store });
      const res = await app.inject({
        method: "POST",
        url: path,
        headers: as(OWNER_A),
        payload: { query: "q", session_id: null },
      });
      expect(res.statusCode).toBe(200);
      expect(runner.inputs[0].created).toBe(true);
      expect(runner.inputs[0].owner).toBe(OWNER_A);
      expect(store.calls).toContain("create");
      expect(store.sessions.has(runner.inputs[0].sessionId)).toBe(true);
    });
  }
});

// ----------------------------------------------------------------------------
// 409 session_busy (K10)
// ----------------------------------------------------------------------------

describe("409 session_busy", () => {
  it("a second run in the same session gets 409 while the first is active, then succeeds after it is done", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const startedP = new Promise<void>((r) => (started = r));
    const script: RunScript = async function* (input) {
      yield {
        event: "session",
        data: { session_id: input.sessionId, created: input.created },
      };
      started();
      await gate;
      yield doneFor(input.sessionId);
    };
    const store = new FakeStore();
    const id = store.seed(OWNER_A);
    const { app } = await harness({ store, script });

    const first = app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers: as(OWNER_A),
      payload: { query: "q", session_id: id },
    });
    await startedP;

    const busyRun = await app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers: as(OWNER_A),
      payload: { query: "q", session_id: id },
    });
    expect(busyRun.statusCode).toBe(409);
    expect(busyRun.json()).toEqual({ error: "session_busy" });

    const busyStream = await app.inject({
      method: "POST",
      url: "/api/agent/stream",
      headers: as(OWNER_A),
      payload: { query: "q", session_id: id },
    });
    expect(busyStream.statusCode).toBe(409);
    expect(busyStream.json()).toEqual({ error: "session_busy" });

    release();
    expect((await first).statusCode).toBe(200);

    const after = await app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers: as(OWNER_A),
      payload: { query: "q", session_id: id },
    });
    expect(after.statusCode).toBe(200);
  });

  it("the lock is released after an error event", async () => {
    let calls = 0;
    const script: RunScript = async function* (input) {
      calls += 1;
      yield {
        event: "session",
        data: { session_id: input.sessionId, created: input.created },
      };
      if (calls === 1) {
        yield {
          event: "error",
          data: { code: "llm_unreachable", detail: "down" },
        };
        return;
      }
      yield doneFor(input.sessionId);
    };
    const store = new FakeStore();
    const id = store.seed(OWNER_A);
    const { app } = await harness({ store, script });
    const first = await app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers: as(OWNER_A),
      payload: { query: "q", session_id: id },
    });
    expect(first.statusCode).toBe(502);
    const second = await app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers: as(OWNER_A),
      payload: { query: "q", session_id: id },
    });
    expect(second.statusCode).toBe(200);
  });

  it("the lock is released when the runner throws", async () => {
    let calls = 0;
    const script: RunScript = async function* (input) {
      calls += 1;
      yield {
        event: "session",
        data: { session_id: input.sessionId, created: input.created },
      };
      if (calls === 1) throw new Error("boom");
      yield doneFor(input.sessionId);
    };
    const store = new FakeStore();
    const id = store.seed(OWNER_A);
    const { app } = await harness({ store, script });
    const first = await app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers: as(OWNER_A),
      payload: { query: "q", session_id: id },
    });
    expect(first.statusCode).toBe(500);
    expect(first.json()).toEqual({ error: "internal" });
    const second = await app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers: as(OWNER_A),
      payload: { query: "q", session_id: id },
    });
    expect(second.statusCode).toBe(200);
  });
});
