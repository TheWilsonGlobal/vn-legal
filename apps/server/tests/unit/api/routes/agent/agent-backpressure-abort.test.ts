import { request as httpRequest } from "node:http";
import { Writable } from "node:stream";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { agentRoutes } from "../../../../../src/api/routes/agent";
import {
  OWNER_A,
  FakeStore,
  STATS,
  type RunScript,
  apps,
  as,
  doneFor,
  harness,
  makeRunner,
  memoryFake,
  parseSse,
  tracer,
} from "./agent-fixtures";

// ----------------------------------------------------------------------------
// R2-05: SSE backpressure and one completion line per stream
// ----------------------------------------------------------------------------

describe("R2-05 SSE backpressure and completion log", () => {
  it("stops pulling from the runner while the client is not reading, and finishes once it reads", async () => {
    const TOKENS = 100;
    const TOKEN_CHARS = 512 * 1024; // about 50 MB in total, more than the socket buffers hold
    let produced = 0;
    const script: RunScript = async function* (input) {
      yield {
        event: "session",
        data: { session_id: input.sessionId, created: input.created },
      };
      for (let i = 0; i < TOKENS; i++) {
        produced += 1;
        yield { event: "token", data: { text: "x".repeat(TOKEN_CHARS) } };
      }
      yield doneFor(input.sessionId);
    };
    const { app } = await harness({ script });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const port = Number(new URL(address).port);

    let producedWhilePaused = -1;
    const body = await new Promise<string>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: "/api/agent/stream",
          method: "POST",
          headers: { "content-type": "application/json" },
        },
        (res) => {
          // Pause before any 'data' listener is attached, so nothing is read yet.
          res.pause();
          res.setEncoding("utf8");
          let text = "";
          res.on("data", (chunk: string) => {
            text += chunk;
          });
          res.on("end", () => resolve(text));
          res.on("error", reject);
          setTimeout(() => {
            producedWhilePaused = produced;
            res.resume();
          }, 1000);
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ query: "q" }));
    });

    expect(producedWhilePaused).toBeGreaterThan(0);
    expect(producedWhilePaused).toBeLessThan(TOKENS);
    const events = parseSse(body);
    expect(events.filter((e) => e.event === "token")).toHaveLength(TOKENS);
    expect(events.at(-1)!.event).toBe("done");
  }, 30_000);

  it("logs exactly one 'agent stream finished' line per stream, with status and duration_ms", async () => {
    const logLines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        logLines.push(chunk.toString());
        cb();
      },
    });
    let calls = 0;
    const script: RunScript = async function* (input) {
      calls += 1;
      yield {
        event: "session",
        data: { session_id: input.sessionId, created: input.created },
      };
      if (calls === 2) throw new Error("boom");
      yield doneFor(input.sessionId);
    };
    const store = new FakeStore();
    const app = Fastify({ logger: { level: "info", stream: sink } });
    apps.push(app);
    await app.register(agentRoutes, {
      prefix: "/api",
      runner: makeRunner(script),
      store,
      memoryStats: async () => STATS,
      tracer,
      probeLlm: async () => true,
    });
    await app.ready();

    const ok = await app.inject({
      method: "POST",
      url: "/api/agent/stream",
      headers: as(OWNER_A),
      payload: { query: "q" },
    });
    expect(ok.statusCode).toBe(200);
    const failed = await app.inject({
      method: "POST",
      url: "/api/agent/stream",
      headers: as(OWNER_A),
      payload: { query: "q" },
    });
    expect(failed.statusCode).toBe(200);

    const lines = logLines
      .join("")
      .split("\n")
      .filter((l) => l.length > 0)
      .map(
        (l) =>
          JSON.parse(l) as {
            msg?: string;
            status?: string;
            duration_ms?: number;
            session_id?: string;
          },
      );
    const finished = lines.filter((l) => l.msg === "agent stream finished");
    expect(finished).toHaveLength(2);
    expect(finished.map((f) => f.status)).toEqual(["done", "runner_failed"]);
    for (const f of finished) {
      expect(typeof f.duration_ms).toBe("number");
      expect(f.duration_ms).toBeGreaterThanOrEqual(0);
      expect(typeof f.session_id).toBe("string");
    }
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
