/**
 * Session / validation contract that needs no LLM answer (plan section 6).
 * AC 5 (soft delete), AC 7 (400s), AC 19 (owner isolation, HTTP half),
 * AC 22 (path safety), plus the vl_owner cookie attributes (Q4).
 *
 * The agent is pointed at a dead port with a fake key, so nothing in this file
 * can reach Gemini. The real server, the real SessionStore and the real
 * routes answer.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Client,
  REPO_ROOT,
  Q_ART25,
  deadLlmEnv,
  makeTempArea,
  randomOwner,
  readJsonl,
  sessionFile,
  sha256File,
  startReadyServer,
  stopAll,
  walkFiles,
  type ServerHandle,
} from "./helpers/harness";

const area = makeTempArea("vnl-sessions-");
let server: ServerHandle;
let owner1: Client;

beforeAll(async () => {
  server = await startReadyServer({
    sessionsDir: area.sessionsDir,
    env: await deadLlmEnv(),
  });
  owner1 = new Client(server.base);
}, 180_000);

afterAll(async () => {
  await stopAll();
  area.cleanup();
});

async function createSession(c: Client): Promise<string> {
  const r = await c.post("/api/agent/sessions");
  expect(r.status, r.text).toBe(201);
  expect(typeof r.json.session_id).toBe("string");
  expect(typeof r.json.created_at).toBe("string");
  return r.json.session_id as string;
}

describe("owner cookie (decision Q4)", () => {
  it("first request issues an httpOnly SameSite=Strict vl_owner cookie", async () => {
    const c = new Client(server.base);
    const res = await fetch(`${server.base}/api/agent/sessions`, {
      headers: { accept: "application/json" },
    });
    const sc = (res.headers.getSetCookie?.() ?? []).find((s) =>
      s.startsWith("vl_owner="),
    );
    expect(sc, "Set-Cookie vl_owner").toBeTruthy();
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Strict/i);
    // value is a random 128-bit id (32 hex chars)
    expect(/^vl_owner=([0-9a-f]{32})/i.test(sc!)).toBe(true);
    void c;
  });
});

describe("AC 7: invalid bodies return 400 invalid_request", () => {
  const bad: [string, unknown][] = [
    ["empty query", { query: "" }],
    ["missing query", {}],
    ["query over 1000 chars", { query: "a".repeat(1001) }],
    ["mode 'x'", { query: Q_ART25, mode: "x" }],
  ];

  for (const [name, body] of bad) {
    it(`C1 stream: ${name}`, async () => {
      const r = await owner1.stream(body);
      expect(r.status, r.raw).toBe(400);
      expect(r.json?.error).toBe("invalid_request");
      expect(r.json?.details).toBeDefined();
      expect(r.headers.get("content-type") ?? "").not.toContain(
        "text/event-stream",
      );
    });

    it(`C2 run: ${name}`, async () => {
      const r = await owner1.post("/api/agent/run", body);
      expect(r.status, r.text).toBe(400);
      expect(r.json?.error).toBe("invalid_request");
    });
  }

  it("a query of exactly 1000 chars is accepted (200 or a 502 upstream error), not 400/404", async () => {
    const r = await owner1.post("/api/agent/run", { query: "a".repeat(1000) });
    expect([200, 502], r.text).toContain(r.status);
  }, 90_000);
});

describe("AC 5: DELETE is soft", () => {
  it("returns 200 {mode:soft}, keeps the JSONL ending in a deleted record, then 404 everywhere", async () => {
    const id = await createSession(owner1);

    const listed = await owner1.get("/api/agent/sessions");
    expect(listed.status).toBe(200);
    expect(listed.json.sessions.map((s: any) => s.session_id)).toContain(id);

    const del = await owner1.del(`/api/agent/sessions/${id}`);
    expect(del.status, del.text).toBe(200);
    expect(del.json).toMatchObject({
      session_id: id,
      deleted: true,
      mode: "soft",
    });

    const file = sessionFile(area.sessionsDir, id);
    expect(fs.existsSync(file), `${file} must still exist`).toBe(true);
    const recs = readJsonl(file);
    expect(recs.at(-1)?.kind).toBe("deleted");

    expect((await owner1.get(`/api/agent/sessions/${id}`)).status).toBe(404);
    const after = await owner1.get("/api/agent/sessions");
    expect(after.json.sessions.map((s: any) => s.session_id)).not.toContain(id);
    expect(
      (await owner1.get(`/api/agent/traces?session_id=${id}`)).status,
    ).toBe(404);

    const s = await owner1.stream({ query: Q_ART25, session_id: id });
    expect(
      s.status,
      "stream with a deleted id fails BEFORE the stream starts",
    ).toBe(404);
    expect(s.json?.error).toBe("session_not_found");
    const run = await owner1.post("/api/agent/run", {
      query: Q_ART25,
      session_id: id,
    });
    expect(run.status).toBe(404);
    expect((await owner1.del(`/api/agent/sessions/${id}`)).status).toBe(404);
  });
});

describe("AC 19 (HTTP half): another vl_owner cannot see, run or delete a session", () => {
  it("C4/C5/C6/C8/C1/C2 hide session A from a different owner", async () => {
    const a = await createSession(owner1);
    const other = new Client(server.base, randomOwner());

    const list = await other.get("/api/agent/sessions");
    expect(list.status).toBe(200);
    expect(list.json.sessions.map((s: any) => s.session_id)).not.toContain(a);

    expect((await other.get(`/api/agent/sessions/${a}`)).status).toBe(404);
    expect((await other.del(`/api/agent/sessions/${a}`)).status).toBe(404);
    expect((await other.get(`/api/agent/traces?session_id=${a}`)).status).toBe(
      404,
    );
    const s = await other.stream({ query: Q_ART25, session_id: a });
    expect(s.status).toBe(404);
    expect(s.json?.error).toBe("session_not_found");
    expect(
      (await other.post("/api/agent/run", { query: Q_ART25, session_id: a }))
        .status,
    ).toBe(404);

    // the foreign delete attempt must not have deleted it for the owner
    const mine = await owner1.get(`/api/agent/sessions/${a}`);
    expect(mine.status).toBe(200);
    expect(mine.json.session_id).toBe(a);
    // and the 404 body must not reveal existence
    const foreign = await other.get(`/api/agent/sessions/${a}`);
    expect(foreign.json).toEqual({ error: "session_not_found" });
  });
});

/** A 400/404 that the AGENT routes produced, not Fastify's generic route-not-found. */
function expectAgentRefusal(label: string, status: number, json: any) {
  expect([400, 404], `${label} -> ${status}`).toContain(status);
  expect(
    ["invalid_request", "session_not_found"],
    `${label} body ${JSON.stringify(json)}`,
  ).toContain(json?.error);
}

describe("AC 22: path safety", () => {
  it("hostile session_id values give 400/404 and touch nothing outside AGENT_SESSIONS_DIR", async () => {
    // positive control: the agent routes exist and work, so the refusals below
    // come from the session-id check and not from a missing route
    await createSession(owner1);
    const pkgPath = path.join(REPO_ROOT, "package.json");
    const pkgHash = sha256File(pkgPath);
    // area.root/a/b/sessions: "../../x" resolves to area.root/a/x (a decoy target)
    const outside = () =>
      walkFiles(area.root).filter((f) => !f.startsWith("a/b/sessions/"));
    const before = outside();
    const sessionsBefore = walkFiles(area.sessionsDir);

    const ids = [
      "../../package.json",
      "..\\..\\package.json",
      "x",
      "../../package",
      "%2e%2e%2f%2e%2e%2fpackage.json",
      "a/b",
    ];
    for (const id of ids) {
      const s = await owner1.stream({ query: Q_ART25, session_id: id });
      expectAgentRefusal(`C1 ${JSON.stringify(id)}`, s.status, s.json);
      const r = await owner1.post("/api/agent/run", {
        query: Q_ART25,
        session_id: id,
      });
      expectAgentRefusal(`C2 ${JSON.stringify(id)}`, r.status, r.json);
      const g = await owner1.get(
        `/api/agent/sessions/${encodeURIComponent(id)}`,
      );
      expectAgentRefusal(`C5 ${JSON.stringify(id)}`, g.status, g.json);
      const d = await owner1.del(
        `/api/agent/sessions/${encodeURIComponent(id)}`,
      );
      expectAgentRefusal(`C6 ${JSON.stringify(id)}`, d.status, d.json);
      const t = await owner1.get(
        `/api/agent/traces?session_id=${encodeURIComponent(id)}`,
      );
      expectAgentRefusal(`C8 ${JSON.stringify(id)}`, t.status, t.json);
    }

    expect(outside(), "no file appeared outside the sessions dir").toEqual(
      before,
    );
    expect(sha256File(pkgPath), "repo package.json untouched").toBe(pkgHash);
    expect(
      walkFiles(area.sessionsDir),
      "no file appeared for a hostile id",
    ).toEqual(sessionsBefore);
    for (const f of walkFiles(area.sessionsDir)) {
      expect(f).toMatch(/^[A-Za-z0-9_.-]+$/); // flat files only
    }
  }, 180_000);
});
