import { describe, expect, it } from "vitest";
import type { Turn } from "../../../../../src/agent/contract";
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
// C3, C4, C5, C6, C7
// ----------------------------------------------------------------------------

describe("C3 create session", () => {
  it("returns 201 {session_id, created_at} owned by the caller", async () => {
    const store = new FakeStore();
    const { app } = await harness({ store });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/sessions",
      headers: as(OWNER_A),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(["created_at", "session_id"]);
    expect(store.sessions.get(body.session_id)!.owner).toBe(OWNER_A);
  });
});

describe("C4 list sessions", () => {
  it("returns the caller's visible sessions, newest first, with message_count = turns * 2", async () => {
    const store = new FakeStore();
    const jan = store.seed(OWNER_A, {
      created_at: "2026-01-01T00:00:00.000Z",
      turns: 1,
    });
    const mar = store.seed(OWNER_A, {
      created_at: "2026-03-01T00:00:00.000Z",
      turns: 3,
      record_count: 9,
      tokens: 40,
      active: true,
    });
    const feb = store.seed(OWNER_A, {
      created_at: "2026-02-01T00:00:00.000Z",
      turns: 0,
    });
    store.seed(OWNER_B, { created_at: "2026-04-01T00:00:00.000Z" });
    const hidden = store.seed(OWNER_A, {
      created_at: "2026-05-01T00:00:00.000Z",
    });
    await store.softDelete(OWNER_A, hidden);
    const { app } = await harness({ store });

    const res = await app.inject({
      method: "GET",
      url: "/api/agent/sessions",
      headers: as(OWNER_A),
    });
    expect(res.statusCode).toBe(200);
    const sessions = res.json().sessions as {
      session_id: string;
      message_count: number;
      active: boolean;
      record_count: number;
      tokens: number;
    }[];
    expect(sessions.map((s) => s.session_id)).toEqual([mar, feb, jan]);
    expect(sessions[0]).toMatchObject({
      message_count: 6,
      active: true,
      record_count: 9,
      tokens: 40,
    });
    expect(sessions[1].message_count).toBe(0);
    expect(Object.keys(sessions[0]).sort()).toEqual([
      "active",
      "created_at",
      "last_active_at",
      "message_count",
      "record_count",
      "session_id",
      "title",
      "tokens",
      "turns",
    ]);
  });
});

describe("C5 get session", () => {
  it("returns the title and turns in the contract shape", async () => {
    const store = new FakeStore();
    const turn: Turn & { extra?: string } = {
      run_id: "r1",
      query: "Q1",
      answer: "A1",
      steps: [],
      created_at: "2026-05-01T00:00:00.000Z",
      ok: true,
      trace_id: null,
      trace_url: null,
    };
    const id = store.seed(OWNER_A, { title: "Hỏi về Điều 25" }, [turn]);
    const { app } = await harness({ store });
    const res = await app.inject({
      method: "GET",
      url: `/api/agent/sessions/${id}`,
      headers: as(OWNER_A),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      session_id: id,
      title: "Hỏi về Điều 25",
      turns: [turn],
    });
  });
});

describe("C6 soft delete", () => {
  it("returns {session_id, deleted:true, mode:'soft'}, calls the runner's forgetSession, and then 404s", async () => {
    const store = new FakeStore();
    const id = store.seed(OWNER_A);
    const { app, runner } = await harness({ store });
    const res = await app.inject({
      method: "DELETE",
      url: `/api/agent/sessions/${id}`,
      headers: as(OWNER_A),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ session_id: id, deleted: true, mode: "soft" });
    expect(runner.forgotten).toEqual([id]);
    expect(store.sessions.get(id)!.hidden).toBe(true);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/agent/sessions/${id}`,
          headers: as(OWNER_A),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/agent/sessions/${id}`,
          headers: as(OWNER_A),
        })
      ).statusCode,
    ).toBe(404);
  });

  it("R2-04: C6 while a run is busy gives 409 session_busy (K10), so the delete is refused, not queued", async () => {
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
    const { app, runner } = await harness({ store, script });
    const first = app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers: as(OWNER_A),
      payload: { query: "q", session_id: id },
    });
    await startedP;

    const busyDelete = await app.inject({
      method: "DELETE",
      url: `/api/agent/sessions/${id}`,
      headers: as(OWNER_A),
    });
    expect(busyDelete.statusCode).toBe(409);
    expect(busyDelete.json()).toEqual({ error: "session_busy" });
    expect(runner.forgotten).toHaveLength(0);
    expect(store.sessions.get(id)!.hidden).toBe(false);

    const foreignDelete = await app.inject({
      method: "DELETE",
      url: `/api/agent/sessions/${id}`,
      headers: as(OWNER_B),
    });
    expect(foreignDelete.statusCode).toBe(404);
    expect(foreignDelete.json()).toEqual({ error: "session_not_found" });

    release();
    expect((await first).statusCode).toBe(200);
    const afterRun = await app.inject({
      method: "DELETE",
      url: `/api/agent/sessions/${id}`,
      headers: as(OWNER_A),
    });
    expect(afterRun.statusCode).toBe(200);
  });

  it("R2-03: a forgetSession failure gives 500 and leaves the session visible, because nothing was deleted", async () => {
    const store = new FakeStore();
    const id = store.seed(OWNER_A);
    const { app, runner } = await harness({ store });
    runner.forgetSession = async () => {
      throw new Error("memory backend unavailable");
    };
    const res = await app.inject({
      method: "DELETE",
      url: `/api/agent/sessions/${id}`,
      headers: as(OWNER_A),
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "internal" });
    expect(store.sessions.get(id)!.hidden).toBe(false);
    const still = await app.inject({
      method: "GET",
      url: `/api/agent/sessions/${id}`,
      headers: as(OWNER_A),
    });
    expect(still.statusCode).toBe(200);
  });
});

describe("C7 examples", () => {
  it("returns the eight original chips in order, then multi-hop, then the recall chip last", async () => {
    const { app } = await harness();
    const res = await app.inject({ method: "GET", url: "/api/agent/examples" });
    expect(res.statusCode).toBe(200);
    const chips = res.json() as { label: string; query: string }[];
    expect(chips.slice(0, 8).map((c) => c.label)).toEqual([
      "Quyền của người chưa thành niên",
      "Điều kiện kết hợp đồng",
      "Sở hữu tài sản chung",
      "Thừa kế theo pháp luật",
      "Bồi thường thiệt hại",
      "Quyền nhân thân (Điều 25)",
      "Giám hộ (Điều 46)",
      "Năng lực hành vi dân sự",
    ]);
    expect(chips.length).toBeGreaterThan(9);
    expect(chips.at(-1)).toEqual({
      label: "Nhắc lại: tôi đã hỏi gì trước đó?",
      query: "Tôi đã hỏi gì trước đó?",
    });
    for (const c of chips) {
      expect(c.query.length).toBeGreaterThan(0);
      expect(c.query.length).toBeLessThanOrEqual(1000);
    }
  });
});
