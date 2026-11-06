import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OWNER_A,
  RUN_1,
  answerRec,
  logLines,
  makeStore,
  makeTempDir,
  queryRec,
  readIndex,
  removeTempDir,
  stepRec,
} from "./fixtures";

let dir: string;

beforeEach(async () => {
  dir = await makeTempDir();
});

afterEach(async () => {
  await removeTempDir(dir);
});

/** One session with four records: session_created, query, step, answer. */
async function seedSession(): Promise<string> {
  const store = makeStore(dir);
  await store.load();
  const id = (await store.create(OWNER_A)).session_id;
  await store.append(id, queryRec(id, RUN_1, 2, "alpha question"));
  await store.append(id, stepRec(id, RUN_1, 3, "tra cứu"));
  await store.append(id, answerRec(id, RUN_1, 4, "beta answer"));
  return id;
}

describe("verify (hash chain)", () => {
  it("returns ok:true on clean logs", async () => {
    await seedSession();
    const store = makeStore(dir);
    await store.load();
    expect(await store.verify(OWNER_A)).toEqual({
      ok: true,
      records: 4,
      first_bad: null,
    });
  });

  it("reports the exact line when one byte of a record's content is edited", async () => {
    const id = await seedSession();
    const path = join(dir, `${id}.jsonl`);
    const text = await readFile(path, "utf8");
    // Line 2 is the query. Change one ASCII letter inside its content.
    const edited = text.replace("alpha question", "alphb question");
    expect(edited).not.toBe(text);
    await writeFile(path, edited, "utf8");

    const store = makeStore(dir);
    await store.load();
    expect(await store.verify(OWNER_A)).toEqual({
      ok: false,
      records: 1,
      first_bad: { session_id: id, line: 2 },
    });
  });

  it("reports a later line when only that line is edited", async () => {
    const id = await seedSession();
    const path = join(dir, `${id}.jsonl`);
    const text = await readFile(path, "utf8");
    await writeFile(path, text.replace("beta answer", "beta answes"), "utf8");

    const store = makeStore(dir);
    await store.load();
    expect((await store.verify(OWNER_A)).first_bad).toEqual({
      session_id: id,
      line: 4,
    });
  });

  it("flags a re-serialised line even when its values are unchanged", async () => {
    const id = await seedSession();
    const path = join(dir, `${id}.jsonl`);
    const lines = await logLines(dir, id);
    // Same values, keys in reverse order: the hash still matches, the bytes do not.
    const obj = JSON.parse(lines[1]) as Record<string, unknown>;
    const reversed = JSON.stringify(
      Object.fromEntries(Object.entries(obj).reverse()),
    );
    lines[1] = reversed;
    await writeFile(path, `${lines.join("\n")}\n`, "utf8");

    const store = makeStore(dir);
    await store.load();
    expect((await store.verify(OWNER_A)).first_bad).toEqual({
      session_id: id,
      line: 2,
    });
  });

  it("reports a line torn while the server runs as first_bad, rather than throwing", async () => {
    const id = await seedSession();
    const store = makeStore(dir);
    await store.load();
    await appendFile(join(dir, `${id}.jsonl`), '{"session_id":"', "utf8");
    expect(await store.verify(OWNER_A)).toEqual({
      ok: false,
      records: 4,
      first_bad: { session_id: id, line: 5 },
    });
  });

  it("is scoped to the caller's sessions", async () => {
    const id = await seedSession();
    await writeFile(
      join(dir, `${id}.jsonl`),
      (await readFile(join(dir, `${id}.jsonl`), "utf8")).replace(
        "alpha question",
        "alphb question",
      ),
      "utf8",
    );
    const store = makeStore(dir);
    await store.load();
    expect((await store.verify("someone-else")).ok).toBe(true);
    expect((await store.verify(OWNER_A)).ok).toBe(false);
  });
});

describe("load() fails loudly", () => {
  it("throws naming the file and line for a torn last line", async () => {
    const id = await seedSession();
    const path = join(dir, `${id}.jsonl`);
    await appendFile(path, '{"session_id":"aaaa', "utf8");
    const store = makeStore(dir);
    await expect(store.load()).rejects.toThrow(`${path}:5: torn record`);
  });

  it("throws naming the file and line for a newline-terminated line that is not JSON", async () => {
    const id = await seedSession();
    const path = join(dir, `${id}.jsonl`);
    await appendFile(path, "{not json}\n", "utf8");
    const store = makeStore(dir);
    await expect(store.load()).rejects.toThrow(`${path}:5: invalid JSON`);
  });

  it("throws naming index.json when it is corrupt, and does not read the logs", async () => {
    await seedSession();
    await writeFile(
      join(dir, "index.json"),
      '{ "version": 1, "sessions": [',
      "utf8",
    );
    const store = makeStore(dir);
    await expect(store.load()).rejects.toThrow(
      /session index is corrupt: .*index\.json/,
    );
  });

  it("throws naming index.json when it is valid JSON of the wrong shape", async () => {
    await seedSession();
    await writeFile(
      join(dir, "index.json"),
      JSON.stringify({ version: 2, sessions: [] }),
      "utf8",
    );
    const store = makeStore(dir);
    await expect(store.load()).rejects.toThrow(
      /session index is corrupt: .*index\.json/,
    );
  });

  it("throws when index counts disagree with the log", async () => {
    const id = await seedSession();
    const idx = await readIndex(dir);
    idx.sessions[0].record_count = 3;
    await writeFile(join(dir, "index.json"), JSON.stringify(idx), "utf8");
    const store = makeStore(dir);
    await expect(store.load()).rejects.toThrow(
      new RegExp(
        `index\\.json: session ${id} disagrees with its log on "record_count"`,
      ),
    );
  });

  it("throws when a log exists that the index does not list", async () => {
    const id = await seedSession();
    await writeFile(
      join(dir, "index.json"),
      JSON.stringify({ version: 1, sessions: [] }),
      "utf8",
    );
    const store = makeStore(dir);
    await expect(store.load()).rejects.toThrow(
      new RegExp(`${id}\\.jsonl: session log has no entry`),
    );
  });

  it("throws when the index lists a session whose log is missing", async () => {
    const id = await seedSession();
    await rm(join(dir, `${id}.jsonl`));
    const store = makeStore(dir);
    await expect(store.load()).rejects.toThrow(/cannot read session log/);
  });

  it("throws when a record's prev_hash does not link to its predecessor", async () => {
    const id = await seedSession();
    const path = join(dir, `${id}.jsonl`);
    const lines = await logLines(dir, id);
    const rec = JSON.parse(lines[2]);
    rec.prev_hash = "f".repeat(64);
    lines[2] = JSON.stringify(rec);
    await writeFile(path, `${lines.join("\n")}\n`, "utf8");
    const store = makeStore(dir);
    await expect(store.load()).rejects.toThrow(
      `${path}:3: prev_hash does not link`,
    );
  });
});
