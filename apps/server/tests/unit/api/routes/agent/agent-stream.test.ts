import { describe, expect, it } from "vitest";
import {
  OWNER_A,
  type RunScript,
  as,
  doneFor,
  harness,
  parseSse,
} from "./agent-fixtures";

// ----------------------------------------------------------------------------
// C1 SSE framing, order and failure
// ----------------------------------------------------------------------------

describe("C1 SSE stream", () => {
  it("writes event/data frames in runner order, ending with done, and sets the SSE content type", async () => {
    const script: RunScript = async function* (input) {
      yield {
        event: "session",
        data: { session_id: input.sessionId, created: input.created },
      };
      yield {
        event: "step",
        data: {
          index: 0,
          kind: "thought",
          content: "Đang nghĩ",
          tool: null,
          tool_input: null,
          ok: true,
          duration_ms: 1,
        },
      };
      yield { event: "token", data: { text: "Xin " } };
      yield { event: "reset", data: {} as Record<string, never> };
      yield {
        event: "step",
        data: {
          index: 1,
          kind: "action",
          content: "search",
          tool: "search_legal_articles",
          tool_input: "{}",
          ok: true,
          duration_ms: 0,
        },
      };
      yield {
        event: "step",
        data: {
          index: 2,
          kind: "final",
          content: "Đáp án",
          tool: null,
          tool_input: null,
          ok: true,
          duration_ms: 3,
        },
      };
      yield doneFor(input.sessionId, "Đáp án");
    };
    const { app } = await harness({ script });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/stream",
      headers: as(OWNER_A),
      payload: { query: "q" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const events = parseSse(res.body);
    expect(events.map((e) => e.event)).toEqual([
      "session",
      "step",
      "token",
      "reset",
      "step",
      "step",
      "done",
    ]);
    expect(events[0].data).toEqual({
      session_id: expect.any(String),
      created: true,
    });
    expect(events[4].data).toMatchObject({
      index: 1,
      kind: "action",
      tool: "search_legal_articles",
    });
    expect((events.at(-1)!.data as { answer: string }).answer).toBe("Đáp án");
    expect(
      events.filter((e) => e.event === "done" || e.event === "error"),
    ).toHaveLength(1);
  });

  it("the owner cookie is still sent on a hijacked SSE response", async () => {
    const { app } = await harness();
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/stream",
      payload: { query: "q" },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers["set-cookie"] ?? "");
    expect(setCookie).toMatch(/^vl_owner=[a-f0-9]{32};/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Secure/);
  });

  it("R2-06: SSE framing holds when token, step and done text contain \\n, \\r and \\u2028", async () => {
    const tricky = "dòng 1\ndòng 2\r\ndòng 3\rdòng 4 dòng 5\n\nhết";
    const script: RunScript = async function* (input) {
      yield {
        event: "session",
        data: { session_id: input.sessionId, created: input.created },
      };
      yield { event: "token", data: { text: tricky } };
      yield {
        event: "step",
        data: {
          index: 0,
          kind: "observation",
          content: tricky,
          tool: null,
          tool_input: null,
          ok: true,
          duration_ms: 1,
        },
      };
      yield doneFor(input.sessionId, tricky);
    };
    const { app } = await harness({ script });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/stream",
      headers: as(OWNER_A),
      payload: { query: "q" },
    });
    expect(res.statusCode).toBe(200);
    const frames = res.body.split("\n\n").filter((b) => b.length > 0);
    expect(frames).toHaveLength(4);
    for (const f of frames) expect(f.split("\n")).toHaveLength(2);
    const events = parseSse(res.body);
    expect(events.map((e) => e.event)).toEqual([
      "session",
      "token",
      "step",
      "done",
    ]);
    expect(events[1].data).toEqual({ text: tricky });
    expect((events[2].data as { content: string }).content).toBe(tricky);
    expect((events[3].data as { answer: string }).answer).toBe(tricky);
  });

  it("a runner that throws mid-stream yields an error event with code internal and no done", async () => {
    const script: RunScript = async function* (input) {
      yield {
        event: "session",
        data: { session_id: input.sessionId, created: input.created },
      };
      yield {
        event: "step",
        data: {
          index: 0,
          kind: "thought",
          content: "x",
          tool: null,
          tool_input: null,
          ok: true,
          duration_ms: 1,
        },
      };
      throw new Error("secret-internal-detail sk-leak-should-not-appear");
    };
    const { app } = await harness({ script });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/stream",
      headers: as(OWNER_A),
      payload: { query: "q" },
    });
    expect(res.statusCode).toBe(200);
    const events = parseSse(res.body);
    expect(events.map((e) => e.event)).toEqual(["session", "step", "error"]);
    expect(events.at(-1)!.data).toMatchObject({ code: "internal" });
    expect(res.body).not.toContain("event: done");
    expect(res.body).not.toContain("sk-leak");
  });

  it("a runner error event is passed through and nothing follows it", async () => {
    const script: RunScript = async function* (input) {
      yield {
        event: "session",
        data: { session_id: input.sessionId, created: input.created },
      };
      yield {
        event: "error",
        data: { code: "llm_rate_limited", detail: "slow down" },
      };
    };
    const { app } = await harness({ script });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/stream",
      headers: as(OWNER_A),
      payload: { query: "q" },
    });
    const events = parseSse(res.body);
    expect(events.map((e) => e.event)).toEqual(["session", "error"]);
    expect(events.at(-1)!.data).toEqual({
      code: "llm_rate_limited",
      detail: "slow down",
    });
  });

  it("a runner that ends without a terminal event gets an error event, never a silent close", async () => {
    const script: RunScript = async function* (input) {
      yield {
        event: "session",
        data: { session_id: input.sessionId, created: input.created },
      };
    };
    const { app } = await harness({ script });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/stream",
      headers: as(OWNER_A),
      payload: { query: "q" },
    });
    const events = parseSse(res.body);
    expect(events.at(-1)!.event).toBe("error");
    expect(events.at(-1)!.data).toMatchObject({ code: "internal" });
  });
});
