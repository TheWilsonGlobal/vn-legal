import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OWNER_A,
  makeStore,
  makeTempDir,
  readIndex,
  removeTempDir,
} from "./fixtures";

// Simulates the Windows failure mode from assumption A18: an AV or indexer lock
// makes rename() over index.json fail. Only rename is wrapped; everything else
// is the real fs/promises.
const control = vi.hoisted(() => ({ failRename: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      if (control.failRename) {
        throw Object.assign(
          new Error(
            `EPERM: operation not permitted, rename '${from}' -> '${to}'`,
          ),
          {
            code: "EPERM",
          },
        );
      }
      return actual.rename(from, to);
    },
  };
});

let dir: string;

beforeEach(async () => {
  dir = await makeTempDir();
  control.failRename = false;
});

afterEach(async () => {
  control.failRename = false;
  await removeTempDir(dir);
});

describe("atomic index rewrite on a failed rename", () => {
  it("throws with evidence, keeps the old index, and refuses further use (no RAM-only fallback)", async () => {
    const store = makeStore(dir);
    await store.load();
    const first = await store.create(OWNER_A);
    const indexBefore = await readFile(join(dir, "index.json"), "utf8");

    control.failRename = true;
    await expect(store.create(OWNER_A)).rejects.toThrow(
      /cannot replace session index .*index\.json: rename from .*\.tmp failed \(code EPERM/,
    );
    // The on-disk index is still the previous, valid one.
    expect(await readFile(join(dir, "index.json"), "utf8")).toBe(indexBefore);
    expect((await readIndex(dir)).sessions).toHaveLength(1);

    // Even with rename working again, the store does not pretend nothing happened.
    control.failRename = false;
    await expect(store.list(OWNER_A)).rejects.toThrow(
      /failed and refuses further use/,
    );
    await expect(store.create(OWNER_A)).rejects.toThrow(
      /failed and refuses further use/,
    );
    expect(first.session_id).toHaveLength(36);
  });

  it("on restart, a log written before the failed index update is refused, naming the file", async () => {
    const store = makeStore(dir);
    await store.load();
    await store.create(OWNER_A);
    control.failRename = true;
    await expect(store.create(OWNER_A)).rejects.toThrow(
      /cannot replace session index/,
    );
    control.failRename = false;

    const restarted = makeStore(dir);
    await expect(restarted.load()).rejects.toThrow(
      /session log has no entry in .*index\.json/,
    );
  });
});
