import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Citation, SessionRecord } from "../../../../src/agent/contract";
import { countTokens } from "../../../../src/agent/memory/tokens";
import { GENESIS_HASH } from "../../../../src/agent/sessions/hash";
import {
  sealRecord,
  type UnsealedRecord,
} from "../../../../src/agent/sessions/jsonl-log";
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

/**
 * Rewrites a session log with `edit` applied to each record, re-chaining every
 * hash so the file stays a valid log. Simulates a log written before the new
 * fields existed.
 */
async function rewriteLog(
  id: string,
  edit: (rec: Record<string, unknown>) => void,
): Promise<void> {
  let prev = GENESIS_HASH;
  const out: string[] = [];
  for (const line of await logLines(dir, id)) {
    const body = JSON.parse(line) as Record<string, unknown>;
    delete body.prev_hash;
    delete body.row_hash;
    edit(body);
    const sealed = sealRecord(prev, body as UnsealedRecord);
    out.push(sealed.line);
    prev = sealed.record.row_hash;
  }
  await writeFile(join(dir, `${id}.jsonl`), `${out.join("\n")}\n`, "utf8");
}

const SECOND_CITATION: Citation = {
  article_id: "art-26",
  article_number: 26,
  clause_id: "khoan-1",
  breadcrumb: ["Bộ luật Dân sự 2015", "Điều 26", "Khoản 1"],
  via: "vector",
  score: 0.91,
};

describe("step records replay as stored", () => {
  it("round-trips index, tool_input, duration_ms and citations through turns()", async () => {
    const store = makeStore(dir);
    await store.load();
    const { session_id: id } = await store.create(OWNER_A);
    await store.append(id, queryRec(id, RUN_1, 2, "câu hỏi"));
    await store.append(
      id,
      stepRec(id, RUN_1, 3, "tra cứu", {
        index: 3,
        tool_input: '{"query":"Điều 25"}',
        duration_ms: 37.5,
        citations: [CITATION, SECOND_CITATION],
      }),
    );
    await store.append(
      id,
      stepRec(id, RUN_1, 4, "suy ngẫm", {
        index: 4,
        tool: null,
        tool_input: null,
        citations: [],
        duration_ms: 0,
      }),
    );
    await store.append(id, answerRec(id, RUN_1, 5, "đáp án"));

    const turns = await store.turns(OWNER_A, id);
    expect(turns).toHaveLength(1);
    expect(turns[0].steps).toEqual([
      {
        index: 3,
        kind: "action",
        content: "tra cứu",
        tool: "lookup",
        tool_input: '{"query":"Điều 25"}',
        ok: true,
        duration_ms: 37.5,
        citations: [CITATION, SECOND_CITATION],
      },
      {
        index: 4,
        kind: "action",
        content: "suy ngẫm",
        tool: null,
        tool_input: null,
        ok: true,
        duration_ms: 0,
        citations: [],
      },
    ]);

    const reopened = makeStore(dir);
    await reopened.load();
    expect(await reopened.turns(OWNER_A, id)).toEqual(turns);
  });

  it.each(["index", "tool", "tool_input", "ok", "duration_ms", "citations"])(
    "refuses a step with no %s, and leaves the log unchanged",
    async (field) => {
      const store = makeStore(dir);
      await store.load();
      const { session_id: id } = await store.create(OWNER_A);
      await store.append(id, queryRec(id, RUN_1, 2, "câu hỏi"));
      const before = await logLines(dir, id);
      const rec = stepRec(id, RUN_1, 3, "bước");
      Reflect.deleteProperty(rec, field);
      await expect(store.append(id, rec)).rejects.toThrow(
        new RegExp(`${field}: required for step records`),
      );
      expect(await logLines(dir, id)).toEqual(before);
      expect((await store.get(OWNER_A, id))?.record_count).toBe(2);
    },
  );

  it.each([
    ["index", -1],
    ["index", 1.5],
    ["tool_input", 42],
    ["duration_ms", -3],
    ["duration_ms", Number.POSITIVE_INFINITY],
    ["citations", [{ article_id: "art-25" }]],
    ["citations", [{ ...CITATION, unknown_field: true }]],
  ])(
    "refuses a step whose %s is %j, and leaves the log unchanged",
    async (field, value) => {
      const store = makeStore(dir);
      await store.load();
      const { session_id: id } = await store.create(OWNER_A);
      await store.append(id, queryRec(id, RUN_1, 2, "câu hỏi"));
      const before = await logLines(dir, id);
      await expect(
        store.append(
          id,
          stepRec(id, RUN_1, 3, "bước", {
            [field]: value,
          } as Partial<SessionRecord>),
        ),
      ).rejects.toThrow(/invalid record/);
      expect(await logLines(dir, id)).toEqual(before);
    },
  );

  it("keeps rejecting unknown fields on a step record", async () => {
    const store = makeStore(dir);
    await store.load();
    const { session_id: id } = await store.create(OWNER_A);
    await store.append(id, queryRec(id, RUN_1, 2, "câu hỏi"));
    const before = await logLines(dir, id);
    await expect(
      store.append(
        id,
        stepRec(id, RUN_1, 3, "bước", {
          rank_hint: 1,
        } as Partial<SessionRecord>),
      ),
    ).rejects.toThrow(/Unrecognized key/);
    expect(await logLines(dir, id)).toEqual(before);
  });
});

describe("trace_url and trace_id", () => {
  const LANGFUSE =
    "https://langfuse.example/project/p1/traces/0123456789abcdef";

  it("round-trips a stored trace_url and trace_id on an answer", async () => {
    const store = makeStore(dir);
    await store.load();
    const { session_id: id } = await store.create(OWNER_A);
    await store.append(id, queryRec(id, RUN_1, 2, "câu hỏi"));
    await store.append(
      id,
      answerRec(id, RUN_1, 3, "đáp", {
        trace_id: "0123456789abcdef",
        trace_url: LANGFUSE,
      }),
    );
    expect((await store.turns(OWNER_A, id))[0]).toMatchObject({
      trace_id: "0123456789abcdef",
      trace_url: LANGFUSE,
    });
  });

  it("reports a stored null trace_url as null on an answer", async () => {
    const store = makeStore(dir);
    await store.load();
    const { session_id: id } = await store.create(OWNER_A);
    await store.append(id, queryRec(id, RUN_1, 2, "câu hỏi"));
    await store.append(id, answerRec(id, RUN_1, 3, "đáp"));
    expect((await store.turns(OWNER_A, id))[0].trace_url).toBeNull();
  });

  it("round-trips trace_url on an error record", async () => {
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
      trace_id: "abc",
      trace_url: LANGFUSE,
    });
    expect((await store.turns(OWNER_A, id))[0]).toMatchObject({
      ok: false,
      trace_id: "abc",
      trace_url: LANGFUSE,
    });
  });

  it("reads an error record that omits trace_id and trace_url as null", async () => {
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
    expect((await store.turns(OWNER_A, id))[0]).toMatchObject({
      ok: false,
      trace_id: null,
      trace_url: null,
    });
  });

  it.each(["ok", "trace_id", "trace_url"])(
    "refuses an answer with no %s, and leaves the log unchanged",
    async (field) => {
      const store = makeStore(dir);
      await store.load();
      const { session_id: id } = await store.create(OWNER_A);
      await store.append(id, queryRec(id, RUN_1, 2, "câu hỏi"));
      const before = await logLines(dir, id);
      const rec = answerRec(id, RUN_1, 3, "đáp");
      Reflect.deleteProperty(rec, field);
      await expect(store.append(id, rec)).rejects.toThrow(
        new RegExp(`${field}: required for answer records`),
      );
      expect(await logLines(dir, id)).toEqual(before);
      expect((await store.get(OWNER_A, id))?.turns).toBe(0);
    },
  );
});

describe("legacy records without the new fields", () => {
  it("loads a log whose step has no index, and turns() names the record instead of guessing", async () => {
    const first = makeStore(dir);
    await first.load();
    const id = (await first.create(OWNER_A)).session_id;
    await first.append(id, queryRec(id, RUN_1, 2, "câu"));
    await first.append(id, stepRec(id, RUN_1, 3, "bước"));
    await first.append(id, answerRec(id, RUN_1, 4, "đáp"));
    await rewriteLog(id, (rec) => {
      if (rec.kind === "step") delete rec.index;
    });

    const second = makeStore(dir);
    await second.load();
    await expect(second.turns(OWNER_A, id)).rejects.toThrow(
      /step record seq 3 \(run .*\) has no index/,
    );
  });

  it("turns() refuses an answer stored without trace_url", async () => {
    const first = makeStore(dir);
    await first.load();
    const id = (await first.create(OWNER_A)).session_id;
    await first.append(id, queryRec(id, RUN_1, 2, "câu"));
    await first.append(id, answerRec(id, RUN_1, 3, "đáp"));
    await rewriteLog(id, (rec) => {
      if (rec.kind === "answer") delete rec.trace_url;
    });

    const second = makeStore(dir);
    await second.load();
    await expect(second.turns(OWNER_A, id)).rejects.toThrow(
      /answer record seq 3 \(run .*\) has no trace_url/,
    );
  });
});

describe("SessionMeta.tokens", () => {
  it("equals countTokens over the query plus the answer", async () => {
    const store = makeStore(dir);
    await store.load();
    const { session_id: id } = await store.create(OWNER_A);
    const query = "Điều 25 quy định gì về hợp đồng?";
    const answer = "Điều 25 quy định về giao kết hợp đồng dân sự.";
    await store.append(id, queryRec(id, RUN_1, 2, query));
    await store.append(id, answerRec(id, RUN_1, 3, answer));
    const meta = await store.get(OWNER_A, id);
    expect(meta?.tokens).toBe(countTokens(query) + countTokens(answer));
  });

  it("uses the word count where it exceeds one token per four characters", async () => {
    const store = makeStore(dir);
    await store.load();
    const { session_id: id } = await store.create(OWNER_A);
    const query = Array.from({ length: 100 }, () => "a").join(" ");
    await store.append(id, queryRec(id, RUN_1, 2, query));
    await store.append(id, answerRec(id, RUN_1, 3, "ok"));
    expect((await store.get(OWNER_A, id))?.tokens).toBe(
      countTokens(query) + countTokens("ok"),
    );
    expect(countTokens(query)).toBe(100);
  });

  it("survives a reload unchanged", async () => {
    const store = makeStore(dir);
    await store.load();
    const { session_id: id } = await store.create(OWNER_A);
    await store.append(id, queryRec(id, RUN_1, 2, "câu hỏi dài hơn một chút"));
    await store.append(id, answerRec(id, RUN_1, 3, "đáp án"));
    const before = await store.get(OWNER_A, id);
    const reopened = makeStore(dir);
    await reopened.load();
    expect(await reopened.get(OWNER_A, id)).toEqual(before);
  });
});

describe("counts()", () => {
  it("counts across owners, with hidden sessions in hidden and in records", async () => {
    const store = makeStore(dir);
    await store.load();
    const a1 = (await store.create(OWNER_A)).session_id;
    await store.append(a1, queryRec(a1, RUN_1, 2, "q"));
    await store.append(a1, answerRec(a1, RUN_1, 3, "a"));
    const a2 = (await store.create(OWNER_A)).session_id;
    await store.append(a2, queryRec(a2, RUN_2, 2, "q2"));
    await store.append(a2, answerRec(a2, RUN_2, 3, "a2"));
    expect(await store.softDelete(OWNER_A, a2)).toBe(true);
    const b1 = (await store.create(OWNER_B)).session_id;

    // a1: 3 records. a2: 4 records, hidden. b1: 1 record.
    expect(await store.counts()).toEqual({
      sessions: 2,
      records: 8,
      hidden: 1,
    });
    expect((await store.list(OWNER_B)).map((m) => m.session_id)).toEqual([b1]);

    const reopened = makeStore(dir);
    await reopened.load();
    expect(await reopened.counts()).toEqual({
      sessions: 2,
      records: 8,
      hidden: 1,
    });
  });

  it("is zero for an empty store", async () => {
    const store = makeStore(dir);
    await store.load();
    expect(await store.counts()).toEqual({
      sessions: 0,
      records: 0,
      hidden: 0,
    });
  });
});

describe("records() order", () => {
  it("returns records newest first, and pages keep that order", async () => {
    const store = makeStore(dir);
    await store.load();
    const s1 = (await store.create(OWNER_A)).session_id;
    await store.append(s1, queryRec(s1, RUN_1, 2, "một"));
    await store.append(s1, stepRec(s1, RUN_1, 3, "bước"));
    await store.append(s1, answerRec(s1, RUN_1, 4, "hai"));
    const s2 = (await store.create(OWNER_A)).session_id;
    await store.append(s2, queryRec(s2, RUN_2, 2, "ba"));
    await store.append(s2, answerRec(s2, RUN_2, 3, "bốn"));

    const all = await store.records(OWNER_A, { offset: 0, limit: 100 });
    const times = all.records.map((r) => r.created_at);
    expect(times).toEqual([...times].sort().reverse());
    // "hai" is at(4) and "bốn" is at(3): the newer answer comes first.
    const contents = all.records.map((r) => r.content);
    expect(contents.indexOf("hai")).toBeLessThan(contents.indexOf("bốn"));
    expect(all.records.find((r) => r.content === "hai")?.created_at).toBe(
      at(4),
    );

    const page = await store.records(OWNER_A, { offset: 2, limit: 2 });
    expect(page.records).toEqual(all.records.slice(2, 4));
    expect(page.total).toBe(all.total);
  });
});
