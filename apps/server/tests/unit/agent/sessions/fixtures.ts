import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Citation, SessionRecord } from "../../../../src/agent/contract";
import {
  createJsonlSessionStore,
  type JsonlSessionStore,
} from "../../../../src/agent/sessions";

export const OWNER_A = "owner-a";
export const OWNER_B = "owner-b";

/** Deterministic ISO timestamps: second n of 2026-01-01 UTC. */
export function at(n: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
}

export async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "sessions-unit-"));
}

export async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export function makeStore(
  dir: string,
  active: Set<string> = new Set(),
): JsonlSessionStore {
  return createJsonlSessionStore({ dir, isActive: (id) => active.has(id) });
}

export function queryRec(
  sessionId: string,
  runId: string,
  seq: number,
  content: string,
): SessionRecord {
  return {
    session_id: sessionId,
    run_id: runId,
    seq,
    created_at: at(seq),
    kind: "query",
    content,
  };
}

export const CITATION: Citation = {
  article_id: "art-25",
  article_number: 25,
  breadcrumb: ["Bộ luật Dân sự 2015", "Điều 25"],
  via: "lookup",
};

/** A step with every field the runner must write. `extra` overrides or adds fields. */
export function stepRec(
  sessionId: string,
  runId: string,
  seq: number,
  content: string,
  extra: Partial<SessionRecord> = {},
): SessionRecord {
  return {
    session_id: sessionId,
    run_id: runId,
    seq,
    created_at: at(seq),
    kind: "step",
    step_kind: "action",
    tool: "lookup",
    content,
    ok: true,
    index: 0,
    tool_input: '{"article":25}',
    duration_ms: 12,
    citations: [CITATION],
    ...extra,
  };
}

export function answerRec(
  sessionId: string,
  runId: string,
  seq: number,
  content: string,
  extra: Partial<SessionRecord> = {},
): SessionRecord {
  return {
    session_id: sessionId,
    run_id: runId,
    seq,
    created_at: at(seq),
    kind: "answer",
    content,
    ok: true,
    trace_id: null,
    trace_url: null,
    ...extra,
  };
}

/** Lines of a session log, without the trailing newline. */
export async function logLines(dir: string, id: string): Promise<string[]> {
  const text = await readFile(join(dir, `${id}.jsonl`), "utf8");
  return text.split("\n").filter((l) => l.length > 0);
}

export async function readIndex(dir: string): Promise<{
  version: number;
  sessions: Array<Record<string, unknown>>;
}> {
  return JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
}

export const RUN_1 = "11111111-1111-4111-8111-111111111111";
export const RUN_2 = "22222222-2222-4222-8222-222222222222";
