// ============================================================================
// SessionMemory (contract.ts, r2; plan §5.5, §5.2 recall_session, §6 C10).
//
// Layers:
//   owners   sessionId -> owner, from bindOwner(). Never evicted, so a window
//            can be rebuilt after eviction without the caller passing an owner.
//            SessionStore reads are owner-scoped, so this is the only route to
//            the log. The runner binds on every run and checks ownership first.
//   entries  RAM windows. LRU capped at maxSessions, dropped after
//            sessionTtlS of idle time. Eviction drops the window only.
//
// Reads from the persisted log go through store.turns(owner, id) only. A
// session id is never mixed with another session's records.
//
// Errors from the store propagate. Nothing here turns a failed read into an
// empty window.
// ============================================================================

import type {
  AgentConfig,
  SessionMemory,
  SessionStore,
  Turn,
} from "../contract";
import { isFirstKey, isRecentKey } from "./intent";
import {
  addExchange,
  createWindowState,
  hasAnswer,
  recentTokens,
  renderSummary,
  windowMessages,
  type Exchange,
  type WindowLimits,
  type WindowState,
} from "./window-state";

export type MemoryLimits = Omit<AgentConfig["memory"], "sessionsDir">;

export const MAX_RECALL_ITEMS = 3;

/** C10 `short_term` and `recall` blocks (plan §6). The `store` block needs the store port, see report. */
export interface MemoryStats {
  short_term: {
    active_sessions: number;
    turns: number;
    tokens: number;
    max_turns: number;
    max_tokens: number;
    max_sessions: number;
    ttl_s: number;
  };
  recall: { calls: number; hits: number; empty: number };
}

export interface NoteTurn {
  run_id: string;
  query: string;
  answer: string;
}

/**
 * Concurrency: the runner must serialise runs per session. It must not start a run
 * for a session until the previous run has called recordTurn(). window() and
 * recordTurn() are not ordered against each other across overlapping runs of one
 * session: a load that starts before a recordTurn() may miss that turn.
 */
export interface SessionMemoryService extends SessionMemory {
  /**
   * Registers the session's owner. Must run before window() or recall() for the session.
   * Bind only after store.get(owner, id) != null, so the owner is checked against the
   * store first. A second bind with a different owner throws.
   */
  bindOwner(owner: string, sessionId: string): void;
  /**
   * Adds a finished turn to the RAM window. Call after its answer record is in the store.
   * Returns false, and changes nothing, when the turn has no answer (a failed run takes
   * no window slot), the run id is already in the window, or the window is not loaded.
   * A run id that has already left the window is not recognised.
   */
  recordTurn(sessionId: string, turn: NoteTurn): boolean;
  /** True while the window is in RAM: inside the LRU cap and not idle past the TTL. */
  isActive(sessionId: string): boolean;
  /** Drops the RAM window. The owner binding and the persisted log are kept. */
  forget(sessionId: string): boolean;
  stats(): MemoryStats;
}

export interface CreateSessionMemoryOptions {
  store: SessionStore;
  limits: MemoryLimits;
  /** Epoch milliseconds. Injected for tests; defaults to the wall clock. */
  now?: () => number;
}

interface Entry {
  state: WindowState | null;
  loading: Promise<WindowState> | null;
  lastTouchMs: number;
}

function requirePositiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
}

function validateLimits(limits: MemoryLimits): void {
  requirePositiveInt("shortTermMaxTurns", limits.shortTermMaxTurns);
  requirePositiveInt("shortTermMaxTokens", limits.shortTermMaxTokens);
  requirePositiveInt("maxObservationTokens", limits.maxObservationTokens);
  requirePositiveInt("maxSessions", limits.maxSessions);
  if (
    !Number.isInteger(limits.historyMaxTokens) ||
    limits.historyMaxTokens < 64
  ) {
    throw new RangeError(
      `historyMaxTokens must be an integer >= 64, got ${limits.historyMaxTokens}`,
    );
  }
  if (!(limits.sessionTtlS > 0)) {
    throw new RangeError(`sessionTtlS must be > 0, got ${limits.sessionTtlS}`);
  }
}

const STOP_WORDS = new Set([
  "và",
  "của",
  "là",
  "có",
  "các",
  "những",
  "không",
  "được",
  "cho",
  "này",
  "đó",
  "về",
  "gì",
  "nào",
  "một",
  "với",
  "khi",
  "thì",
  "ở",
  "để",
  "bị",
  "the",
  "a",
  "an",
  "of",
  "to",
  "in",
  "is",
  "are",
  "was",
  "what",
  "did",
  "do",
  "i",
  "you",
  "we",
  "my",
  "me",
  "it",
  "on",
  "at",
  "for",
  "and",
  "or",
]);

/** Word-overlap scoring key: NFC, lower case, letters and digits, no stop words. */
export function keyTerms(text: string): Set<string> {
  const words = text
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

interface Candidate {
  kind: "query" | "answer";
  run_id: string;
  content: string;
  /** Position in the log: higher is newer. Breaks ties toward recent items. */
  seq: number;
}

export function createSessionMemory(
  opts: CreateSessionMemoryOptions,
): SessionMemoryService {
  const { store, limits } = opts;
  validateLimits(limits);
  const now = opts.now ?? (() => Date.now());
  const ttlMs = limits.sessionTtlS * 1000;
  const windowLimits: WindowLimits = {
    maxTurns: limits.shortTermMaxTurns,
    maxTokens: limits.shortTermMaxTokens,
    historyMaxTokens: limits.historyMaxTokens,
  };

  const owners = new Map<string, string>();
  const entries = new Map<string, Entry>(); // insertion order = recency order
  const counters = { calls: 0, hits: 0, empty: 0 };

  const isExpired = (e: Entry, at: number) => at - e.lastTouchMs >= ttlMs;

  function liveEntry(id: string): Entry | undefined {
    const e = entries.get(id);
    if (e === undefined) return undefined;
    if (isExpired(e, now())) {
      entries.delete(id);
      return undefined;
    }
    return e;
  }

  function touch(id: string, e: Entry): void {
    e.lastTouchMs = now();
    entries.delete(id);
    entries.set(id, e);
  }

  function sweep(): void {
    // Recency order is touch order, so expired entries sit at the front.
    const at = now();
    for (const [id, e] of entries) {
      if (!isExpired(e, at)) break;
      entries.delete(id);
    }
  }

  function insertEntry(id: string): Entry {
    const e: Entry = { state: null, loading: null, lastTouchMs: now() };
    entries.set(id, e);
    while (entries.size > limits.maxSessions) {
      const oldest = entries.keys().next().value as string;
      entries.delete(oldest);
    }
    return e;
  }

  function ownerOf(sessionId: string): string {
    const owner = owners.get(sessionId);
    if (owner === undefined) {
      throw new Error(
        `session ${sessionId} has no bound owner; the runner must call bindOwner before memory access`,
      );
    }
    return owner;
  }

  async function loadFromStore(
    owner: string,
    sessionId: string,
  ): Promise<WindowState> {
    const turns: Turn[] = await store.turns(owner, sessionId);
    const state = createWindowState();
    for (const t of turns) {
      const ex: Exchange = {
        run_id: t.run_id,
        query: t.query,
        answer: t.answer,
      };
      addExchange(state, ex, windowLimits);
    }
    return state;
  }

  async function stateFor(sessionId: string): Promise<WindowState> {
    const owner = ownerOf(sessionId);
    let entry = liveEntry(sessionId);
    if (entry === undefined) entry = insertEntry(sessionId);
    touch(sessionId, entry);
    if (entry.state !== null) return entry.state;
    const pending = (entry.loading ??= loadFromStore(owner, sessionId).then(
      (st) => {
        entry.state ??= st;
        entry.loading = null;
        return entry.state;
      },
      (err: unknown) => {
        entry.loading = null;
        throw err;
      },
    ));
    return pending;
  }

  function candidatesOf(turns: Turn[], excludeRunId: string): Candidate[] {
    const out: Candidate[] = [];
    turns.forEach((t, seq) => {
      if (t.run_id === excludeRunId) return;
      out.push({ kind: "query", run_id: t.run_id, content: t.query, seq });
      if (hasAnswer(t.answer)) {
        out.push({ kind: "answer", run_id: t.run_id, content: t.answer, seq });
      }
    });
    return out;
  }

  function scoreItems(
    candidates: Candidate[],
    key: string,
    limit: number,
  ): Candidate[] {
    if (isFirstKey(key)) {
      return candidates.filter((c) => c.kind === "query").slice(0, limit);
    }
    if (isRecentKey(key)) {
      return candidates
        .filter((c) => c.kind === "query")
        .reverse()
        .slice(0, limit);
    }
    const terms = keyTerms(key);
    const scored: { c: Candidate; score: number }[] = [];
    for (const c of candidates) {
      let score = 0;
      for (const w of keyTerms(c.content)) if (terms.has(w)) score += 1;
      if (score > 0) scored.push({ c, score });
    }
    scored.sort((a, b) => b.score - a.score || b.c.seq - a.c.seq);
    return scored.slice(0, limit).map((s) => s.c);
  }

  return {
    bindOwner(owner, sessionId) {
      if (owner.length === 0 || sessionId.length === 0) {
        throw new RangeError("owner and sessionId must be non-empty");
      }
      const known = owners.get(sessionId);
      if (known !== undefined && known !== owner) {
        throw new Error(`session ${sessionId} is bound to a different owner`);
      }
      owners.set(sessionId, owner);
      const e = liveEntry(sessionId);
      if (e !== undefined) touch(sessionId, e);
    },

    async window(sessionId) {
      const state = await stateFor(sessionId);
      return {
        messages: windowMessages(state),
        summary: renderSummary(state, windowLimits),
        turns: state.recent.length,
        tokens: recentTokens(state),
        summarized_turns: state.olderTurns,
      };
    },

    recordTurn(sessionId, turn) {
      const e = liveEntry(sessionId);
      if (e === undefined || e.state === null) return false;
      touch(sessionId, e);
      return addExchange(e.state, turn, windowLimits);
    },

    async recall(sessionId, key, opts) {
      const owner = ownerOf(sessionId);
      const limit = opts.limit ?? MAX_RECALL_ITEMS;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECALL_ITEMS) {
        throw new RangeError(
          `recall limit must be an integer 1..${MAX_RECALL_ITEMS}, got ${limit}`,
        );
      }
      const turns = await store.turns(owner, sessionId);
      const others = turns.filter((t) => t.run_id !== opts.excludeRunId);
      counters.calls += 1;
      if (others.length === 0) {
        counters.empty += 1;
        return { items: [], fresh_session: true };
      }
      const picked = scoreItems(
        candidatesOf(turns, opts.excludeRunId),
        key,
        limit,
      );
      if (picked.length > 0) counters.hits += 1;
      else counters.empty += 1;
      return {
        items: picked.map((c) => ({
          kind: c.kind,
          run_id: c.run_id,
          content: c.content,
        })),
        fresh_session: false,
      };
    },

    isActive(sessionId) {
      return liveEntry(sessionId) !== undefined;
    },

    forget(sessionId) {
      return entries.delete(sessionId);
    },

    stats() {
      sweep();
      let turns = 0;
      let tokens = 0;
      for (const e of entries.values()) {
        if (e.state === null) continue;
        turns += e.state.recent.length;
        tokens += recentTokens(e.state);
      }
      return {
        short_term: {
          active_sessions: entries.size,
          turns,
          tokens,
          max_turns: limits.shortTermMaxTurns,
          max_tokens: limits.shortTermMaxTokens,
          max_sessions: limits.maxSessions,
          ttl_s: limits.sessionTtlS,
        },
        recall: { ...counters },
      };
    },
  };
}
