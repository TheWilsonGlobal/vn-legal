/**
 * LIVE agent behaviour: real Gemini chat + embeddings and the RB1 index.
 * AC 1, 2, 4, 9, 17, 19 (recall isolation), 20 (recall after restart).
 *
 * Runs only with VN_LEGAL_LIVE=1 (describe.runIf). Without the flag these
 * report as skipped; TR1 must report them NOT RUN, never passed.
 * Concurrency is 1 (one file at a time, sequential tests, one request at a
 * time) and the child gets GEMINI_MAX_CONCURRENCY=2.
 */
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Client,
  LIVE,
  Q_ART25,
  REGISTERED_TOOLS,
  assertStreamGrammar,
  expectNoKeyShapes,
  makeTempArea,
  ofKind,
  randomOwner,
  readJsonl,
  sessionFile,
  startReadyServer,
  stepsOf,
  stopAll,
  type ServerHandle,
  type StreamResult,
} from "./helpers/harness";

const area = makeTempArea("vnl-live-agent-");
const ownerValue = randomOwner();
let server: ServerHandle;
let c: Client;
let first: StreamResult;
let sessionA = "";

const QUERY_ONE = Q_ART25;
const QUERY_TWO = "Tôi vừa hỏi về điều nào?";

afterAll(async () => {
  await stopAll();
  area.cleanup();
});

describe.runIf(LIVE)("live agent (VN_LEGAL_LIVE=1)", () => {
  beforeAll(async () => {
    server = await startReadyServer({ sessionsDir: area.sessionsDir });
    c = new Client(server.base, ownerValue);
  }, 240_000);

  it("AC 1: first stream of a legal question has the contract shape", async () => {
    first = await c.stream({ query: QUERY_ONE });
    expect(first.status, first.raw).toBe(200);
    expect(assertStreamGrammar(first.events)).toBe("done");
    sessionA = first.events[0].data.session_id;
    expect(first.events[0].event).toBe("session");

    const steps = stepsOf(first.events);
    const actions = steps.filter((s: any) => s.kind === "action");
    expect(actions.length).toBeGreaterThanOrEqual(1);
    for (const a of actions) {
      expect(REGISTERED_TOOLS).toContain(a.tool);
      expect(String(a.tool_input ?? "").length).toBeGreaterThan(0);
    }
    steps.forEach((s: any, i: number) => {
      if (s.kind !== "action") return;
      const next = steps[i + 1];
      expect(next?.kind, `step after action #${s.index}`).toBe("observation");
      expect(next.tool).toBe(s.tool);
    });
    const cites = steps
      .filter((s: any) => s.kind === "observation")
      .flatMap((s: any) => s.citations ?? []);
    expect(
      cites.some((x: any) => x.article_number === 25),
      "some observation cites article 25",
    ).toBe(true);

    const n = first.events.length;
    expect(first.events[n - 2].event).toBe("step");
    expect(first.events[n - 2].data.kind).toBe("final");
    expect(first.events[n - 1].event).toBe("done");
    const done = first.events[n - 1].data;
    expect(done.answer).toBeTruthy();
    expect(done.answer).toBe(done.steps.at(-1).content);
    expect(done.answer).toBe(first.events[n - 2].data.content);
    expect(done.provider).toBe("gemini");
    expect(done.tool_mode).toBe("native");
    expectNoKeyShapes("stream", first.raw);
  }, 240_000);

  it("AC 2: step indices are gapless, durations >= 0, tool-call actions <= AGENT_MAX_STEPS", async () => {
    const done = first.events.at(-1)!.data;
    done.steps.forEach((s: any, i: number) => {
      expect(s.index).toBe(i);
      expect(s.duration_ms).toBeGreaterThanOrEqual(0);
    });
    // streamed step events agree with the done payload
    expect(stepsOf(first.events).map((s: any) => s.index)).toEqual(
      done.steps.map((s: any) => s.index),
    );
    const info = await c.get("/api/agent/info");
    expect(info.json.max_steps).toBe(4);
    const toolActions = done.steps.filter(
      (s: any) => s.kind === "action" && s.tool,
    );
    expect(toolActions.length).toBeLessThanOrEqual(info.json.max_steps);
    expect(ofKind(first.events, "error")).toHaveLength(0);
  });

  it("AC 9: GET /api/admin/llm/last-prompt shows the agent's last prompt", async () => {
    const r = await c.get("/api/admin/llm/last-prompt");
    expect(r.status, r.text).toBe(200);
    expect(r.text).toContain("Điều 25");
    expectNoKeyShapes("last-prompt", r.text);
  });

  it("AC 4: a recall question in the same session routes to recall_session and names Điều 25", async () => {
    const r = await c.stream({ query: QUERY_TWO, session_id: sessionA });
    expect(assertStreamGrammar(r.events)).toBe("done");
    expect(r.events[0].data).toMatchObject({
      session_id: sessionA,
      created: false,
    });
    const steps = stepsOf(r.events);
    const recallAction = steps.find(
      (s: any) => s.kind === "action" && s.tool === "recall_session",
    );
    expect(recallAction, "action with tool recall_session").toBeTruthy();
    expect(
      steps.filter(
        (s: any) => s.kind === "action" && s.tool !== "recall_session",
      ),
      "recall is routed in code: no other tools",
    ).toHaveLength(0);
    const obs = steps.find(
      (s: any) => s.kind === "observation" && s.tool === "recall_session",
    );
    expect(obs.ok).toBe(true);
    expect(obs.content).toMatch(/Nhớ lại \d+ mục/);
    const done = r.events.at(-1)!.data;
    expect(done.answer).toMatch(/25/);

    const detail = await c.get(`/api/agent/sessions/${sessionA}`);
    expect(detail.status).toBe(200);
    expect(detail.json.turns).toHaveLength(2);
  }, 240_000);

  it("AC 17: a recall query as the first turn of a new session says nothing came before and names no article", async () => {
    const created = await c.post("/api/agent/sessions");
    const sid = created.json.session_id;
    const r = await c.stream({
      query: "Tôi đã hỏi gì trước đó?",
      session_id: sid,
    });
    expect(assertStreamGrammar(r.events)).toBe("done");
    const steps = stepsOf(r.events);
    const obs = steps.find(
      (s: any) => s.kind === "observation" && s.tool === "recall_session",
    );
    expect(obs, "recall_session observation").toBeTruthy();
    expect(obs.ok).toBe(true);
    expect(obs.content).toBe("Không có nội dung trước đó.");
    const done = r.events.at(-1)!.data;
    expect(done.answer).not.toMatch(/Điều\s*\d+/i);
    expect(done.answer).toMatch(/chưa|không có|lần đầu|first|nothing/i);
  }, 240_000);

  it("AC 19 (recall half): session B of the same owner cannot recall session A's queries", async () => {
    const marker = "marmot5517";
    const a = (await c.post("/api/agent/sessions")).json.session_id;
    const b = (await c.post("/api/agent/sessions")).json.session_id;
    const ra = await c.stream({
      query: `Mã ${marker}: Điều 25 Bộ luật Dân sự quy định gì?`,
      session_id: a,
    });
    expect(assertStreamGrammar(ra.events)).toBe("done");
    const rb = await c.stream({
      query: `Nhắc lại: tôi đã hỏi gì về mã ${marker}?`,
      session_id: b,
    });
    expect(assertStreamGrammar(rb.events)).toBe("done");
    const obs = stepsOf(rb.events).find(
      (s: any) => s.kind === "observation" && s.tool === "recall_session",
    );
    expect(obs, "B used recall_session").toBeTruthy();
    expect(obs.content).not.toContain("Điều 25 Bộ luật Dân sự quy định gì");
    expect(obs.content).toBe("Không có nội dung trước đó.");
  }, 300_000);

  it("AC 20 (recall half): after server stop -> start a new run in the session can recall turn 1; JSONL gains one query, n step, one answer per run", async () => {
    const sid = sessionA;
    const file = sessionFile(area.sessionsDir, sid);
    const before = readJsonl(file);
    await server.stop();

    server = await startReadyServer({ sessionsDir: area.sessionsDir });
    c = new Client(server.base, ownerValue);

    const list = await c.get("/api/agent/sessions");
    const row = list.json.sessions.find((s: any) => s.session_id === sid);
    expect(row?.active).toBe(false);
    const detail = await c.get(`/api/agent/sessions/${sid}`);
    expect(detail.json.turns).toHaveLength(2);
    expect(detail.json.turns[0].steps.length).toBeGreaterThan(0);
    expect(detail.json.turns[0].query).toBe(QUERY_ONE);

    const r = await c.stream({
      query: "Nhắc lại câu hỏi đầu tiên của tôi trong phiên này",
      session_id: sid,
    });
    expect(assertStreamGrammar(r.events)).toBe("done");
    const obs = stepsOf(r.events).find(
      (s: any) => s.kind === "observation" && s.tool === "recall_session",
    );
    expect(obs?.content).toMatch(/Nhớ lại \d+ mục/);
    expect(r.events.at(-1)!.data.answer).toMatch(/25/);

    const after = readJsonl(file);
    const added = after.slice(before.length);
    const runId = added.find((x) => x.kind === "query")?.run_id;
    const mine = added.filter((x) => x.run_id === runId);
    expect(mine.filter((x) => x.kind === "query")).toHaveLength(1);
    expect(mine.filter((x) => x.kind === "answer")).toHaveLength(1);
    expect(mine.filter((x) => x.kind === "step")).toHaveLength(
      r.events.at(-1)!.data.steps.length,
    );
    expect(fs.existsSync(file)).toBe(true);
  }, 360_000);
});
