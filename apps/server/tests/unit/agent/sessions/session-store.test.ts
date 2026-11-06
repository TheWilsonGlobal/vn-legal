import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonlSessionStore } from "../../../../src/agent/sessions";
import {
  CITATION,
  OWNER_A,
  OWNER_B,
  RUN_1,
  RUN_2,
  answerRec,
  at,
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

describe("create, append, read back", () => {
  it("writes records, updates meta, and keeps index.json valid after every write", async () => {
    const store = makeStore(dir);
    await store.load();

    const created = await store.create(OWNER_A);
    const id = created.session_id;
    expect(created.record_count).toBe(1);
    expect(created.turns).toBe(0);
    expect(created.title).toBe("");
    expect((await readIndex(dir)).sessions).toHaveLength(1);

    await store.append(
      id,
      queryRec(id, RUN_1, 2, "Điều 25 quy định gì về hợp đồng?"),
    );
    let idx = await readIndex(dir);
    expect(idx.sessions[0]).toMatchObject({
      session_id: id,
      record_count: 2,
      turns: 0,
    });

    await store.append(id, stepRec(id, RUN_1, 3, "tra cứu Điều 25"));
    idx = await readIndex(dir);
    expect(idx.sessions[0]).toMatchObject({ record_count: 3, turns: 0 });

    await store.append(id, answerRec(id, RUN_1, 4, "Điều 25 quy định ..."));
    idx = await readIndex(dir);
    expect(idx.sessions[0]).toMatchObject({
      record_count: 4,
      turns: 1,
      title: "Điều 25 quy định gì về hợp đồng?",
      hidden: false,
      owner: OWNER_A,
    });
    expect(idx.sessions[0].last_active_at).toBe(at(4));

    const listed = await store.list(OWNER_A);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      session_id: id,
      turns: 1,
      record_count: 4,
    });

    const got = await store.get(OWNER_A, id);
    expect(got?.last_active_at).toBe(at(4));

    const turns = await store.turns(OWNER_A, id);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      run_id: RUN_1,
      query: "Điều 25 quy định gì về hợp đồng?",
      answer: "Điều 25 quy định ...",
      ok: true,
      created_at: at(2),
      trace_url: null,
    });
    expect(turns[0].steps).toEqual([
      {
        index: 0,
        kind: "action",
        content: "tra cứu Điều 25",
        tool: "lookup",
        tool_input: '{"article":25}',
        ok: true,
        duration_ms: 12,
        citations: [CITATION],
      },
    ]);
  });

  it("does not count a query with no answer or error as a turn", async () => {
    const store = makeStore(dir);
    await store.load();
    const { session_id: id } = await store.create(OWNER_A);
    await store.append(id, queryRec(id, RUN_1, 2, "câu hỏi chưa xong"));
    expect((await store.get(OWNER_A, id))?.turns).toBe(0);
    expect(await store.turns(OWNER_A, id)).toEqual([]);
    expect((await store.get(OWNER_A, id))?.record_count).toBe(2);
  });

  it("reports a failed run as an error turn with ok:false", async () => {
    const store = makeStore(dir);
    await store.load();
    const { session_id: id } = await store.create(OWNER_A);
    await store.append(id, queryRec(id, RUN_1, 2, "câu hỏi"));
    await store.append(id, {
      session_id: id,
      run_id: RUN_1,
      seq: 3,
      created_at: at(3),
      kind: "error",
      content: "llm_unreachable",
    });
    const turns = await store.turns(OWNER_A, id);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ ok: false, answer: "" });
    expect((await store.get(OWNER_A, id))?.turns).toBe(1);
  });

  it("titles from the first query, truncated to 80 code points", async () => {
    const store = makeStore(dir);
    await store.load();
    const { session_id: id } = await store.create(OWNER_A);
    const long = `${"  câu   hỏi ".repeat(20)}`;
    await store.append(id, queryRec(id, RUN_1, 2, long));
    const title = (await store.get(OWNER_A, id))?.title ?? "";
    expect(Array.from(title)).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
    expect(title.includes("  ")).toBe(false);
  });

  it("reports active from the injected isActive callback", async () => {
    const active = new Set<string>();
    const store = makeStore(dir, active);
    await store.load();
    const { session_id: id } = await store.create(OWNER_A);
    expect((await store.get(OWNER_A, id))?.active).toBe(false);
    active.add(id);
    expect((await store.get(OWNER_A, id))?.active).toBe(true);
  });

  it("refuses an append whose seq is not the next one", async () => {
    const store = makeStore(dir);
    await store.load();
    const { session_id: id } = await store.create(OWNER_A);
    const before = await logLines(dir, id);
    await expect(
      store.append(id, queryRec(id, RUN_1, 5, "sai seq")),
    ).rejects.toThrow(/seq 5 where 2 was expected/);
    expect(await logLines(dir, id)).toEqual(before);
  });

  it("refuses a step with no open query, and leaves the log unchanged", async () => {
    const store = makeStore(dir);
    await store.load();
    const { session_id: id } = await store.create(OWNER_A);
    const before = await logLines(dir, id);
    await expect(
      store.append(id, stepRec(id, RUN_1, 2, "mồ côi")),
    ).rejects.toThrow(/no open query/);
    expect(await logLines(dir, id)).toEqual(before);
    expect((await store.get(OWNER_A, id))?.record_count).toBe(1);
  });

  it("refuses to append to an unknown session", async () => {
    const store = makeStore(dir);
    await store.load();
    await expect(
      store.append(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        queryRec("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", RUN_1, 1, "x"),
      ),
    ).rejects.toThrow(/unknown session/);
  });

  it("serialises concurrent appends so the chain and counts stay exact", async () => {
    const store = makeStore(dir);
    await store.load();
    const { session_id: id } = await store.create(OWNER_A);
    const writes: Promise<void>[] = [];
    let seq = 2;
    for (let run = 0; run < 10; run++) {
      const runId = `00000000-0000-4000-8000-00000000000${run}`;
      writes.push(store.append(id, queryRec(id, runId, seq++, `q${run}`)));
      writes.push(store.append(id, answerRec(id, runId, seq++, `a${run}`)));
    }
    await Promise.all(writes);
    const meta = await store.get(OWNER_A, id);
    expect(meta?.record_count).toBe(21);
    expect(meta?.turns).toBe(10);
    expect((await logLines(dir, id)).length).toBe(21);
    expect((await store.verify(OWNER_A)).ok).toBe(true);
  });
});

describe("foreign owner and hidden sessions", () => {
  it("returns empty or null to a foreign owner without revealing existence", async () => {
    const store = makeStore(dir);
    await store.load();
    const { session_id: id } = await store.create(OWNER_A);
    await store.append(id, queryRec(id, RUN_1, 2, "bí mật"));
    await store.append(id, answerRec(id, RUN_1, 3, "trả lời"));

    expect(await store.get(OWNER_B, id)).toBeNull();
    expect(await store.list(OWNER_B)).toEqual([]);
    expect(await store.turns(OWNER_B, id)).toEqual([]);
    const foreign = await store.records(OWNER_B, {
      session_id: id,
      offset: 0,
      limit: 50,
    });
    expect(foreign).toEqual({ records: [], total: 0 });
    const all = await store.records(OWNER_B, { offset: 0, limit: 50 });
    expect(all.total).toBe(0);
    expect(await store.softDelete(OWNER_B, id)).toBe(false);

    // The owner still sees it: the foreign attempts changed nothing.
    expect((await store.get(OWNER_A, id))?.turns).toBe(1);
    expect((await store.list(OWNER_A)).map((m) => m.session_id)).toEqual([id]);
  });

  it("softDelete appends a deleted record, keeps the file, and hides the session", async () => {
    const store = makeStore(dir);
    await store.load();
    const { session_id: id } = await store.create(OWNER_A);
    await store.append(id, queryRec(id, RUN_1, 2, "trước khi xoá"));
    await store.append(id, answerRec(id, RUN_1, 3, "ok"));

    expect(await store.softDelete(OWNER_A, id)).toBe(true);

    const lines = await logLines(dir, id);
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[lines.length - 1]).kind).toBe("deleted");
    expect((await readIndex(dir)).sessions[0]).toMatchObject({ hidden: true });

    expect(await store.get(OWNER_A, id)).toBeNull();
    expect(await store.list(OWNER_A)).toEqual([]);
    expect(await store.turns(OWNER_A, id)).toEqual([]);
    expect(
      await store.records(OWNER_A, { session_id: id, offset: 0, limit: 10 }),
    ).toEqual({
      records: [],
      total: 0,
    });
    expect(await store.softDelete(OWNER_A, id)).toBe(false);
    await expect(
      store.append(id, queryRec(id, RUN_2, 5, "sau khi xoá")),
    ).rejects.toThrow(/deleted/);
  });
});

describe("records() filters and paging", () => {
  it("filters by session, kind and text, and pages with a correct total", async () => {
    const store = makeStore(dir);
    await store.load();
    const s1 = (await store.create(OWNER_A)).session_id;
    await store.append(s1, queryRec(s1, RUN_1, 2, "Alpha question"));
    await store.append(s1, stepRec(s1, RUN_1, 3, "tìm kiếm"));
    await store.append(s1, answerRec(s1, RUN_1, 4, "Beta answer"));
    const s2 = (await store.create(OWNER_A)).session_id;
    await store.append(s2, queryRec(s2, RUN_2, 2, "alpha second"));
    await store.append(s2, answerRec(s2, RUN_2, 3, "gamma"));

    const everything = await store.records(OWNER_A, { offset: 0, limit: 100 });
    expect(everything.total).toBe(7);
    expect(everything.records).toHaveLength(7);

    const onlyS1 = await store.records(OWNER_A, {
      session_id: s1,
      offset: 0,
      limit: 100,
    });
    expect(onlyS1.total).toBe(4);
    expect(onlyS1.records.every((r) => r.session_id === s1)).toBe(true);

    const queries = await store.records(OWNER_A, {
      kind: "query",
      offset: 0,
      limit: 100,
    });
    expect(queries.total).toBe(2);
    expect(queries.records.every((r) => r.kind === "query")).toBe(true);

    const alpha = await store.records(OWNER_A, {
      q: "ALPHA",
      offset: 0,
      limit: 100,
    });
    expect(alpha.total).toBe(2);

    const beta = await store.records(OWNER_A, {
      q: "beta",
      offset: 0,
      limit: 100,
    });
    expect(beta.total).toBe(1);
    expect(beta.records[0].kind).toBe("answer");

    const page1 = await store.records(OWNER_A, { offset: 0, limit: 3 });
    const page3 = await store.records(OWNER_A, { offset: 6, limit: 3 });
    expect(page1.total).toBe(7);
    expect(page1.records).toHaveLength(3);
    expect(page3.total).toBe(7);
    expect(page3.records).toHaveLength(1);
    expect(page1.records[0].created_at >= page1.records[2].created_at).toBe(
      true,
    );

    await store.softDelete(OWNER_A, s2);
    const afterDelete = await store.records(OWNER_A, { offset: 0, limit: 100 });
    expect(afterDelete.total).toBe(4);
    expect(afterDelete.records.every((r) => r.session_id === s1)).toBe(true);
  });

  it("rejects a bad paging window with a TypeError", async () => {
    const store = makeStore(dir);
    await store.load();
    await expect(
      store.records(OWNER_A, { offset: -1, limit: 10 }),
    ).rejects.toThrow(TypeError);
    await expect(
      store.records(OWNER_A, { offset: 0, limit: 0 }),
    ).rejects.toThrow(TypeError);
  });
});

describe("persistence across instances", () => {
  it("a fresh store loaded from disk returns the same list, turns and verify result", async () => {
    const first = makeStore(dir);
    await first.load();
    const id = (await first.create(OWNER_A)).session_id;
    await first.append(id, queryRec(id, RUN_1, 2, "câu một"));
    await first.append(id, stepRec(id, RUN_1, 3, "bước"));
    await first.append(id, answerRec(id, RUN_1, 4, "đáp một"));
    const other = (await first.create(OWNER_A)).session_id;
    await first.append(other, queryRec(other, RUN_2, 2, "câu hai"));
    await first.append(other, answerRec(other, RUN_2, 3, "đáp hai"));
    await first.softDelete(OWNER_A, other);

    const second = makeStore(dir);
    await second.load();
    expect(await second.list(OWNER_A)).toEqual(await first.list(OWNER_A));
    expect(await second.turns(OWNER_A, id)).toEqual(
      await first.turns(OWNER_A, id),
    );
    expect(await second.get(OWNER_A, other)).toBeNull();
    expect(await second.records(OWNER_A, { offset: 0, limit: 100 })).toEqual(
      await first.records(OWNER_A, { offset: 0, limit: 100 }),
    );
    expect(await second.verify(OWNER_A)).toEqual(await first.verify(OWNER_A));
  });
});

describe("construction", () => {
  it("requires isActive and dir", () => {
    expect(() =>
      createJsonlSessionStore({
        dir,
        isActive: undefined as unknown as (id: string) => boolean,
      }),
    ).toThrow(/isActive is required/);
    expect(() =>
      createJsonlSessionStore({ dir: "", isActive: () => false }),
    ).toThrow(/dir is required/);
  });

  it("refuses every call before load()", async () => {
    const store = makeStore(dir);
    await expect(store.list(OWNER_A)).rejects.toThrow(/load\(\) must complete/);
    await expect(store.create(OWNER_A)).rejects.toThrow(
      /load\(\) must complete/,
    );
  });

  it("creates the directory and an empty index on first use", async () => {
    const nested = join(dir, "not-yet", "here");
    const store = makeStore(nested);
    await store.load();
    expect(await store.list(OWNER_A)).toEqual([]);
    await store.create(OWNER_A);
    const files = await readdir(nested);
    expect(files.filter((f) => f.endsWith(".jsonl"))).toHaveLength(1);
    expect(files).toContain("index.json");
    expect(await readFile(join(nested, "index.json"), "utf8")).toContain(
      '"version": 1',
    );
  });
});
