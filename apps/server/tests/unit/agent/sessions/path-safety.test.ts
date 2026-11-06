import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OWNER_A,
  RUN_1,
  makeStore,
  makeTempDir,
  queryRec,
  removeTempDir,
} from "./fixtures";

let root: string;

beforeEach(async () => {
  root = await makeTempDir();
});

afterEach(async () => {
  await removeTempDir(root);
});

const HOSTILE_IDS = [
  "../../package.json",
  "../index",
  "..",
  "x",
  "",
  "ABCDEF01-2345-4789-8BCD-EF0123456789", // valid length, uppercase
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa", // 35 characters
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaaa/../../x", // 37 characters, separators
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaa\\..\\x", // backslash
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\0", // NUL byte
];

describe("session id validation", () => {
  it("rejects hostile ids and never builds a path outside the store directory", async () => {
    const sessions = join(root, "sessions");
    const store = makeStore(sessions);
    await store.load();
    const mine = (await store.create(OWNER_A)).session_id;

    const rootBefore = (await readdir(root)).sort();
    const dirBefore = (await readdir(sessions)).sort();

    for (const id of HOSTILE_IDS) {
      expect(
        await store.get(OWNER_A, id),
        `get ${JSON.stringify(id)}`,
      ).toBeNull();
      expect(
        await store.turns(OWNER_A, id),
        `turns ${JSON.stringify(id)}`,
      ).toEqual([]);
      expect(
        await store.softDelete(OWNER_A, id),
        `softDelete ${JSON.stringify(id)}`,
      ).toBe(false);
      expect(
        await store.records(OWNER_A, { session_id: id, offset: 0, limit: 10 }),
        `records ${JSON.stringify(id)}`,
      ).toEqual({ records: [], total: 0 });
      await expect(
        store.append(id, queryRec(id, RUN_1, 2, "x")),
        `append ${JSON.stringify(id)}`,
      ).rejects.toThrow(/invalid session id/);
    }

    expect(existsSync(join(root, "package.json"))).toBe(false);
    expect((await readdir(root)).sort()).toEqual(rootBefore);
    expect((await readdir(sessions)).sort()).toEqual(dirBefore);

    // The legitimate session is untouched by all of the above.
    expect((await store.get(OWNER_A, mine))?.session_id).toBe(mine);
  });
});
