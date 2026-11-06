import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { GENESIS_HASH, canonicalJson, rowHash } from "./hash";
import {
  SESSION_ID_PATTERN,
  storedRecordSchema,
  summarizeZodError,
  type StoredRecord,
} from "./schema";

/** Path of a session log. The id is checked here as well, so no caller can build a path from raw input. */
export function sessionLogPath(dir: string, sessionId: string): string {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error("invalid session id");
  }
  return join(dir, `${sessionId}.jsonl`);
}

export type UnsealedRecord = Omit<StoredRecord, "prev_hash" | "row_hash">;

/**
 * Chains a record onto `prevHash`. Returns the record and the exact line to
 * append: the canonical JSON of the record including its hashes.
 */
export function sealRecord(
  prevHash: string,
  body: UnsealedRecord,
): { record: StoredRecord; line: string } {
  const withPrev = { ...body, prev_hash: prevHash };
  const hashed = canonicalJson(withPrev);
  const record = {
    ...withPrev,
    row_hash: rowHash(prevHash, hashed),
  } as StoredRecord;
  return { record, line: canonicalJson(record) };
}

/** Appends one line. "wx" creates the file and fails if it exists. Each write is flushed to disk. */
export async function appendLogLine(
  path: string,
  line: string,
  flag: "a" | "wx",
): Promise<void> {
  const fh = await open(path, flag);
  try {
    await fh.writeFile(`${line}\n`, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
}

export async function readLogText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    throw new Error(`cannot read session log ${path}: ${errorText(err)}`);
  }
}

/** Splits log text into terminated lines plus an unterminated final fragment, if any. */
export function splitLog(text: string): {
  lines: string[];
  tornAt: number | null;
} {
  if (text === "") return { lines: [], tornAt: null };
  const parts = text.split("\n");
  const tail = parts.pop() ?? "";
  if (tail === "") return { lines: parts, tornAt: null };
  return { lines: parts, tornAt: parts.length + 1 };
}

/** Exactly one of `record` and `reason` is set. */
interface ParsedLine {
  record: StoredRecord | null;
  reason: string | null;
}

function parseLogLine(line: string): ParsedLine {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (err) {
    return { record: null, reason: `invalid JSON (${errorText(err)})` };
  }
  const parsed = storedRecordSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      record: null,
      reason: `invalid record (${summarizeZodError(parsed.error)})`,
    };
  }
  return { record: parsed.data as StoredRecord, reason: null };
}

/**
 * Strict parse for load and reads. A torn final line, a line that is not a
 * record, or a record of another session throws, naming the file and line.
 */
export function parseLogStrict(
  path: string,
  text: string,
  sessionId: string,
): StoredRecord[] {
  const { lines, tornAt } = splitLog(text);
  if (tornAt !== null) {
    throw new Error(
      `${path}:${tornAt}: torn record: the last line is not newline-terminated (the write was cut short)`,
    );
  }
  if (lines.length === 0)
    throw new Error(`${path}: session log has no records`);
  return lines.map((line, i) => {
    const parsed = parseLogLine(line);
    if (parsed.record === null)
      throw new Error(`${path}:${i + 1}: ${parsed.reason}`);
    if (parsed.record.session_id !== sessionId) {
      throw new Error(
        `${path}:${i + 1}: record belongs to session ${parsed.record.session_id}`,
      );
    }
    return parsed.record;
  });
}

/**
 * Walks the hash chain of one log and reports the first line that fails:
 * unparseable, wrong session or seq, not in canonical form, a broken prev_hash
 * link, or a row_hash that does not match its content.
 */
export function verifyLogText(
  sessionId: string,
  text: string,
): { records: number; firstBad: number | null } {
  const { lines, tornAt } = splitLog(text);
  let prev = GENESIS_HASH;
  let good = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const rec = parseLogLine(lines[i]).record;
    if (rec === null) return { records: good, firstBad: lineNo };
    if (rec.session_id !== sessionId || rec.seq !== lineNo) {
      return { records: good, firstBad: lineNo };
    }
    if (lines[i] !== canonicalJson(rec) || rec.prev_hash !== prev) {
      return { records: good, firstBad: lineNo };
    }
    const { row_hash: stored, ...body } = rec;
    if (rowHash(prev, canonicalJson(body)) !== stored) {
      return { records: good, firstBad: lineNo };
    }
    prev = stored;
    good += 1;
  }
  if (tornAt !== null) return { records: good, firstBad: tornAt };
  return { records: good, firstBad: null };
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
