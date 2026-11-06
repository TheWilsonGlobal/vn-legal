import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OWNER_A, makeStore, makeTempDir, removeTempDir } from "./fixtures";

let dir: string;

beforeEach(async () => {
  dir = await makeTempDir();
});

afterEach(async () => {
  await removeTempDir(dir);
});

describe("load() and stray files in the session directory (R7-04)", () => {
  it("refuses a stray foo.jsonl whose name is not a session id, naming the file", async () => {
    const path = join(dir, "foo.jsonl");
    await writeFile(path, "", "utf8");

    await expect(makeStore(dir).load()).rejects.toThrow(
      `${path}: not a session log name, expected <session_id>.jsonl`,
    );
  });

  it.each([
    // Uppercase hex: the id pattern is lowercase only.
    "ABCDEF01-2345-4678-89AB-CDEF01234567",
    // One character short of 36.
    "11111111-1111-4111-8111-11111111111",
  ])("refuses a log named %s.jsonl, naming the file", async (name) => {
    const path = join(dir, `${name}.jsonl`);
    await writeFile(path, "", "utf8");

    await expect(makeStore(dir).load()).rejects.toThrow(
      `${path}: not a session log name`,
    );
  });

  it("ignores stray files that do not end in .jsonl", async () => {
    await writeFile(join(dir, "notes.txt"), "scratch", "utf8");
    await writeFile(join(dir, "index.json.tmp"), "{", "utf8");

    const store = makeStore(dir);
    await expect(store.load()).resolves.toBeUndefined();
    expect(await store.list(OWNER_A)).toEqual([]);
  });
});
