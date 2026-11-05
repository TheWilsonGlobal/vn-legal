/**
 * Unit tests for the agent routes C1-C10 and the vl_owner cookie plugin.
 *
 * Fastify inject against in-test fakes of the C0 ports (contract.ts). Those
 * fakes are allowed in unit tests. The abort test (AC 6) uses a real listen on
 * 127.0.0.1 so that a client disconnect reaches the server socket.
 */
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentRoutes,
  type AgentRoutesOptions,
  type MemoryStats,
} from "../../../../src/api/routes/agent";
import { applyOwnerCookie } from "../../../../src/api/plugins/owner";
import type {
  AgentEvent,
  AgentRunResponse,
  AgentRunner,
  AgentTracer,
  ObservabilityStatus,
  SessionMeta,
  SessionRecord,
  SessionStore,
  Turn,
} from "../../../../src/agent/contract";

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const OWNER_A = "a".repeat(32);
const OWNER_B = "b".repeat(32);
const KEY_SHAPES = /AIza|AQ\.|sk-lf-|pk-lf-|sk-[A-Za-z0-9]/;

interface StreamInput {
  query: string;
  sessionId: string;
  mode?: "auto" | "local" | "global";
  filters?: unknown;
  created: boolean;
}
type RunScript = (
  input: StreamInput,
  signal: AbortSignal,
) => AsyncGenerator<AgentEvent>;

const DESCRIBE = {
  provider: "gemini" as const,
  model: "gemini-3.5-flash-lite",
  endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/",
  tool_mode: "native" as const,
  max_steps: 4,
  embedding: {
    provider: "gemini" as const,
    model: "gemini-embedding-2",
    dim: 768,
    index_id: "idx-test-768",
  },
};

const TRACE_STATUS: ObservabilityStatus = {
  langfuse: "disabled_by_config",
  reason: null,
  capture: "metadata_only",
  export_errors: 0,
  last_error_at: null,
};

const STATS: MemoryStats = {
  short_term: {
    active_sessions: 2,
    turns: 5,
    tokens: 100,
    max_turns: 8,
    max_tokens: 512,
    max_sessions: 1000,
    ttl_s: 3600,
  },
  store: { sessions: 3, records: 12, hidden: 1 },
  recall: { calls: 4, hits: 3, empty: 1 },
};

function doneFor(sessionId: string, answer = "Đáp án"): AgentEvent {
  // The full done payload is not built here. The routes forward it unchanged.
  return {
    event: "done",
    data: {
      session_id: sessionId,
      run_id: "run-1",
      answer,
      steps: [],
      tool_mode: "native",
      provider: "gemini",
      model: DESCRIBE.model,
      endpoint: DESCRIBE.endpoint,
      embedding: DESCRIBE.embedding,
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      context: {} as AgentRunResponse["context"],
      duration_ms: 1,
      memory: {
        window_turns: 0,
        window_tokens: 0,
        summarized_turns: 0,
        recalled: 0,
      },
      trace_id: null,
      trace_url: null,
    } as unknown as AgentRunResponse,
  };
}

const defaultScript: RunScript = async function* (input) {
  yield {
    event: "session",
    data: { session_id: input.sessionId, created: input.created },
  };
  yield doneFor(input.sessionId);
};

class FakeStore implements SessionStore {
  readonly sessions = new Map<
    string,
    { owner: string; meta: SessionMeta; hidden: boolean; turns: Turn[] }
  >();
  readonly rows: SessionRecord[] = [];
  readonly calls: string[] = [];
  readonly recordQueries: {
    session_id?: string;
    kind?: string;
    q?: string;
    offset: number;
    limit: number;
  }[] = [];

  seed(
    owner: string,
    over: Partial<SessionMeta> = {},
    turns: Turn[] = [],
  ): string {
    const id = randomUUID();
    const now = "2026-05-01T00:00:00.000Z";
    this.sessions.set(id, {
      owner,
      hidden: false,
      turns,
      meta: {
        session_id: id,
        title: "Tiêu đề",
        created_at: now,
        last_active_at: now,
        turns: 0,
        record_count: 0,
        tokens: 0,
        active: false,
        ...over,
      },
    });
    return id;
  }

  private visibleIds(owner: string): Set<string> {
    const ids = new Set<string>();
    for (const [id, s] of this.sessions)
      if (s.owner === owner && !s.hidden) ids.add(id);
    return ids;
  }

  async create(owner: string): Promise<SessionMeta> {
    this.calls.push("create");
    const id = this.seed(owner, { created_at: new Date().toISOString() });
    return { ...this.sessions.get(id)!.meta };
  }

  async list(owner: string): Promise<SessionMeta[]> {
    this.calls.push("list");
    return [...this.sessions.values()]
      .filter((s) => s.owner === owner && !s.hidden)
      .map((s) => ({ ...s.meta }));
  }

  async get(owner: string, id: string): Promise<SessionMeta | null> {
    this.calls.push(`get:${id}`);
    const s = this.sessions.get(id);
    return s && s.owner === owner && !s.hidden ? { ...s.meta } : null;
  }

  async append(id: string, rec: SessionRecord): Promise<void> {
    this.calls.push(`append:${id}`);
    this.rows.push(rec);
  }

  async turns(owner: string, id: string): Promise<Turn[]> {
    this.calls.push(`turns:${id}`);
    const s = this.sessions.get(id);
    return s && s.owner === owner && !s.hidden ? s.turns : [];
  }

  async records(
    owner: string,
    q: {
      session_id?: string;
      kind?: string;
      q?: string;
      offset: number;
      limit: number;
    },
  ): Promise<{ records: SessionRecord[]; total: number }> {
    this.calls.push("records");
    this.recordQueries.push({ ...q });
    const ids = this.visibleIds(owner);
    const matched = this.rows.filter(
      (r) =>
        ids.has(r.session_id) &&
        (q.session_id === undefined || r.session_id === q.session_id) &&
        (q.kind === undefined || r.kind === q.kind) &&
        (q.q === undefined || r.content.includes(q.q)),
    );
    return {
      records: matched.slice(q.offset, q.offset + q.limit),
      total: matched.length,
    };
  }

  async softDelete(owner: string, id: string): Promise<boolean> {
    this.calls.push(`softDelete:${id}`);
    const s = this.sessions.get(id);
    if (!s || s.owner !== owner || s.hidden) return false;
    s.hidden = true;
    return true;
  }

  async verify(owner: string) {
    this.calls.push("verify");
    const n = this.rows.filter((r) =>
      this.visibleIds(owner).has(r.session_id),
    ).length;
    return { ok: true, records: n, first_bad: null };
  }
}

function makeRunner(script: RunScript) {
  const inputs: StreamInput[] = [];
  const forgotten: string[] = [];
  const runner: AgentRunner & { inputs: StreamInput[]; forgotten: string[] } = {
    inputs,
    forgotten,
    stream(input, signal) {
      inputs.push(input as StreamInput);
      return script(input as StreamInput, signal);
    },
    setEndpoint() {},
    async forgetSession(id: string) {
      forgotten.push(id);
    },
    describe() {
      return DESCRIBE;
    },
  };
  return runner;
}

const tracer: AgentTracer = {
  async runInTrace(_meta, fn) {
    return fn({
      traceId: null,
      traceUrl: null,
      tool: (_n, _i, f) => f(),
      retriever: (_n, _i, f) => f(),
      event() {},
    });
  },
  langchainCallbacks: () => [],
  status: () => TRACE_STATUS,
  shutdown: async () => {},
};

const memoryFake = {
  window: async () => ({
    messages: [],
    summary: "",
    turns: 0,
    tokens: 0,
    summarized_turns: 0,
  }),
  recall: async () => ({ items: [], fresh_session: true }),
};

const apps: FastifyInstance[] = [];

async function harness(
  opts: {
    script?: RunScript;
    store?: FakeStore;
    probeLlm?: AgentRoutesOptions["probeLlm"] | "absent";
    logger?: unknown;
  } = {},
) {
  const store = opts.store ?? new FakeStore();
  const runner = makeRunner(opts.script ?? defaultScript);
  const app = Fastify({ logger: (opts.logger as boolean) ?? false });
  apps.push(app);
  const base: AgentRoutesOptions = {
    runner,
    store,
    memory: memoryFake,
    memoryStats: async () => STATS,
    tracer,
    probeLlm:
      opts.probeLlm === "absent"
        ? undefined
        : (opts.probeLlm ?? (async () => true)),
  };
  await app.register(agentRoutes, { prefix: "/api", ...base });
  await app.ready();
  return { app, store, runner };
}

function as(owner: string) {
  return { cookie: `vl_owner=${owner}` };
}

function parseSse(body: string): { event: string; data: unknown }[] {
  return body
    .split("\n\n")
    .filter((b) => b.length > 0)
    .map((block) => {
      const lines = block.split("\n");
      // Framing: exactly `event: <name>` then `data: <json>`.
      expect(lines.length, JSON.stringify(block)).toBe(2);
      expect(lines[0].startsWith("event: ")).toBe(true);
      expect(lines[1].startsWith("data: ")).toBe(true);
      return { event: lines[0].slice(7), data: JSON.parse(lines[1].slice(6)) };
    });
}

afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});

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
      expect(runner.inputs[0]).toMatchObject({ sessionId: id, created: false });
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
      expect(store.calls).toContain("create");
      expect(store.sessions.has(runner.inputs[0].sessionId)).toBe(true);
    });
  }
});

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
    // Exactly one terminal event, and it is the last one.
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
    expect(setCookie).toMatch(/^vl_owner=[a-f0-9]{32}/);
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

// ----------------------------------------------------------------------------
// C2 run and its error mapping
// ----------------------------------------------------------------------------

describe("C2 run", () => {
  it("returns 200 with the done payload and collects no SSE", async () => {
    const { app } = await harness();
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers: as(OWNER_A),
      payload: { query: "q" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ answer: "Đáp án", tool_mode: "native" });
  });

  for (const code of [
    "llm_unreachable",
    "llm_rate_limited",
    "llm_auth_error",
    "llm_error",
    "embedding_error",
  ] as const) {
    it(`maps ${code} to 502 with steps`, async () => {
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
            content: "t",
            tool: null,
            tool_input: null,
            ok: true,
            duration_ms: 1,
          },
        };
        yield {
          event: "step",
          data: {
            index: 1,
            kind: "reflection",
            content: "failed",
            tool: null,
            tool_input: null,
            ok: false,
            duration_ms: 2,
          },
        };
        yield { event: "error", data: { code, detail: "upstream said no" } };
      };
      const { app } = await harness({ script });
      const res = await app.inject({
        method: "POST",
        url: "/api/agent/run",
        headers: as(OWNER_A),
        payload: { query: "q" },
      });
      expect(res.statusCode).toBe(502);
      const body = res.json();
      expect(body).toMatchObject({ error: code, detail: "upstream said no" });
      expect(body.steps.map((s: { kind: string }) => s.kind)).toEqual([
        "thought",
        "reflection",
      ]);
    });
  }

  for (const code of ["tool_error", "internal"] as const) {
    it(`maps ${code} to 500 {error:"internal"}`, async () => {
      const script: RunScript = async function* (input) {
        yield {
          event: "session",
          data: { session_id: input.sessionId, created: input.created },
        };
        yield {
          event: "error",
          data: { code, detail: "details stay in the log" },
        };
      };
      const { app } = await harness({ script });
      const res = await app.inject({
        method: "POST",
        url: "/api/agent/run",
        headers: as(OWNER_A),
        payload: { query: "q" },
      });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: "internal" });
    });
  }

  it("a runner that throws gives 500 internal", async () => {
    const script: RunScript = () => {
      throw new Error("kaboom");
    };
    const { app } = await harness({ script });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers: as(OWNER_A),
      payload: { query: "q" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "internal" });
  });

  it("a runner that ends without a terminal event gives 500 internal", async () => {
    const script: RunScript = async function* (input) {
      yield {
        event: "session",
        data: { session_id: input.sessionId, created: input.created },
      };
    };
    const { app } = await harness({ script });
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers: as(OWNER_A),
      payload: { query: "q" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "internal" });
  });
});

// ----------------------------------------------------------------------------
// AC 6: a client disconnect aborts the runner's signal, and it is logged
// ----------------------------------------------------------------------------

describe("AC 6: abort", () => {
  it("a client disconnect reaches the runner's signal and is logged; the lock is then free", async () => {
    const logLines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        logLines.push(chunk.toString());
        cb();
      },
    });
    let started!: () => void;
    const startedP = new Promise<void>((r) => (started = r));
    let observedAbort!: (aborted: boolean) => void;
    const observed = new Promise<boolean>((r) => (observedAbort = r));
    let calls = 0;
    const script: RunScript = async function* (input, signal) {
      calls += 1;
      yield {
        event: "session",
        data: { session_id: input.sessionId, created: input.created },
      };
      if (calls === 1) {
        started();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        observedAbort(signal.aborted);
        return;
      }
      yield doneFor(input.sessionId);
    };
    const store = new FakeStore();
    const id = store.seed(OWNER_A);
    const app = Fastify({ logger: { level: "info", stream: sink } });
    apps.push(app);
    await app.register(agentRoutes, {
      prefix: "/api",
      runner: makeRunner(script),
      store,
      memory: memoryFake,
      memoryStats: async () => STATS,
      tracer,
      probeLlm: async () => true,
    });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });

    const ac = new AbortController();
    const res = await fetch(`${address}/api/agent/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `vl_owner=${OWNER_A}`,
      },
      body: JSON.stringify({ query: "q", session_id: id }),
      signal: ac.signal,
    });
    const reader = res.body!.getReader();
    await reader.read(); // the session event
    await startedP;
    ac.abort();

    expect(await observed).toBe(true);
    // Give the close event a moment to be logged.
    await new Promise((r) => setTimeout(r, 100));
    expect(logLines.join("\n")).toMatch(/client disconnected|aborted/);

    const next = await app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers: as(OWNER_A),
      payload: { query: "q", session_id: id },
    });
    expect(next.statusCode).toBe(200);
  }, 15_000);
});

// ----------------------------------------------------------------------------
// Owner cookie (plan §5.5, Q4)
// ----------------------------------------------------------------------------

describe("vl_owner cookie", () => {
  it("issues an httpOnly, SameSite=Strict, Path=/, Secure cookie with a 128-bit hex value", async () => {
    const { app } = await harness();
    const res = await app.inject({ method: "GET", url: "/api/agent/sessions" });
    expect(res.statusCode).toBe(200);
    const sc = String(res.headers["set-cookie"]);
    expect(sc).toMatch(/^vl_owner=[a-f0-9]{32};/);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Strict/i);
    expect(sc).toMatch(/Path=\//);
    // NODE_ENV is "test" under vitest, so Secure is set.
    expect(sc).toMatch(/Secure/);
  });

  it("does not reissue a valid cookie", async () => {
    const { app } = await harness();
    const res = await app.inject({
      method: "GET",
      url: "/api/agent/sessions",
      headers: as(OWNER_A),
    });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("replaces a malformed cookie value and never trusts it", async () => {
    const store = new FakeStore();
    const { app } = await harness({ store });
    for (const bad of [
      "not-hex",
      "A".repeat(32),
      "a".repeat(31),
      "a".repeat(33),
      "z".repeat(32),
    ]) {
      const res = await app.inject({
        method: "GET",
        url: "/api/agent/sessions",
        headers: { cookie: `vl_owner=${bad}` },
      });
      const sc = String(res.headers["set-cookie"]);
      expect(sc, bad).toMatch(/^vl_owner=[a-f0-9]{32};/);
      expect(sc, bad).not.toContain(`vl_owner=${bad};`);
    }
  });

  it("a new owner sees none of another owner's sessions", async () => {
    const store = new FakeStore();
    store.seed(OWNER_A);
    const { app } = await harness({ store });
    const res = await app.inject({
      method: "GET",
      url: "/api/agent/sessions",
      headers: as(OWNER_B),
    });
    expect(res.json()).toEqual({ sessions: [] });
  });

  it("applyOwnerCookie with secure:false omits the Secure flag", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(fastifyCookie);
    applyOwnerCookie(app, { secure: false });
    app.get("/whoami", async (request) => ({ owner: request.owner }));
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/whoami" });
    const sc = String(res.headers["set-cookie"]);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Strict/i);
    expect(sc).not.toMatch(/Secure/);
    expect(res.json().owner).toMatch(/^[a-f0-9]{32}$/);
  });

  it("the cookie plugin does not touch routes outside the agent plugin", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(agentRoutes, {
      prefix: "/api",
      runner: makeRunner(defaultScript),
      store: new FakeStore(),
      memory: memoryFake,
      memoryStats: async () => STATS,
      tracer,
      probeLlm: async () => true,
    });
    // A legacy-style sibling route, declared on the root instance.
    app.get("/api/legacy", async () => ({ ok: true }));
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/legacy" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    const agent = await app.inject({
      method: "GET",
      url: "/api/agent/examples",
    });
    expect(agent.headers["set-cookie"]).toBeDefined();
  });
});

// ----------------------------------------------------------------------------
// C3, C4, C5, C6
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
    // soft: the record is still in the store, only hidden
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
});

// ----------------------------------------------------------------------------
// C7
// ----------------------------------------------------------------------------

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

// ----------------------------------------------------------------------------
// C8 traces
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

// ----------------------------------------------------------------------------
// C9 info
// ----------------------------------------------------------------------------

describe("C9 info", () => {
  it("reports connected when the probe answers true, with the describe fields and observability", async () => {
    const { app } = await harness({ probeLlm: async () => true });
    const res = await app.inject({ method: "GET", url: "/api/agent/info" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      endpoint: DESCRIBE.endpoint,
      tool_mode: "native",
      max_steps: 4,
      embedding: DESCRIBE.embedding,
      llm_status: "connected",
      observability: TRACE_STATUS,
    });
  });

  it("reports disconnected when the probe answers false", async () => {
    const { app } = await harness({ probeLlm: async () => false });
    const res = await app.inject({ method: "GET", url: "/api/agent/info" });
    expect(res.json().llm_status).toBe("disconnected");
  });

  it("reports disconnected when the probe does not answer within 3 s", async () => {
    const { app } = await harness({
      probeLlm: () => new Promise<boolean>(() => {}),
    });
    const res = await app.inject({ method: "GET", url: "/api/agent/info" });
    expect(res.statusCode).toBe(200);
    expect(res.json().llm_status).toBe("disconnected");
  }, 15_000);

  it("fails with 500 when no probe is wired, instead of guessing a status", async () => {
    const { app } = await harness({ probeLlm: "absent" });
    const res = await app.inject({ method: "GET", url: "/api/agent/info" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "internal" });
  });

  it("contains no key-shaped string, even when describe() carries one", async () => {
    const leaky = {
      ...DESCRIBE,
      apiKey: "AIzaSyFAKEKEYVALUE0123456789abcdef",
      gemini_key: "AQ.FAKEKEYVALUE",
      langfuse: "sk-lf-0123456789abcdef",
    } as unknown as typeof DESCRIBE;
    const store = new FakeStore();
    const runner = makeRunner(defaultScript);
    runner.describe = () => leaky;
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(agentRoutes, {
      prefix: "/api",
      runner,
      store,
      memory: memoryFake,
      memoryStats: async () => STATS,
      tracer,
      probeLlm: async () => true,
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/agent/info" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(KEY_SHAPES);
    expect(res.body).not.toContain("apiKey");
    expect(res.body).not.toContain("gemini_key");
  });
});

// ----------------------------------------------------------------------------
// C10 memory stats
// ----------------------------------------------------------------------------

describe("C10 memory stats", () => {
  it("returns the memoryStats payload unchanged", async () => {
    const { app } = await harness();
    const res = await app.inject({
      method: "GET",
      url: "/api/agent/memory/stats",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(STATS);
  });
});
