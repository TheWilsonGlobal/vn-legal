import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OWNER_A,
  RUN_1,
  makeStore,
  makeTempDir,
  queryRec,
  removeTempDir,
} from "./fixtures";

let dir: string;

beforeEach(async () => {
  dir = await makeTempDir();
});

afterEach(async () => {
  await removeTempDir(dir);
});

function llmRec(sessionId: string, seq: number, userText: string) {
  return {
    session_id: sessionId,
    run_id: RUN_1,
    seq,
    created_at: new Date().toISOString(),
    kind: "llm_call" as const,
    content: "Lời gọi LLM #1: 0 lệnh gọi công cụ, 2 ký tự trả lời",
    llm: {
      call_index: 1,
      model: "test-model",
      latency_ms: 12,
      system: "Bạn là trợ lý pháp luật.",
      messages: [{ role: "user" as const, content: userText }],
      response: { text: "ok", tool_calls: [] },
      usage: null,
    },
  };
}

describe("llm_call records", () => {
  it("keeps a very long prompt whole, across a reload from disk", async () => {
    const store = makeStore(dir);
    await store.load();
    const s = await store.create(OWNER_A);
    const id = s.session_id;
    await store.append(id, queryRec(id, RUN_1, 2, "câu hỏi"));
    const huge = "a".repeat(200_000);
    await store.append(id, llmRec(id, 3, huge));

    const reloaded = makeStore(dir);
    await reloaded.load();
    const page = await reloaded.records(OWNER_A, {
      kind: "llm_call",
      offset: 0,
      limit: 5,
    });
    expect(page.total).toBe(1);
    expect(page.records[0].llm?.messages[0].content).toBe(huge);
  });

  it("refuses an llm_call record without its llm payload", async () => {
    const store = makeStore(dir);
    await store.load();
    const s = await store.create(OWNER_A);
    const id = s.session_id;
    await store.append(id, queryRec(id, RUN_1, 2, "câu hỏi"));
    const { llm: _omit, ...withoutLlm } = llmRec(id, 3, "x");
    await expect(store.append(id, withoutLlm as any)).rejects.toThrow(
      /llm_call/,
    );
  });
});
