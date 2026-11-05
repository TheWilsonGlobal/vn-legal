/**
 * LIVE upstream errors against real Google (AC 37 live half, AC 38).
 *
 * Runs only with VN_LEGAL_LIVE=1. The invalid keys here are the literal word
 * "invalid" (plan AC 37/38), sent to Google on purpose.
 * Contract: AC 37 requires code llm_auth_error. If Google answers an invalid
 * key with HTTP 400, the runner returns llm_error and this test fails: that is
 * a finding for the PM (plan 5.3 maps 400 to llm_error, 401/403 to
 * llm_auth_error), not a test to loosen.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  Client,
  LIVE,
  Q_ART25,
  assertStreamGrammar,
  expectNoKeyShapes,
  makeTempArea,
  ofKind,
  startReadyServer,
  stepsOf,
  stopAll,
  walkFiles,
} from "./helpers/harness";

const area = makeTempArea("vnl-live-errors-");
afterAll(async () => {
  await stopAll();
  area.cleanup();
});

function sessionText(dir: string) {
  return walkFiles(dir)
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
}

describe.runIf(LIVE)("live upstream errors (VN_LEGAL_LIVE=1)", () => {
  it("AC 37: GEMINI_API_KEY='invalid' -> error llm_auth_error, no done, no key material or URL anywhere", async () => {
    const dir = path.join(area.root, "ac37");
    fs.mkdirSync(dir, { recursive: true });
    const server = await startReadyServer({
      sessionsDir: dir,
      env: { GEMINI_API_KEY: "invalid" },
    });
    const c = new Client(server.base);
    const r = await c.stream({ query: Q_ART25 });
    expect(assertStreamGrammar(r.events)).toBe("error");
    const err = r.events.at(-1)!.data;
    expect(err.code).toBe("llm_auth_error");
    expect(ofKind(r.events, "done")).toHaveLength(0);
    expect(stepsOf(r.events).some((s: any) => s.kind === "final")).toBe(false);
    expect(String(err.detail)).not.toMatch(/https?:\/\//);
    expect(String(err.detail)).not.toMatch(/key=/i);
    const bundle = [r.raw, server.log(), sessionText(dir)].join("\n");
    expectNoKeyShapes("bundle", bundle);
    // the retry log must show no retry for an auth error
    expect(server.log()).not.toMatch(/\[WARN\][^\n]*retry/i);

    const run = await c.post("/api/agent/run", { query: Q_ART25 });
    expect(run.status, run.text).toBe(502);
    expect(run.json.error).toBe("llm_auth_error");
  }, 300_000);

  it("AC 38: GEMINI_EMBEDDING_API_KEY='invalid' -> a legal question ends in error embedding_error, no done, no answer", async () => {
    const dir = path.join(area.root, "ac38");
    fs.mkdirSync(dir, { recursive: true });
    const server = await startReadyServer({
      sessionsDir: dir,
      env: { GEMINI_EMBEDDING_API_KEY: "invalid" },
    });
    const c = new Client(server.base);
    const r = await c.stream({ query: Q_ART25 });
    expect(assertStreamGrammar(r.events)).toBe("error");
    expect(r.events.at(-1)!.data.code).toBe("embedding_error");
    expect(ofKind(r.events, "done")).toHaveLength(0);
    const steps = stepsOf(r.events);
    expect(steps.some((s: any) => s.kind === "final")).toBe(false);
    expect(
      ofKind(r.events, "token")
        .map((e) => e.data.text)
        .join(""),
    ).toBe("");
    expectNoKeyShapes(
      "bundle",
      [r.raw, server.log(), sessionText(dir)].join("\n"),
    );

    const run = await c.post("/api/agent/run", { query: Q_ART25 });
    expect(run.status, run.text).toBe(502);
    expect(run.json.error).toBe("embedding_error");
    expect(run.json.answer).toBeUndefined();
  }, 300_000);
});
