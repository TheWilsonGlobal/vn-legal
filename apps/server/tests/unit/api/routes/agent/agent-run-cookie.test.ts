import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { describe, expect, it } from "vitest";
import { agentRoutes } from "../../../../../src/api/routes/agent";
import { applyOwnerCookie } from "../../../../../src/api/plugins/owner";
import {
  OWNER_A,
  OWNER_B,
  FakeStore,
  STATS,
  type RunScript,
  apps,
  as,
  defaultScript,
  harness,
  makeRunner,
  memoryFake,
  tracer,
} from "./agent-fixtures";

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
