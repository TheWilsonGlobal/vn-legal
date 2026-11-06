import type { OpenMode } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OWNER_A,
  RUN_1,
  logLines,
  makeStore,
  makeTempDir,
  queryRec,
  removeTempDir,
} from "./fixtures";

// Holds a log append after it has started, so a test can read the store while
// the write is in flight. Only `open(<log>, "a")` is affected; everything else
// is the real fs/promises.
interface Gate {
  entered: Promise<void>;
  markEntered: () => void;
  proceed: Promise<void>;
  release: () => void;
  /** When set, the held write fails with this error after release. */
  error: Error | null;
}

const control = vi.hoisted(() => ({ gate: null as Gate | null }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (path: string, flags?: OpenMode) => {
      const gate = control.gate;
      if (gate !== null && flags === "a" && path.endsWith(".jsonl")) {
        gate.markEntered();
        await gate.proceed;
        if (gate.error !== null) throw gate.error;
      }
      return actual.open(path, flags);
    },
  };
});

function armGate(error: Error | null): Gate {
  let markEntered: () => void = () => undefined;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  let release: () => void = () => undefined;
  const proceed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const gate: Gate = { entered, markEntered, proceed, release, error };
  control.gate = gate;
  return gate;
}

let dir: string;

beforeEach(async () => {
  dir = await makeTempDir();
  control.gate = null;
});

afterEach(async () => {
  control.gate = null;
  await removeTempDir(dir);
});

async function storeWithSession() {
  const store = makeStore(dir);
  await store.load();
  const id = (await store.create(OWNER_A)).session_id;
  return { store, id };
}

describe("RAM follows the disk for reads during a write (R7-02)", () => {
  it("a read issued while an append is in flight waits for it and does not see the record early", async () => {
    const { store, id } = await storeWithSession();
    const gate = armGate(null);

    const write = store.append(id, queryRec(id, RUN_1, 2, "câu hỏi đang ghi"));
    await gate.entered;

    let settled = false;
    const read = store.get(OWNER_A, id).then((meta) => {
      settled = true;
      return meta;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    gate.release();
    await write;
    expect((await read)?.record_count).toBe(2);
  });

  it("a read issued during an append that then fails is refused, not answered with the unwritten record", async () => {
    const { store, id } = await storeWithSession();
    const linesBefore = (await logLines(dir, id)).length;
    const gate = armGate(
      Object.assign(new Error("EIO: write failed"), { code: "EIO" }),
    );

    const write = store.append(id, queryRec(id, RUN_1, 2, "không ghi được"));
    await gate.entered;
    const readOutcome = store.counts().then(
      (counts) => `resolved ${JSON.stringify(counts)}`,
      (err: Error) => err.message,
    );
    gate.release();

    await expect(write).rejects.toThrow(/EIO: write failed/);
    expect(await readOutcome).toMatch(/failed and refuses further use/);
    await expect(store.list(OWNER_A)).rejects.toThrow(
      /failed and refuses further use/,
    );
    expect(await logLines(dir, id)).toHaveLength(linesBefore);
  });
});
