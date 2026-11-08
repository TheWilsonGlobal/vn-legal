import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OWNER_A,
  OWNER_B,
  RUN_1,
  makeStore,
  makeTempDir,
  queryRec,
  removeTempDir,
} from "./fixtures";

let dir: string;

beforeEach(async () => {
  dir = await makeTempDir();
});

afterEach(async () => {
  await removeTempDir(dir);
});

describe("admin read across owners (listAll / recordsAll)", () => {
  it("lists live sessions of every owner, each tagged with its owner", async () => {
    const store = makeStore(dir);
    await store.load();
    const a = await store.create(OWNER_A);
    const b = await store.create(OWNER_B);

    const all = await store.listAll();
    expect(all.map((m) => m.session_id).sort()).toEqual(
      [a.session_id, b.session_id].sort(),
    );
    expect(all.find((m) => m.session_id === a.session_id)?.owner).toBe(OWNER_A);
    expect(all.find((m) => m.session_id === b.session_id)?.owner).toBe(OWNER_B);
  });

  it("returns records of all owners with the same filters as records()", async () => {
    const store = makeStore(dir);
    await store.load();
    const a = await store.create(OWNER_A);
    await store.create(OWNER_B);
    await store.append(
      a.session_id,
      queryRec(a.session_id, RUN_1, 2, "Điều 25 quy định gì?"),
    );

    // created (A) + query (A) + created (B)
    const everything = await store.recordsAll({ offset: 0, limit: 50 });
    expect(everything.total).toBe(3);

    const queries = await store.recordsAll({
      kind: "query",
      offset: 0,
      limit: 50,
    });
    expect(queries.total).toBe(1);
    expect(queries.records[0].session_id).toBe(a.session_id);
  });

  it("leaves out soft-deleted sessions from both views", async () => {
    const store = makeStore(dir);
    await store.load();
    const a = await store.create(OWNER_A);
    const b = await store.create(OWNER_B);
    expect(await store.softDelete(OWNER_B, b.session_id)).toBe(true);

    const all = await store.listAll();
    expect(all.map((m) => m.session_id)).toEqual([a.session_id]);

    const page = await store.recordsAll({ offset: 0, limit: 50 });
    expect(page.records.every((r) => r.session_id === a.session_id)).toBe(true);
    expect(page.total).toBe(1);
  });

  it("keeps owner-scoped records() unchanged", async () => {
    const store = makeStore(dir);
    await store.load();
    const a = await store.create(OWNER_A);
    await store.create(OWNER_B);

    const own = await store.records(OWNER_A, { offset: 0, limit: 50 });
    expect(own.total).toBe(1);
    expect(own.records[0].session_id).toBe(a.session_id);
  });

  it("rejects a bad page window", async () => {
    const store = makeStore(dir);
    await store.load();
    await expect(
      store.recordsAll({ offset: -1, limit: 10 }),
    ).rejects.toThrow(TypeError);
    await expect(
      store.recordsAll({ offset: 0, limit: 0 }),
    ).rejects.toThrow(TypeError);
  });
});
