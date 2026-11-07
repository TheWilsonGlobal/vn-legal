import { describe, expect, it } from "vitest";
import {
  OWNER_A,
  OWNER_B,
  FakeStore,
  as,
  harness,
} from "./agent-fixtures";

// ----------------------------------------------------------------------------
// AC 7: 400 invalid_request
// ----------------------------------------------------------------------------

const BAD_BODIES: [string, unknown][] = [
  ["empty query", { query: "" }],
  ["missing query", {}],
  ["query over 1000 characters", { query: "a".repeat(1001) }],
  ["blank query", { query: "   " }],
  ["mode x", { query: "q", mode: "x" }],
  ["filters with a number", { query: "q", filters: { part_id: 5 } }],
  ["session_id as a number", { query: "q", session_id: 5 }],
];

describe("AC 7: invalid bodies return 400 invalid_request", () => {
  for (const path of ["/api/agent/stream", "/api/agent/run"]) {
    for (const [name, body] of BAD_BODIES) {
      it(`${path}: ${name}`, async () => {
        const { app, runner } = await harness();
        const res = await app.inject({
          method: "POST",
          url: path,
          headers: as(OWNER_A),
          payload: body as object,
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe("invalid_request");
        expect(Array.isArray(res.json().details)).toBe(true);
        expect(res.headers["content-type"] ?? "").not.toContain(
          "text/event-stream",
        );
        expect(runner.inputs).toHaveLength(0);
      });
    }

    it(`${path}: malformed JSON is 400 invalid_request`, async () => {
      const { app } = await harness();
      const res = await app.inject({
        method: "POST",
        url: path,
        headers: { ...as(OWNER_A), "content-type": "application/json" },
        payload: "{not json",
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_request");
    });
  }

  it("a 1000-character query is accepted, and reaches the runner unchanged in length", async () => {
    const { app, runner } = await harness();
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers: as(OWNER_A),
      payload: { query: "a".repeat(1000) },
    });
    expect(res.statusCode).toBe(200);
    expect(runner.inputs[0].query).toHaveLength(1000);
  });

  it("the query is NFC-normalised before it reaches the runner", async () => {
    const { app, runner } = await harness();
    const decomposed = "Điều 25".normalize("NFD");
    await app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers: as(OWNER_A),
      payload: { query: decomposed },
    });
    expect(runner.inputs[0].query).toBe("Điều 25".normalize("NFC"));
  });
});

// ----------------------------------------------------------------------------
// 404 on C5, C6 and C8
// ----------------------------------------------------------------------------

describe("404 on C5, C6 and C8", () => {
  it("C5: foreign session gives exactly {error:session_not_found}", async () => {
    const store = new FakeStore();
    const id = store.seed(OWNER_A);
    const { app } = await harness({ store });
    const res = await app.inject({
      method: "GET",
      url: `/api/agent/sessions/${id}`,
      headers: as(OWNER_B),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "session_not_found" });
  });

  it("C6: foreign delete gives 404 and leaves the owner's session visible", async () => {
    const store = new FakeStore();
    const id = store.seed(OWNER_A);
    const { app, runner } = await harness({ store });
    const res = await app.inject({
      method: "DELETE",
      url: `/api/agent/sessions/${id}`,
      headers: as(OWNER_B),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "session_not_found" });
    expect(runner.forgotten).toHaveLength(0);
    const mine = await app.inject({
      method: "GET",
      url: `/api/agent/sessions/${id}`,
      headers: as(OWNER_A),
    });
    expect(mine.statusCode).toBe(200);
  });

  it("C8: foreign session_id gives 404", async () => {
    const store = new FakeStore();
    const id = store.seed(OWNER_A);
    const { app } = await harness({ store });
    const res = await app.inject({
      method: "GET",
      url: `/api/agent/traces?session_id=${id}`,
      headers: as(OWNER_B),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "session_not_found" });
  });

  it("C5, C6 and C8 refuse malformed ids before any store call", async () => {
    const store = new FakeStore();
    const { app } = await harness({ store });
    const id = encodeURIComponent("../../package.json");
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
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/agent/traces?session_id=${id}`,
          headers: as(OWNER_A),
        })
      ).statusCode,
    ).toBe(404);
    expect(store.calls).toHaveLength(0);
  });
});
