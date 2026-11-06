/**
 * Persistence, torn-log refusal and the hash chain (plan 5.5).
 * AC 20 (restart half, no LLM needed), AC 21 (torn log), AC 25 (C8v tamper).
 *
 * Runs are produced against a dead LLM port with a fake key, so each run
 * writes a real `query` + `step` + `error` record set through the real
 * SessionStore without any Gemini call. The recall-after-restart half of
 * AC 20 is in live-agent.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  Client,
  deadLlmEnv,
  expectBootRefusal,
  expectNoKeyShapes,
  makeTempArea,
  randomOwner,
  readJsonl,
  sessionFile,
  startReadyServer,
  stepsOf,
  stopAll,
  tail,
  assertStreamGrammar,
  type ServerHandle,
} from "./helpers/harness";

const area = makeTempArea("vnl-persist-");
afterAll(async () => {
  await stopAll();
  area.cleanup();
});

// ASCII on purpose: the tamper test edits one byte of this text in the file.
const QUERY = "Cho toi hoi ve quyen nhan than theo Dieu 25";

async function produceRun(
  sessionsDir: string,
  ownerValue: string,
): Promise<{
  sid: string;
  stepCount: number;
  runId: string;
  server: ServerHandle;
}> {
  const server = await startReadyServer({
    sessionsDir,
    env: await deadLlmEnv(),
  });
  const c = new Client(server.base, ownerValue);
  const r = await c.stream({ query: QUERY });
  expect(r.status, r.raw).toBe(200);
  expect(assertStreamGrammar(r.events)).toBe("error");
  const sid = r.events[0].data.session_id as string;
  return {
    sid,
    stepCount: stepsOf(r.events).length,
    runId: "",
    server,
  };
}

describe("AC 20: persistence across a server restart", () => {
  it("JSONL gains exactly one query, n step and one error record; after stop/start C4 lists the session inactive and C5 replays the turn with steps", async () => {
    const owner = randomOwner();
    const {
      sid,
      stepCount,
      server: s1,
    } = await produceRun(area.sessionsDir, owner);

    const file = sessionFile(area.sessionsDir, sid);
    expect(fs.existsSync(file)).toBe(true);
    const recs = readJsonl(file);
    const runIds = [
      ...new Set(recs.filter((r) => r.run_id).map((r) => r.run_id)),
    ];
    expect(runIds).toHaveLength(1);
    const mine = recs.filter((r) => r.run_id === runIds[0]);
    expect(mine.filter((r) => r.kind === "query")).toHaveLength(1);
    expect(mine.filter((r) => r.kind === "error")).toHaveLength(1);
    expect(mine.filter((r) => r.kind === "answer")).toHaveLength(0);
    expect(mine.filter((r) => r.kind === "step")).toHaveLength(stepCount);
    expect(stepCount).toBeGreaterThanOrEqual(1);
    // records are sequenced and hash-chained (decision Q13)
    for (const r of recs) {
      expect(typeof r.row_hash).toBe("string");
      expect(typeof r.prev_hash).toBe("string");
    }
    expectNoKeyShapes("session file", fs.readFileSync(file, "utf8"));

    const live = await new Client(s1.base, owner).get("/api/agent/sessions");
    expect(
      live.json.sessions.find((s: any) => s.session_id === sid)?.active,
    ).toBe(true);

    // AC 23: C10 reflects the dead-LLM run. This is the first test in a fresh
    // sessions dir, so the store counts are exact: one session, every record
    // of the file, nothing hidden.
    const stats = await new Client(s1.base, owner).get(
      "/api/agent/memory/stats",
    );
    expect(stats.status, stats.text).toBe(200);
    expect(stats.json.store).toEqual({
      sessions: 1,
      records: recs.length,
      hidden: 0,
    });
    expect(stats.json.short_term.active_sessions).toBeGreaterThanOrEqual(1);
    // Whether a failed (ok:false) turn enters the sliding window is not fixed
    // by the plan or contract.ts, so `turns` is bounded, not pinned to 1.
    expect(Number.isInteger(stats.json.short_term.turns)).toBe(true);
    expect(stats.json.short_term.turns).toBeGreaterThanOrEqual(0);
    expect(stats.json.short_term.turns).toBeLessThanOrEqual(
      stats.json.short_term.max_turns * stats.json.short_term.active_sessions,
    );

    await s1.stop();

    const s2 = await startReadyServer({
      sessionsDir: area.sessionsDir,
      env: await deadLlmEnv(),
    });
    const c2 = new Client(s2.base, owner);
    const list = await c2.get("/api/agent/sessions");
    const row = list.json.sessions.find((s: any) => s.session_id === sid);
    expect(row, "session survives restart").toBeTruthy();
    expect(row.active).toBe(false);
    expect(row.turns).toBe(1);
    expect(row.message_count).toBe(2);

    const detail = await c2.get(`/api/agent/sessions/${sid}`);
    expect(detail.status, detail.text).toBe(200);
    expect(detail.json.turns).toHaveLength(1);
    const turn = detail.json.turns[0];
    expect(turn.query).toBe(QUERY);
    expect(turn.ok).toBe(false);
    expect(turn.steps).toHaveLength(stepCount);

    // a different owner still cannot see it after the restart
    const other = new Client(s2.base, randomOwner());
    expect((await other.get(`/api/agent/sessions/${sid}`)).status).toBe(404);
    await s2.stop();
  }, 300_000);
});

describe("AC 25: C8v hash chain", () => {
  it("returns ok:true, then ok:false with first_bad after one byte of a record's content is edited", async () => {
    const dir = path.join(area.root, "ac25");
    fs.mkdirSync(dir, { recursive: true });
    const owner = randomOwner();
    const { sid, server } = await produceRun(dir, owner);
    const c = new Client(server.base, owner);

    const good = await c.get("/api/agent/traces/verify");
    expect(good.status, good.text).toBe(200);
    expect(good.json.ok).toBe(true);
    expect(good.json.records).toBeGreaterThanOrEqual(3);
    expect(good.json.first_bad).toBeNull();

    // edit ONE byte inside the `query` record's content (valid JSON stays valid)
    const file = sessionFile(dir, sid);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const idx = lines.findIndex((l) => /"kind"\s*:\s*"query"/.test(l));
    expect(idx).toBeGreaterThanOrEqual(0);
    const m = /"content"\s*:\s*"/.exec(lines[idx]);
    expect(m).not.toBeNull();
    const pos = m!.index + m![0].length;
    const orig = lines[idx][pos];
    expect(orig).toMatch(/[A-Za-z]/);
    const flipped = orig === "X" ? "Y" : "X";
    lines[idx] = lines[idx].slice(0, pos) + flipped + lines[idx].slice(pos + 1);
    fs.writeFileSync(file, lines.join("\n"));

    const bad = await c.get("/api/agent/traces/verify");
    expect(bad.status, bad.text).toBe(200);
    expect(bad.json.ok).toBe(false);
    expect(bad.json.first_bad).toMatchObject({
      session_id: sid,
      line: idx + 1, // 1-based line number of the edited record
    });
    await server.stop();
  }, 300_000);
});

describe("AC 21: torn log makes the server refuse to start", () => {
  it("truncating the last line of a session file -> non-zero exit, log names the file and the line", async () => {
    const dir = path.join(area.root, "ac21");
    fs.mkdirSync(dir, { recursive: true });
    const { sid, server } = await produceRun(dir, randomOwner());
    await server.stop();

    const file = sessionFile(dir, sid);
    const raw = fs.readFileSync(file, "utf8");
    const total = raw.split("\n").filter((l) => l !== "").length;
    expect(total).toBeGreaterThanOrEqual(2);
    // cut the trailing newline and a chunk of the last record
    fs.writeFileSync(file, raw.slice(0, raw.length - 25));

    const r = await expectBootRefusal({
      sessionsDir: dir,
      env: await deadLlmEnv(),
    });
    expect(r.exit.code, tail(r.log)).not.toBe(0);
    expect(r.exit.code).not.toBeNull();
    expect(r.log, "log names the file").toContain(`${sid}.jsonl`);
    expect(r.log, "log names the line").toMatch(
      new RegExp(`(line\\s*|:)${total}\\b`, "i"),
    );
    expectNoKeyShapes("boot log", r.log);
  }, 300_000);

  it("a corrupt index.json also refuses to start, naming the file", async () => {
    const dir = path.join(area.root, "ac21-index");
    fs.mkdirSync(dir, { recursive: true });
    const { server } = await produceRun(dir, randomOwner());
    await server.stop();
    const idx = path.join(dir, "index.json");
    expect(fs.existsSync(idx)).toBe(true);
    fs.writeFileSync(idx, "{ not json");
    const r = await expectBootRefusal({
      sessionsDir: dir,
      env: await deadLlmEnv(),
    });
    expect(r.exit.code).not.toBe(0);
    expect(r.log).toContain("index.json");
  }, 300_000);
});
