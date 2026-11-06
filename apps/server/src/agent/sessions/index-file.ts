import { open, readFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { errorText } from "./jsonl-log";
import { indexFileSchema, summarizeZodError, type IndexEntry } from "./schema";

/**
 * Reads index.json. Returns null only when the file does not exist; a file
 * that exists but cannot be read or parsed throws, naming the file.
 */
export async function readIndexFile(
  indexPath: string,
): Promise<IndexEntry[] | null> {
  let text: string;
  try {
    text = await readFile(indexPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(
      `cannot read session index ${indexPath}: ${errorText(err)}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `session index is corrupt: ${indexPath} is not valid JSON (${errorText(err)})`,
    );
  }
  const parsed = indexFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `session index is corrupt: ${indexPath} (${summarizeZodError(parsed.error)})`,
    );
  }
  const seen = new Set<string>();
  for (const entry of parsed.data.sessions) {
    if (seen.has(entry.session_id)) {
      throw new Error(
        `session index is corrupt: ${indexPath} lists ${entry.session_id} twice`,
      );
    }
    seen.add(entry.session_id);
  }
  return parsed.data.sessions as IndexEntry[];
}

/**
 * Replaces index.json atomically: the full content goes to a new temp file in
 * the same directory, is flushed, then renamed over the old index. A failed
 * rename throws with the paths and the OS error; there is no RAM-only fallback.
 */
export async function writeIndexAtomic(
  indexPath: string,
  entries: IndexEntry[],
): Promise<void> {
  const sorted = [...entries].sort((a, b) =>
    a.session_id < b.session_id ? -1 : a.session_id > b.session_id ? 1 : 0,
  );
  const body = `${JSON.stringify({ version: 1, sessions: sorted }, null, 2)}\n`;
  const tmp = `${indexPath}.${randomUUID()}.tmp`;

  const fh = await open(tmp, "wx");
  try {
    await fh.writeFile(body, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }

  try {
    await rename(tmp, indexPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "unknown";
    throw new Error(
      `cannot replace session index ${indexPath}: rename from ${tmp} failed (code ${code}: ${errorText(err)}). ` +
        `The temp file is left in place for inspection; the index was not updated.`,
    );
  }
}
