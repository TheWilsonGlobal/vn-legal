/**
 * Langfuse fail-open and lifecycle (plan 5.8 items 5 and 6).
 * AC 27, 28, 29, 31 (offline halves) and AC 27/28/29 run halves (VN_LEGAL_LIVE=1).
 *
 * Fail-open is the ONLY fallback approved in this plan. These tests check it
 * is visible (warn log + C9 status) and never turns into an agent error.
 * The offline halves point the chat LLM at a dead port with a fake key, so no
 * Gemini request is made; the live halves use the real endpoint and key from
 * the spawned server's own `.env`.
 *
 * Dummy Langfuse keys below are NOT real and do not match the leak patterns.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  Client,
  LIVE,
  Q_ART25,
  deadLlmEnv,
  expectNoKeyShapes,
  isPortOpen,
  makeTempArea,
  sleep,
  spawnServer,
  startConnectionCounter,
  startReadyServer,
  stopAll,
  tail,
  waitFor,
  waitReady,
} from "./helpers/harness";

const area = makeTempArea("vnl-langfuse-");
afterAll(async () => {
  await stopAll();
  area.cleanup();
});

const dir = (n: string) => {
  const d = path.join(area.root, n);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

const DUMMY_PUBLIC = "dummy-public-key-not-real";
const DUMMY_SECRET = "dummy-secret-key-not-real";

describe("AC 27: LANGFUSE_ENABLED=true with LANGFUSE_SECRET_KEY missing", () => {
  it("server starts; log names LANGFUSE_SECRET_KEY (no value); C9 = disabled_missing_keys", async () => {
    const server = await startReadyServer({
      sessionsDir: dir("ac27"),
      env: {
        ...(await deadLlmEnv()),
        LANGFUSE_ENABLED: "true",
        LANGFUSE_SECRET_KEY: "", // empty string = missing; never deleted
      },
    });
    const log = server.log();
    expect(log, tail(log)).toContain("LANGFUSE_SECRET_KEY");
    expect(log).toMatch(/\[WARN\][^\n]*LANGFUSE_SECRET_KEY/);
    expectNoKeyShapes("startup log", log);

    const info = await new Client(server.base).get("/api/agent/info");
    expect(info.status, info.text).toBe(200);
    expect(info.json.observability.langfuse).toBe("disabled_missing_keys");
    expect(info.json.observability.capture).toBe("metadata_only");
    expectNoKeyShapes("C9", info.text);
  }, 180_000);

  it.runIf(LIVE)(
    "[live] a C2 run still succeeds and done.trace_id is null",
    async () => {
      const server = await startReadyServer({
        sessionsDir: dir("ac27-live"),
        env: { LANGFUSE_ENABLED: "true", LANGFUSE_SECRET_KEY: "" },
      });
      const run = await new Client(server.base).post(
        "/api/agent/run",
        { query: Q_ART25 },
        170_000,
      );
      expect(run.status, run.text).toBe(200);
      expect(run.json.answer).toBeTruthy();
      expect(run.json.trace_id).toBeNull();
    },
    300_000,
  );
});

describe("AC 28: Langfuse host unreachable", () => {
  const env = {
    LANGFUSE_ENABLED: "true",
    LANGFUSE_BASE_URL: "http://127.0.0.1:5998",
    LANGFUSE_PUBLIC_KEY: DUMMY_PUBLIC,
    LANGFUSE_SECRET_KEY: DUMMY_SECRET,
  };

  it("precondition: nothing listens on 127.0.0.1:5998", async () => {
    expect(await isPortOpen(5998)).toBe(false);
  });

  it("server starts and logs a warn about Langfuse; C9 is reachable and key-free", async () => {
    const server = await startReadyServer({
      sessionsDir: dir("ac28"),
      env: { ...(await deadLlmEnv()), ...env },
    });
    await sleep(2000);
    const log = server.log();
    expect(log).toMatch(/\[WARN\][^\n]*langfuse/i);
    expectNoKeyShapes("startup log", log);
    expect(log).not.toContain(DUMMY_SECRET);
    const info = await new Client(server.base).get("/api/agent/info");
    expect(info.status, info.text).toBe(200);
    expect(["enabled", "degraded_export_errors"]).toContain(
      info.json.observability.langfuse,
    );
    expect(info.text).not.toContain(DUMMY_SECRET);
  }, 180_000);

  it.runIf(LIVE)(
    "[live] runs still succeed with steps and a done event; C9 -> degraded_export_errors with export_errors > 0; warn logs present",
    async () => {
      const server = await startReadyServer({
        sessionsDir: dir("ac28-live"),
        env,
      });
      const c = new Client(server.base);
      const r = await c.stream({ query: Q_ART25 }, { timeoutMs: 170_000 });
      expect(r.events.at(-1)!.event).toBe("done");
      expect(r.events.at(-1)!.data.answer).toBeTruthy();
      expect(r.events.filter((e) => e.event === "error")).toHaveLength(0);
      await waitFor(
        "C9 degraded_export_errors",
        async () => {
          const i = await c.get("/api/agent/info");
          return (
            i.json?.observability?.langfuse === "degraded_export_errors" &&
            i.json.observability.export_errors > 0
          );
        },
        60_000,
        2000,
      );
      expect(server.log()).toMatch(/\[WARN\][^\n]*(langfuse|export)/i);
      expectNoKeyShapes("server log", server.log());
    },
    300_000,
  );
});

describe("AC 29: LANGFUSE_ENABLED=false", () => {
  it("C9 = disabled_by_config and zero connections reach the Langfuse host", async () => {
    const counter = await startConnectionCounter();
    try {
      const server = await startReadyServer({
        sessionsDir: dir("ac29"),
        env: {
          ...(await deadLlmEnv()),
          LANGFUSE_ENABLED: "false",
          LANGFUSE_BASE_URL: counter.url,
          LANGFUSE_PUBLIC_KEY: DUMMY_PUBLIC,
          LANGFUSE_SECRET_KEY: DUMMY_SECRET,
        },
      });
      const c = new Client(server.base);
      const info = await c.get("/api/agent/info");
      expect(info.json.observability.langfuse).toBe("disabled_by_config");
      // a failing run exercises the tracer wrapper path too
      await c.post("/api/agent/run", { query: Q_ART25 }, 60_000);
      await sleep(6000); // longer than a typical batch-export interval
      expect(counter.count()).toBe(0);
      expect(server.log()).toMatch(/langfuse/i); // the one info line at startup
    } finally {
      await counter.close();
    }
  }, 240_000);

  it.runIf(LIVE)(
    "[live] a C2 run has done.trace_id === null and still no connection to the host",
    async () => {
      const counter = await startConnectionCounter();
      try {
        const server = await startReadyServer({
          sessionsDir: dir("ac29-live"),
          env: {
            LANGFUSE_ENABLED: "false",
            LANGFUSE_BASE_URL: counter.url,
            LANGFUSE_PUBLIC_KEY: DUMMY_PUBLIC,
            LANGFUSE_SECRET_KEY: DUMMY_SECRET,
          },
        });
        const run = await new Client(server.base).post(
          "/api/agent/run",
          { query: Q_ART25 },
          170_000,
        );
        expect(run.status, run.text).toBe(200);
        expect(run.json.trace_id).toBeNull();
        expect(run.json.trace_url).toBeNull();
        await sleep(6000);
        expect(counter.count()).toBe(0);
      } finally {
        await counter.close();
      }
    },
    300_000,
  );
});

describe("AC 31: SIGTERM while idle", () => {
  const env = {
    LANGFUSE_ENABLED: "true",
    LANGFUSE_BASE_URL: "http://127.0.0.1:5998",
    LANGFUSE_PUBLIC_KEY: DUMMY_PUBLIC,
    LANGFUSE_SECRET_KEY: DUMMY_SECRET,
  };

  it(
    process.platform === "win32"
      ? "[win32] real child.kill('SIGTERM') terminates the process within 6 s (TerminateProcess: no handler can run, see README)"
      : "exits within 6 s of SIGTERM",
    async () => {
      const server = await startReadyServer({
        sessionsDir: dir("ac31"),
        env: { ...(await deadLlmEnv()), ...env },
      });
      await sleep(1000);
      const t0 = Date.now();
      server.child.kill("SIGTERM");
      const exit = await Promise.race([
        server.exited,
        sleep(6000).then(() => "timeout" as const),
      ]);
      expect(
        exit,
        `still running 6 s after SIGTERM\n${tail(server.log())}`,
      ).not.toBe("timeout");
      expect(Date.now() - t0).toBeLessThan(6500);
      if (process.platform !== "win32") {
        const log = server.log();
        expect(log).toMatch(
          /langfuse shutdown ok|\[WARN\][^\n]*langfuse[^\n]*(timeout|timed out|waited)/i,
        );
      }
    },
    180_000,
  );

  // On Windows a real SIGTERM cannot run JavaScript handlers. This variant
  // starts the real server through a wrapper that forwards an IPC message to
  // process.emit("SIGTERM"), which runs the handlers the server registered.
  // It is an emulation of signal delivery, not of the shutdown logic.
  it("shutdown hook logs 'langfuse shutdown ok' or a timeout warning and the process exits within 6 s (handlers invoked via process.emit on win32, real SIGTERM elsewhere)", async () => {
    const server = await spawnServer({
      sessionsDir: dir("ac31b"),
      env: { ...(await deadLlmEnv()), ...env },
      ipcWrapper: true,
    });
    await waitReady(server);
    await sleep(1000);
    const t0 = Date.now();
    if (process.platform === "win32") server.child.send("SIGTERM");
    else server.child.kill("SIGTERM");
    const exit = await Promise.race([
      server.exited,
      sleep(6000).then(() => "timeout" as const),
    ]);
    expect(
      exit,
      `still running 6 s after SIGTERM\n${tail(server.log())}`,
    ).not.toBe("timeout");
    expect(Date.now() - t0).toBeLessThan(6500);
    expect(server.log()).toMatch(
      /langfuse shutdown ok|\[WARN\][^\n]*langfuse[^\n]*(timeout|timed out|waited)/i,
    );
    expectNoKeyShapes("log", server.log());
  }, 180_000);
});
