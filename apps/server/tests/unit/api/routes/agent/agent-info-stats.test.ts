import { Writable } from "node:stream";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { agentRoutes } from "../../../../../src/api/routes/agent";
import {
  OWNER_A,
  OWNER_B,
  DESCRIBE,
  KEY_SHAPES,
  P_GOOGLE,
  P_LF_SECRET,
  STATS,
  TRACE_STATUS,
  FakeStore,
  apps,
  defaultScript,
  harness,
  makeRunner,
  memoryFake,
  tracer,
} from "./agent-fixtures";

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

  it("R2-02: a rejected probe reports disconnected with 200, and warns with the error class only", async () => {
    class ProbeUnreachable extends Error {}
    const logLines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        logLines.push(chunk.toString());
        cb();
      },
    });
    const app = Fastify({ logger: { level: "warn", stream: sink } });
    apps.push(app);
    await app.register(agentRoutes, {
      prefix: "/api",
      runner: makeRunner(defaultScript),
      store: new FakeStore(),
      memoryStats: async () => STATS,
      tracer,
      probeLlm: async () => {
        throw new ProbeUnreachable(
          "connect ECONNREFUSED https://generativelanguage.example/v1beta?key=" +
            P_GOOGLE +
            "SECRETVALUE0123456789",
        );
      },
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/agent/info" });
    expect(res.statusCode).toBe(200);
    expect(res.json().llm_status).toBe("disconnected");
    expect(res.body).not.toContain(P_GOOGLE + "SECRET");

    const logged = logLines.join("");
    const warns = logged
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as { msg?: string; error_class?: string })
      .filter(
        (l) => l.msg === "agent info: llm probe failed, reporting disconnected",
      );
    expect(warns).toHaveLength(1);
    expect(warns[0].error_class).toBe("ProbeUnreachable");
    expect(logged).not.toContain(P_GOOGLE + "SECRET");
    expect(logged).not.toContain("ECONNREFUSED");
  });

  it("fails with 500 when no probe is wired, instead of guessing a status", async () => {
    const { app } = await harness({ probeLlm: "absent" });
    const res = await app.inject({ method: "GET", url: "/api/agent/info" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "internal" });
  });

  it("contains no key-shaped string, even when describe() carries one", async () => {
    const leaky = {
      ...DESCRIBE,
      apiKey: P_GOOGLE + "SyFAKEKEYVALUE0123456789abcdef",
      gemini_key: "AQ" + ".FAKEKEYVALUE",
      langfuse: P_LF_SECRET + "0123456789abcdef",
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
  it("takes short_term and recall from memoryStats and the store block from store.counts()", async () => {
    const store = new FakeStore();
    const live = store.seed(OWNER_A);
    const gone = store.seed(OWNER_B);
    await store.softDelete(OWNER_B, gone);
    store.rows.push({
      session_id: live,
      run_id: null,
      seq: 0,
      created_at: "2026-05-01T00:00:00.000Z",
      kind: "session_created",
      content: "",
    });
    const { app } = await harness({ store });
    const res = await app.inject({
      method: "GET",
      url: "/api/agent/memory/stats",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      short_term: STATS.short_term,
      store: { sessions: 1, records: 1, hidden: 1 },
      recall: STATS.recall,
    });
  });

  it("is a 500 when store.counts() fails, instead of a stale or empty store block", async () => {
    const store = new FakeStore();
    store.counts = async () => {
      throw new Error("db unavailable");
    };
    const { app } = await harness({ store });
    const res = await app.inject({
      method: "GET",
      url: "/api/agent/memory/stats",
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "internal" });
  });
});
