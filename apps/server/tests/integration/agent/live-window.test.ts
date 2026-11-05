/**
 * LIVE window limits (AC 18): 12 turns in one session, then the next run's
 * done.memory is bounded, and recall of turn 1 still works because recall
 * reads the whole persisted log.
 *
 * Runs only with VN_LEGAL_LIVE=1. ~14 real Gemini runs, strictly one at a time.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Client,
  LIVE,
  assertStreamGrammar,
  makeTempArea,
  randomOwner,
  startReadyServer,
  stepsOf,
  stopAll,
  type ServerHandle,
} from "./helpers/harness";

const area = makeTempArea("vnl-live-window-");
let server: ServerHandle;

afterAll(async () => {
  await stopAll();
  area.cleanup();
});

describe.runIf(LIVE)("live window limits (VN_LEGAL_LIVE=1)", () => {
  beforeAll(async () => {
    server = await startReadyServer({ sessionsDir: area.sessionsDir });
  }, 240_000);

  it("AC 18: after 12 turns window_turns <= 8, window_tokens <= 512, summarized_turns >= 4; recall still finds turn 1", async () => {
    const c = new Client(server.base, randomOwner());
    const sid = (await c.post("/api/agent/sessions")).json.session_id as string;
    const turn1 =
      "Điều 1 Bộ luật Dân sự quy định gì, mã tham chiếu quokka7731?";

    for (let n = 1; n <= 12; n++) {
      const q = n === 1 ? turn1 : `Điều ${n} Bộ luật Dân sự quy định gì?`;
      const r = await c.stream({ query: q, session_id: sid });
      expect(assertStreamGrammar(r.events), `turn ${n}`).toBe("done");
    }

    const r13 = await c.stream({
      query: "Điều 13 Bộ luật Dân sự quy định gì?",
      session_id: sid,
    });
    expect(assertStreamGrammar(r13.events)).toBe("done");
    const mem = r13.events.at(-1)!.data.memory;
    expect(mem.window_turns).toBeLessThanOrEqual(8);
    expect(mem.window_tokens).toBeLessThanOrEqual(512);
    expect(mem.summarized_turns).toBeGreaterThanOrEqual(4);

    const rec = await c.stream({
      query: "Nhắc lại: tôi đã hỏi gì về mã quokka7731?",
      session_id: sid,
    });
    expect(assertStreamGrammar(rec.events)).toBe("done");
    const obs = stepsOf(rec.events).find(
      (s: any) => s.kind === "observation" && s.tool === "recall_session",
    );
    expect(obs?.ok).toBe(true);
    expect(obs.content).toContain("Điều 1 Bộ luật Dân sự quy định gì");

    // C10 reflects the runs (turns counted, session active)
    const stats = await c.get("/api/agent/memory/stats");
    expect(stats.status, stats.text).toBe(200);
    expect(stats.json.short_term.active_sessions).toBeGreaterThanOrEqual(1);
    expect(stats.json.short_term.max_turns).toBe(8);
    expect(stats.json.short_term.max_tokens).toBe(512);
  }, 1_800_000);
});
