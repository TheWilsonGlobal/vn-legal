/**
 * LLM failure behaviour (plan 5.3 "Failure handling", decision Q2).
 * AC 3 (dead endpoint via admin rebind), AC 6 (client abort), AC 36 (429),
 * AC 37 (auth error, stub half).
 *
 * MOCKS: a local HTTP stub stands in for the UPSTREAM Gemini endpoint to
 * simulate its failure (429 / 401 / never answering) or a dead port. The
 * server, runner, retry logic, session store and routes are all real.
 * No live Gemini call is made here; the stub tests set a fake chat key so the
 * real key is never sent to a local port.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Client,
  FAKE_CHAT_KEY,
  Q_ART25,
  assertStreamGrammar,
  deadPort,
  expectNoKeyShapes,
  makeTempArea,
  ofKind,
  randomOwner,
  sleep,
  readJsonl,
  startReadyServer,
  startUpstreamStub,
  stepsOf,
  stopAll,
  tail,
  waitFor,
  walkFiles,
  type ServerHandle,
  type UpstreamStub,
} from "./helpers/harness";
import fs from "node:fs";
import path from "node:path";

const area = makeTempArea("vnl-llmfail-");
const stubs: UpstreamStub[] = [];

afterAll(async () => {
  await stopAll();
  for (const s of stubs) await s.close();
  area.cleanup();
});

function sessionDir(name: string) {
  const d = path.join(area.root, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function allSessionText(dir: string): string {
  return walkFiles(dir)
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
}

describe("AC 3: dead endpoint set through PUT /api/admin/llm/endpoint", () => {
  let server: ServerHandle;
  const owner = new Client("http://unset");
  const dir = () => sessionDir("ac3");

  beforeAll(async () => {
    // Default endpoint (real Gemini URL from .env/config). Nothing is sent to it
    // because the endpoint is rebound before the first run.
    server = await startReadyServer({ sessionsDir: dir() });
    owner.base = server.base;
  }, 180_000);

  it("stream ends with error llm_unreachable, no final step, no done; C2 returns 502", async () => {
    const dead = await deadPort();
    const put = await owner.request("PUT", "/api/admin/llm/endpoint", {
      apiUrl: `http://127.0.0.1:${dead}`,
    });
    expect(put.status, put.text).toBe(200);

    const r = await owner.stream({ query: Q_ART25 });
    expect(r.status, r.raw).toBe(200);
    expect(assertStreamGrammar(r.events)).toBe("error");
    const err = r.events.at(-1)!.data;
    expect(err.code).toBe("llm_unreachable");
    expect(typeof err.detail).toBe("string");
    expect(ofKind(r.events, "done")).toHaveLength(0);
    const steps = stepsOf(r.events);
    expect(steps.filter((s: any) => s.kind === "final")).toHaveLength(0);
    // Q2: a failed reflection precedes the error event
    const refl = steps.filter((s: any) => s.kind === "reflection");
    expect(refl.length).toBeGreaterThanOrEqual(1);
    expect(refl.at(-1).ok).toBe(false);
    // nothing that looks like an answer streamed as tokens
    expect(
      ofKind(r.events, "token")
        .map((e) => e.data.text)
        .join(""),
    ).toBe("");
    expectNoKeyShapes("stream", r.raw);

    const run = await owner.post("/api/agent/run", { query: Q_ART25 });
    expect(run.status, run.text).toBe(502);
    expect(run.json.error).toBe("llm_unreachable");
    expect(Array.isArray(run.json.steps)).toBe(true);
    expect(run.json.answer).toBeUndefined();
  }, 120_000);

  it("C9 reports llm_status disconnected and contains no key value", async () => {
    const info = await owner.get("/api/agent/info");
    expect(info.status, info.text).toBe(200);
    expect(info.json.llm_status).toBe("disconnected");
    expect(info.json.provider).toBe("gemini");
    expect(info.json.tool_mode).toBe("native");
    expectNoKeyShapes("C9", info.text);
  });
});

describe("AC 36: HTTP 429 from upstream", () => {
  let server: ServerHandle;
  let stub: UpstreamStub;
  const owner = new Client("http://unset");

  beforeAll(async () => {
    stub = await startUpstreamStub("429");
    stubs.push(stub);
    server = await startReadyServer({
      sessionsDir: sessionDir("ac36"),
      env: {
        GEMINI_OPENAI_BASE_URL: stub.url,
        GEMINI_API_KEY: FAKE_CHAT_KEY,
        GEMINI_MAX_RETRIES: "2",
      },
    });
    owner.base = server.base;
  }, 180_000);

  it("C1 ends in failed reflection then error llm_rate_limited; exactly 1+MAX_RETRIES requests within the 10 s budget; retries logged at warn", async () => {
    const before = stub.posts().length;
    const r = await owner.stream({ query: Q_ART25 });
    expect(assertStreamGrammar(r.events)).toBe("error");
    expect(r.events.at(-1)!.data.code).toBe("llm_rate_limited");
    expect(ofKind(r.events, "done")).toHaveLength(0);

    const steps = stepsOf(r.events);
    expect(steps.some((s: any) => s.kind === "final")).toBe(false);
    const lastStep = steps.at(-1);
    expect(lastStep.kind).toBe("reflection");
    expect(lastStep.ok).toBe(false);

    expect(
      stub.posts().length - before,
      "upstream POSTs = 1 + GEMINI_MAX_RETRIES",
    ).toBe(3);
    // 10 s retry budget plus generous process overhead
    expect(r.elapsedMs).toBeLessThan(25_000);

    const warnLines = server
      .log()
      .split("\n")
      .filter((l) => l.includes("[WARN]") && /retry|retries|thử lại/i.test(l));
    expect(
      warnLines.length,
      `retry warn lines in log:\n${tail(server.log())}`,
    ).toBeGreaterThanOrEqual(2);
    expectNoKeyShapes("server log", server.log());
  }, 120_000);

  it("C2 returns 502 llm_rate_limited with the steps", async () => {
    const before = stub.posts().length;
    const run = await owner.post("/api/agent/run", { query: Q_ART25 });
    expect(run.status, run.text).toBe(502);
    expect(run.json.error).toBe("llm_rate_limited");
    expect(Array.isArray(run.json.steps)).toBe(true);
    expect(stub.posts().length - before).toBe(3);
  }, 120_000);
});

describe("AC 37 (stub half): 401 from upstream is not retried and leaks nothing", () => {
  let server: ServerHandle;
  let stub: UpstreamStub;
  const owner = new Client("http://unset");
  const dir = () => path.join(area.root, "ac37");
  const SECRET = "stub-secret-key-7f3c91ab42d8"; // fake; used only against the local stub

  beforeAll(async () => {
    stub = await startUpstreamStub("401");
    stubs.push(stub);
    fs.mkdirSync(dir(), { recursive: true });
    server = await startReadyServer({
      sessionsDir: dir(),
      env: { GEMINI_OPENAI_BASE_URL: stub.url, GEMINI_API_KEY: SECRET },
    });
    owner.base = server.base;
  }, 180_000);

  it("ends in error llm_auth_error after ONE upstream request; detail, log and session record hold no key or URL", async () => {
    const r = await owner.stream({ query: Q_ART25 });
    expect(assertStreamGrammar(r.events)).toBe("error");
    const err = r.events.at(-1)!.data;
    expect(err.code).toBe("llm_auth_error");
    expect(ofKind(r.events, "done")).toHaveLength(0);
    expect(stub.posts()).toHaveLength(1);
    // the real key path was exercised: the runner passed the key explicitly
    expect(stub.posts()[0].authorization).toBe(`Bearer ${SECRET}`);

    const bundle = [
      r.raw,
      server.log(),
      allSessionText(dir()),
      (await owner.get("/api/agent/info")).text,
    ].join("\n");
    expect(bundle).not.toContain(SECRET);
    expectNoKeyShapes("bundle", bundle);
    expect(String(err.detail)).not.toMatch(/https?:\/\//);
    expect(String(err.detail)).not.toMatch(/key=/i);
    expect(bundle).not.toContain(stub.url + "chat/completions");
  }, 120_000);

  it("C2 returns 502 llm_auth_error", async () => {
    const before = stub.posts().length;
    const run = await owner.post("/api/agent/run", { query: Q_ART25 });
    expect(run.status, run.text).toBe(502);
    expect(run.json.error).toBe("llm_auth_error");
    expect(stub.posts().length - before).toBe(1);
  }, 120_000);
});

describe("AC 6: aborting the client ends the server run", () => {
  let server: ServerHandle;
  let stub: UpstreamStub;
  const ownerValue = randomOwner();
  const dir = () => path.join(area.root, "ac6");

  beforeAll(async () => {
    stub = await startUpstreamStub("hang"); // upstream never answers
    stubs.push(stub);
    fs.mkdirSync(dir(), { recursive: true });
    server = await startReadyServer({
      sessionsDir: dir(),
      env: { GEMINI_OPENAI_BASE_URL: stub.url, GEMINI_API_KEY: FAKE_CHAT_KEY },
    });
  }, 180_000);

  it("closes the upstream call, logs the abort, and stores no turn as ok:true", async () => {
    const c = new Client(server.base, ownerValue);
    const ac = new AbortController();
    let sessionId = "";
    const pending = c
      .stream(
        { query: Q_ART25 },
        {
          signal: ac.signal,
          onEvent: (e) => {
            if (e.event === "session") sessionId = e.data.session_id;
          },
        },
      )
      .catch((e) => e);
    await waitFor("session event", () => sessionId !== "", 30_000);
    await waitFor(
      "run reached the upstream LLM call",
      () => stub.posts().length >= 1,
      30_000,
    );
    ac.abort();
    await pending;

    await waitFor(
      "server log shows the run was aborted",
      () => /abort/i.test(server.log()),
      15_000,
    );
    await waitFor(
      "upstream request was cancelled by the server",
      () => stub.abortedCount() >= 1,
      15_000,
    );

    const turns = await c.get(`/api/agent/sessions/${sessionId}`);
    expect(turns.status, turns.text).toBe(200);
    for (const t of turns.json.turns) expect(t.ok).not.toBe(true);

    const recs = readJsonl(path.join(dir(), `${sessionId}.jsonl`));
    expect(recs.some((r) => r.kind === "answer" && r.ok === true)).toBe(false);
    expect(recs.some((r) => r.kind === "query")).toBe(true);
  }, 120_000);

  it("a concurrent run in the same session gets 409 session_busy; the lock is released after an abort (K10)", async () => {
    const c = new Client(server.base, ownerValue);
    const ac = new AbortController();
    let sessionId = "";
    const first = c
      .stream(
        { query: Q_ART25 },
        {
          signal: ac.signal,
          onEvent: (e) => {
            if (e.event === "session") sessionId = e.data.session_id;
          },
        },
      )
      .catch((e) => e);
    await waitFor("session event", () => sessionId !== "", 30_000);

    const busy = await c.stream({ query: Q_ART25, session_id: sessionId });
    expect(busy.status, busy.raw).toBe(409);
    expect(busy.json?.error).toBe("session_busy");

    ac.abort();
    await first;
    await sleep(3000);
    // Not 409 any more. The upstream stub never answers, so an accepted run
    // simply times out on our side: that is the "lock is free" signal.
    const outcome = await c
      .post("/api/agent/run", { query: Q_ART25, session_id: sessionId }, 2500)
      .then((r) => r.status)
      .catch(() => "accepted");
    expect(outcome).not.toBe(409);
  }, 120_000);
});
