import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../../../../../src/agent/contract";
import {
  OWNER_A,
  OWNER_B,
  FakeStore,
  as,
  harness,
} from "./agent-fixtures";

// ----------------------------------------------------------------------------
// C8 traces & C8v verify
// ----------------------------------------------------------------------------

describe("C8 traces paging and validation", () => {
  const badQueries = [
    "limit=0",
    "limit=501",
    "limit=abc",
    "limit=-1",
    "offset=-1",
    "offset=x",
    "kind=bogus",
    "limit=",
  ];
  for (const qs of badQueries) {
    it(`400 for ${qs}`, async () => {
      const store = new FakeStore();
      const { app } = await harness({ store });
      const res = await app.inject({
        method: "GET",
        url: `/api/agent/traces?${qs}`,
        headers: as(OWNER_A),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_request");
      expect(store.calls).toHaveLength(0);
    });
  }

  it("accepts limit=1 and limit=500, and defaults to offset 0, limit 50", async () => {
    const store = new FakeStore();
    const { app } = await harness({ store });
    for (const qs of ["limit=1", "limit=500", ""]) {
      const res = await app.inject({
        method: "GET",
        url: `/api/agent/traces?${qs}`,
        headers: as(OWNER_A),
      });
      expect(res.statusCode, qs).toBe(200);
    }
    const pages = store.recordQueries.filter((q) => q.kind === undefined);
    expect(pages.map((p) => [p.offset, p.limit])).toEqual([
      [0, 1],
      [0, 500],
      [0, 50],
    ]);
  });

  it("returns records, total and kind_counts for all six kinds, with a kind filter not affecting the counts", async () => {
    const store = new FakeStore();
    const id = store.seed(OWNER_A);
    const add = (kind: SessionRecord["kind"], content: string) =>
      store.rows.push({
        session_id: id,
        run_id: "r",
        seq: store.rows.length,
        created_at: "2026-05-01T00:00:00.000Z",
        kind,
        content,
      });
    add("query", "q1");
    add("query", "q2");
    add("step", "s1");
    add("step", "s2");
    add("step", "s3");
    add("answer", "a1");
    const { app } = await harness({ store });

    const all = await app.inject({
      method: "GET",
      url: `/api/agent/traces?session_id=${id}`,
      headers: as(OWNER_A),
    });
    expect(all.statusCode).toBe(200);
    const body = all.json();
    expect(body.total).toBe(6);
    expect(body.kind_counts).toEqual({
      session_created: 0,
      query: 2,
      step: 3,
      answer: 1,
      error: 0,
      deleted: 0,
    });

    const steps = await app.inject({
      method: "GET",
      url: `/api/agent/traces?session_id=${id}&kind=step&limit=2`,
      headers: as(OWNER_A),
    });
    const sBody = steps.json();
    expect(sBody.total).toBe(3);
    expect(sBody.records).toHaveLength(2);
    expect(
      sBody.records.every((r: { kind: string }) => r.kind === "step"),
    ).toBe(true);
    expect(sBody.kind_counts).toEqual({
      session_created: 0,
      query: 2,
      step: 3,
      answer: 1,
      error: 0,
      deleted: 0,
    });
  });

  it("the q filter narrows total and kind_counts, owner-wide when no session_id is given", async () => {
    const store = new FakeStore();
    const mine = store.seed(OWNER_A);
    const other = store.seed(OWNER_B);
    store.rows.push({
      session_id: mine,
      run_id: null,
      seq: 0,
      created_at: "t",
      kind: "query",
      content: "Điều 25",
    });
    store.rows.push({
      session_id: mine,
      run_id: null,
      seq: 1,
      created_at: "t",
      kind: "query",
      content: "khác",
    });
    store.rows.push({
      session_id: other,
      run_id: null,
      seq: 0,
      created_at: "t",
      kind: "query",
      content: "Điều 25",
    });
    const { app } = await harness({ store });
    const res = await app.inject({
      method: "GET",
      url: "/api/agent/traces?q=%C4%90i%E1%BB%81u%2025",
      headers: as(OWNER_A),
    });
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.records[0].session_id).toBe(mine);
    expect(body.kind_counts.query).toBe(1);
  });

  it("returns records newest first, so the first record is the latest seq in the session", async () => {
    const store = new FakeStore();
    const id = store.seed(OWNER_A);
    for (let seq = 0; seq < 4; seq++) {
      store.rows.push({
        session_id: id,
        run_id: "r",
        seq,
        created_at: `2026-05-01T00:00:0${seq}.000Z`,
        kind: "query",
        content: `q${seq}`,
      });
    }
    const { app } = await harness({ store });
    const res = await app.inject({
      method: "GET",
      url: `/api/agent/traces?session_id=${id}&limit=2`,
      headers: as(OWNER_A),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(4);
    expect(body.records.map((r: { seq: number }) => r.seq)).toEqual([3, 2]);
  });
});

describe("C8v verify", () => {
  it("returns ok, records and first_bad from the store", async () => {
    const store = new FakeStore();
    const { app } = await harness({ store });
    const res = await app.inject({
      method: "GET",
      url: "/api/agent/traces/verify",
      headers: as(OWNER_A),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, records: 0, first_bad: null });
  });
});
