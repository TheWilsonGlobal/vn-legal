import type { AgentStep, StepKind, Turn } from "../contract";
import { countTokens } from "../memory/tokens";
import { GENESIS_HASH } from "./hash";
import type { IndexEntry, StoredRecord } from "./schema";

/** In-RAM view of one session, rebuilt from its log at load() and kept in step with appends. */
export interface SessionState {
  entry: IndexEntry;
  /** row_hash of the last record; the next record's prev_hash. */
  lastRowHash: string;
  /** Every run_id that has had a query record in this session. */
  seenRuns: Set<string>;
  /** Runs whose query is still waiting for an answer or error. */
  pendingRuns: Set<string>;
}

export function newSessionState(
  sessionId: string,
  owner: string,
): SessionState {
  return {
    entry: {
      session_id: sessionId,
      owner,
      title: "",
      created_at: "",
      last_active_at: "",
      turns: 0,
      record_count: 0,
      tokens: 0,
      hidden: false,
    },
    lastRowHash: GENESIS_HASH,
    seenRuns: new Set(),
    pendingRuns: new Set(),
  };
}

const TITLE_MAX_CHARS = 80;

/** Title = the first query, whitespace collapsed, cut to 80 code points with an ellipsis. */
export function titleFrom(query: string): string {
  const flat = query.normalize("NFC").replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  if (chars.length <= TITLE_MAX_CHARS) return flat;
  return `${chars.slice(0, TITLE_MAX_CHARS - 1).join("")}…`;
}

/**
 * Applies one record to a session. Every check runs before any field changes,
 * so a rejected record leaves the state as it was.
 */
export function applyRecord(state: SessionState, rec: StoredRecord): void {
  const e = state.entry;
  if (e.hidden) throw new Error(`record ${rec.seq} follows a deleted record`);
  if (rec.seq !== e.record_count + 1) {
    throw new Error(`seq ${rec.seq} where ${e.record_count + 1} was expected`);
  }
  if (rec.prev_hash !== state.lastRowHash) {
    throw new Error("prev_hash does not link to the previous record");
  }
  const first = e.record_count === 0;
  if (first !== (rec.kind === "session_created")) {
    throw new Error(
      first
        ? "the first record must be session_created"
        : "session_created may only be the first record",
    );
  }
  if (rec.kind === "query") {
    if (rec.run_id === null || state.seenRuns.has(rec.run_id)) {
      throw new Error("query run_id is not new in this session");
    }
  } else if (
    rec.kind === "step" ||
    rec.kind === "answer" ||
    rec.kind === "error" ||
    rec.kind === "llm_call"
  ) {
    if (rec.run_id === null || !state.pendingRuns.has(rec.run_id)) {
      throw new Error(`${rec.kind} has no open query for its run_id`);
    }
  }

  e.record_count += 1;
  e.last_active_at = rec.created_at;
  state.lastRowHash = rec.row_hash;
  switch (rec.kind) {
    case "session_created":
      e.created_at = rec.created_at;
      break;
    case "query":
      if (rec.run_id !== null) {
        state.seenRuns.add(rec.run_id);
        state.pendingRuns.add(rec.run_id);
      }
      if (e.title === "") e.title = titleFrom(rec.content);
      e.tokens += countTokens(rec.content);
      break;
    case "step":
      break;
    case "answer":
      e.turns += 1;
      e.tokens += countTokens(rec.content);
      if (rec.run_id !== null) state.pendingRuns.delete(rec.run_id);
      break;
    case "error":
      e.turns += 1;
      if (rec.run_id !== null) state.pendingRuns.delete(rec.run_id);
      break;
    case "deleted":
      e.hidden = true;
      break;
  }
}

/**
 * Builds the completed turns of a session from its records, in order. A query
 * counts as a turn only once an answer or error with the same run_id exists.
 *
 * Every step and trace field is replayed as stored. A stored record that lacks
 * a field the replay needs throws, naming the record; nothing is defaulted.
 * Only error records may omit trace_id and trace_url, and an omitted value
 * replays as null.
 */
export function buildTurns(records: StoredRecord[]): Turn[] {
  type Pending = {
    runId: string;
    query: StoredRecord;
    steps: StoredRecord[];
    answer: StoredRecord | null;
    error: StoredRecord | null;
  };
  const pending: Pending[] = [];
  const byRun = new Map<string, Pending>();
  for (const rec of records) {
    if (rec.kind === "query" && rec.run_id !== null) {
      const p: Pending = {
        runId: rec.run_id,
        query: rec,
        steps: [],
        answer: null,
        error: null,
      };
      pending.push(p);
      byRun.set(rec.run_id, p);
    } else if (rec.kind === "step" && rec.run_id !== null) {
      byRun.get(rec.run_id)?.steps.push(rec);
    } else if (rec.kind === "answer" && rec.run_id !== null) {
      const p = byRun.get(rec.run_id);
      if (p) p.answer = rec;
    } else if (rec.kind === "error" && rec.run_id !== null) {
      const p = byRun.get(rec.run_id);
      if (p) p.error = rec;
    }
  }

  const turns: Turn[] = [];
  for (const p of pending) {
    const outcome = p.answer ?? p.error;
    if (outcome === null) continue;
    const trace = replayTrace(outcome);
    turns.push({
      run_id: p.runId,
      query: p.query.content,
      answer: p.answer ? p.answer.content : "",
      steps: p.steps.map(replayStep),
      created_at: p.query.created_at,
      ok: p.answer !== null && required(p.answer, "ok", p.answer.ok),
      trace_id: trace.trace_id,
      trace_url: trace.trace_url,
    });
  }
  return turns;
}

/** The stored value, or a throw naming the record. Never a default. */
function required<T>(
  rec: StoredRecord,
  field: string,
  value: T | undefined,
): T {
  if (value === undefined) {
    throw new Error(
      `${rec.kind} record seq ${rec.seq} (run ${rec.run_id}) has no ${field}; it cannot be replayed exactly`,
    );
  }
  return value;
}

function replayStep(s: StoredRecord): AgentStep {
  if (s.step_kind === undefined)
    throw new Error("step record without step_kind");
  return {
    index: required(s, "index", s.index),
    kind: s.step_kind as StepKind,
    content: s.content,
    tool: required(s, "tool", s.tool),
    tool_input: required(s, "tool_input", s.tool_input),
    ok: required(s, "ok", s.ok),
    duration_ms: required(s, "duration_ms", s.duration_ms),
    citations: required(s, "citations", s.citations),
    ...(s.graph ? { graph: s.graph } : {}),
    ...(s.reports ? { reports: s.reports } : {}),
  };
}

/**
 * Trace fields of the answer or error that ends a run. An answer must carry
 * both. An error may omit them, and an omitted value is null.
 */
function replayTrace(outcome: StoredRecord): {
  trace_id: string | null;
  trace_url: string | null;
} {
  if (outcome.kind === "answer") {
    return {
      trace_id: required(outcome, "trace_id", outcome.trace_id),
      trace_url: required(outcome, "trace_url", outcome.trace_url),
    };
  }
  return {
    trace_id: outcome.trace_id ?? null,
    trace_url: outcome.trace_url ?? null,
  };
}
