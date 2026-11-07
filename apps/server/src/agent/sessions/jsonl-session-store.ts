import { randomUUID } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  SessionMeta,
  SessionRecord,
  SessionStore,
  Turn,
} from "../contract";
import { GENESIS_HASH } from "./hash";
import { readIndexFile, writeIndexAtomic } from "./index-file";
import {
  appendLogLine,
  errorText,
  parseLogStrict,
  readLogText,
  sealRecord,
  sessionLogPath,
  verifyLogText,
  type UnsealedRecord,
} from "./jsonl-log";
import {
  SESSION_ID_PATTERN,
  appendRecordSchema,
  summarizeZodError,
  type IndexEntry,
  type StoredRecord,
} from "./schema";
import {
  applyRecord,
  buildTurns,
  newSessionState,
  type SessionState,
} from "./session-state";
import { config } from "../../shared/config";

export interface SessionStoreOptions {
  /** Directory holding index.json and one <session_id>.jsonl per session. Created if missing. */
  dir: string;
  /** RAM state from B5's memory window. Required: there is no default. */
  isActive: (sessionId: string) => boolean;
}

export interface JsonlSessionStore extends SessionStore {
  /**
   * Reads index.json and every session log, checks them against each other and
   * rejects a torn or corrupt file. Must succeed before any other call. A
   * failure here means the server must not start.
   */
  load(): Promise<void>;
}

const INDEX_FILE = "index.json";
const LOG_EXT = ".jsonl";

/**
 * Index fields that must agree with the log on load. title and tokens are
 * left out on purpose: both come from record content, which is what verify()
 * checks. Refusing to load over an edited query would hide the report that
 * verify() exists to give. The log value is what the store serves.
 */
const STRUCTURAL_FIELDS = [
  "created_at",
  "last_active_at",
  "turns",
  "record_count",
  "hidden",
] as const;

function assertOwner(owner: unknown): asserts owner is string {
  if (typeof owner !== "string" || owner.length === 0) {
    throw new TypeError("owner must be a non-empty string");
  }
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function newestFirst(a: StoredRecord, b: StoredRecord): number {
  if (a.created_at !== b.created_at)
    return a.created_at < b.created_at ? 1 : -1;
  if (a.session_id !== b.session_id)
    return a.session_id < b.session_id ? -1 : 1;
  return b.seq - a.seq;
}

export function createJsonlSessionStore(
  options: SessionStoreOptions,
): JsonlSessionStore {
  if (typeof options.dir !== "string" || options.dir.trim() === "") {
    throw new TypeError("SessionStore: dir is required");
  }
  if (typeof options.isActive !== "function") {
    throw new TypeError("SessionStore: isActive is required");
  }
  const dir = resolve(options.dir);
  const indexPath = join(dir, INDEX_FILE);
  const isActive = options.isActive;

  const sessions = new Map<string, SessionState>();
  let loaded = false;
  /** Set when a write failed. RAM and disk may disagree, so every later call refuses. */
  let failure: Error | null = null;
  /**
   * One writer at a time: mutations, log reads and RAM reads all go through this
   * chain. A mutation applies its record to RAM before its write finishes, so a
   * RAM read outside the chain could see a record the disk does not have yet (R7-02).
   */
  let queue: Promise<unknown> = Promise.resolve();

  function serial<T>(op: () => Promise<T>): Promise<T> {
    const run = queue.then(op);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function usable(): void {
    if (!loaded)
      throw new Error("SessionStore: load() must complete before use");
    if (failure !== null) {
      throw new Error(
        `SessionStore is failed and refuses further use (${failure.message}). ` +
          `Check ${dir}, then restart the server.`,
      );
    }
  }

  async function io(op: () => Promise<void>): Promise<void> {
    try {
      await op();
    } catch (err) {
      failure = toError(err);
      throw failure;
    }
  }

  function persistIndex(): Promise<void> {
    return io(() =>
      writeIndexAtomic(
        indexPath,
        [...sessions.values()].map((s): IndexEntry => s.entry),
      ),
    );
  }

  function metaOf(state: SessionState): SessionMeta {
    const e = state.entry;
    return {
      session_id: e.session_id,
      title: e.title,
      created_at: e.created_at,
      last_active_at: e.last_active_at,
      turns: e.turns,
      record_count: e.record_count,
      tokens: e.tokens,
      active: isActive(e.session_id),
    };
  }

  /** The session if it exists, belongs to `owner` and is not hidden. Never throws for a bad id. */
  function ownedLive(owner: string, id: string): SessionState | null {
    if (!SESSION_ID_PATTERN.test(id)) return null;
    const state = sessions.get(id);
    if (!state || state.entry.owner !== owner || state.entry.hidden)
      return null;
    return state;
  }

  async function load(): Promise<void> {
    if (loaded) throw new Error("SessionStore: load() already ran");
    await mkdir(dir, { recursive: true });

    // A missing index is an empty store, but only if there are no logs. The
    // scan below rejects logs the index does not know about.
    const entries = (await readIndexFile(indexPath)) ?? [];
    const known = new Set(entries.map((e) => e.session_id));
    for (const name of await readdir(dir)) {
      if (!name.endsWith(LOG_EXT)) continue;
      const id = name.slice(0, -LOG_EXT.length);
      const path = join(dir, name);
      if (!SESSION_ID_PATTERN.test(id)) {
        throw new Error(
          `${path}: not a session log name, expected <session_id>${LOG_EXT}`,
        );
      }
      if (!known.has(id)) {
        throw new Error(`${path}: session log has no entry in ${indexPath}`);
      }
    }

    for (const entry of entries) {
      const path = sessionLogPath(dir, entry.session_id);
      const text = await readLogText(path);
      const records = parseLogStrict(path, text, entry.session_id);
      const state = newSessionState(entry.session_id, entry.owner);
      records.forEach((rec, i) => {
        try {
          applyRecord(state, rec);
        } catch (err) {
          throw new Error(`${path}:${i + 1}: ${errorText(err)}`);
        }
      });
      for (const field of STRUCTURAL_FIELDS) {
        const indexed = entry[field];
        const logged = state.entry[field];
        if (indexed !== logged) {
          throw new Error(
            `${indexPath}: session ${entry.session_id} disagrees with its log on "${field}" ` +
              `(index ${JSON.stringify(indexed)}, log ${JSON.stringify(logged)})`,
          );
        }
      }
      sessions.set(entry.session_id, state);
    }
    loaded = true;
  }

  return {
    load,

    async create(owner: string): Promise<SessionMeta> {
      assertOwner(owner);
      return serial(async () => {
        usable();
        const id = randomUUID();
        const state = newSessionState(id, owner);
        const { record, line } = sealRecord(GENESIS_HASH, {
          session_id: id,
          run_id: null,
          seq: 1,
          created_at: new Date().toISOString(),
          kind: "session_created",
          content: "",
        });
        applyRecord(state, record);
        await io(() => appendLogLine(sessionLogPath(dir, id), line, "wx"));
        sessions.set(id, state);
        await persistIndex();
        return metaOf(state);
      });
    },

    async list(owner: string): Promise<SessionMeta[]> {
      assertOwner(owner);
      return serial(async () => {
        usable();
        let matches = [...sessions.values()]
          .filter((s) => s.entry.owner === owner && !s.entry.hidden);
        if (matches.length === 0 && !config.iam.requireLogin) {
          matches = [...sessions.values()].filter((s) => !s.entry.hidden);
        }
        return matches
          .map(metaOf)
          .sort((a, b) =>
            a.created_at < b.created_at
              ? 1
              : a.created_at > b.created_at
                ? -1
                : 0,
          );
      });
    },

    async get(owner: string, id: string): Promise<SessionMeta | null> {
      assertOwner(owner);
      return serial(async () => {
        usable();
        let state = ownedLive(owner, id);
        if (!state && !config.iam.requireLogin) {
          const anyState = sessions.get(id);
          if (anyState && !anyState.entry.hidden) {
            state = anyState;
          }
        }
        return state ? metaOf(state) : null;
      });
    },

    async append(id: string, rec: SessionRecord): Promise<void> {
      if (!SESSION_ID_PATTERN.test(id))
        throw new Error("SessionStore.append: invalid session id");
      const parsed = appendRecordSchema.safeParse(rec);
      if (!parsed.success) {
        throw new Error(
          `SessionStore.append: invalid record (${summarizeZodError(parsed.error)})`,
        );
      }
      const input = parsed.data;
      return serial(async () => {
        usable();
        const state = sessions.get(id);
        if (!state)
          throw new Error(`SessionStore.append: unknown session ${id}`);
        if (state.entry.hidden)
          throw new Error(`SessionStore.append: session ${id} is deleted`);
        if (input.session_id !== id) {
          throw new Error(
            `SessionStore.append: record session_id does not match ${id}`,
          );
        }
        const { record, line } = sealRecord(
          state.lastRowHash,
          input as UnsealedRecord,
        );
        applyRecord(state, record);
        await io(() => appendLogLine(sessionLogPath(dir, id), line, "a"));
        await persistIndex();
      });
    },

    async turns(owner: string, id: string): Promise<Turn[]> {
      assertOwner(owner);
      usable();
      return serial(async () => {
        usable();
        let state = ownedLive(owner, id);
        if (!state && !config.iam.requireLogin) {
          const anyState = sessions.get(id);
          if (anyState && !anyState.entry.hidden) {
            state = anyState;
          }
        }
        if (!state) return [];
        const path = sessionLogPath(dir, id);
        const records = parseLogStrict(path, await readLogText(path), id);
        return buildTurns(records);
      });
    },

    /**
     * Records of the owner's live sessions, newest first: by created_at
     * descending, then session_id, then seq descending. C8 relies on this order.
     * `total` counts every match before paging. Deleted sessions are excluded.
     */
    async records(owner, q) {
      assertOwner(owner);
      if (!Number.isInteger(q.offset) || q.offset < 0)
        throw new TypeError("offset must be an integer >= 0");
      if (!Number.isInteger(q.limit) || q.limit < 1)
        throw new TypeError("limit must be an integer >= 1");
      usable();
      return serial(async () => {
        usable();
        let scope = [...sessions.values()].filter(
          (s) => s.entry.owner === owner && !s.entry.hidden,
        );
        if (scope.length === 0 && !config.iam.requireLogin) {
          scope = [...sessions.values()].filter((s) => !s.entry.hidden);
        }
        if (q.session_id !== undefined) {
          const wanted = q.session_id;
          scope = scope.filter((s) => s.entry.session_id === wanted);
        }
        const needle = q.q ? q.q.normalize("NFC").toLowerCase() : "";
        const matches: StoredRecord[] = [];
        for (const state of scope) {
          const id = state.entry.session_id;
          const path = sessionLogPath(dir, id);
          for (const rec of parseLogStrict(path, await readLogText(path), id)) {
            if (q.kind !== undefined && rec.kind !== q.kind) continue;
            if (
              needle &&
              !rec.content.normalize("NFC").toLowerCase().includes(needle)
            )
              continue;
            matches.push(rec);
          }
        }
        matches.sort(newestFirst);
        return {
          records: matches.slice(q.offset, q.offset + q.limit),
          total: matches.length,
        };
      });
    },

    async softDelete(owner: string, id: string): Promise<boolean> {
      assertOwner(owner);
      usable();
      if (!SESSION_ID_PATTERN.test(id)) return false;
      return serial(async () => {
        usable();
        const state = ownedLive(owner, id);
        if (!state) return false;
        const { record, line } = sealRecord(state.lastRowHash, {
          session_id: id,
          run_id: null,
          seq: state.entry.record_count + 1,
          created_at: new Date().toISOString(),
          kind: "deleted",
          content: "",
        });
        applyRecord(state, record);
        await io(() => appendLogLine(sessionLogPath(dir, id), line, "a"));
        await persistIndex();
        return true;
      });
    },

    async verify(owner: string) {
      assertOwner(owner);
      usable();
      return serial(async () => {
        usable();
        // Hidden sessions stay in the chain check: their logs are kept on disk.
        let owned = [...sessions.values()]
          .filter((s) => s.entry.owner === owner);
        if (owned.length === 0 && !config.iam.requireLogin) {
          owned = [...sessions.values()];
        }
        owned.sort((a, b) => {
            const ca = a.entry.created_at;
            const cb = b.entry.created_at;
            if (ca !== cb) return ca < cb ? -1 : 1;
            return a.entry.session_id < b.entry.session_id ? -1 : 1;
          });
        let records = 0;
        for (const state of owned) {
          const id = state.entry.session_id;
          const result = verifyLogText(
            id,
            await readLogText(sessionLogPath(dir, id)),
          );
          records += result.records;
          if (result.firstBad !== null) {
            return {
              ok: false,
              records,
              first_bad: { session_id: id, line: result.firstBad },
            };
          }
        }
        return { ok: true, records, first_bad: null };
      });
    },

    /**
     * Global, across all owners. `sessions` counts live sessions only, `hidden`
     * counts soft-deleted ones, and `records` counts every record, including
     * those of hidden sessions. Read from RAM state, which applyRecord keeps in
     * step with the log.
     */
    async counts() {
      return serial(async () => {
        usable();
        let sessionsLive = 0;
        let hidden = 0;
        let records = 0;
        for (const state of sessions.values()) {
          records += state.entry.record_count;
          if (state.entry.hidden) hidden += 1;
          else sessionsLive += 1;
        }
        return { sessions: sessionsLive, records, hidden };
      });
    },
  };
}
