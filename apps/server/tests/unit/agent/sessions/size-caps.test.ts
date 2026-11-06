import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_CITATIONS_PER_STEP,
  MAX_RECORD_CONTENT_CHARS,
  appendRecordSchema,
} from "../../../../src/agent/sessions/schema";
import {
  CITATION,
  OWNER_A,
  RUN_1,
  logLines,
  makeStore,
  makeTempDir,
  queryRec,
  removeTempDir,
  stepRec,
} from "./fixtures";

const SID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let dir: string;

beforeEach(async () => {
  dir = await makeTempDir();
});

afterEach(async () => {
  await removeTempDir(dir);
});

describe("append size caps (R7-01)", () => {
  it("accepts content of exactly MAX_RECORD_CONTENT_CHARS and refuses one character more", () => {
    const atCap = queryRec(SID, RUN_1, 2, "a".repeat(MAX_RECORD_CONTENT_CHARS));
    expect(appendRecordSchema.safeParse(atCap).success).toBe(true);

    const overCap = queryRec(
      SID,
      RUN_1,
      2,
      "a".repeat(MAX_RECORD_CONTENT_CHARS + 1),
    );
    const result = appendRecordSchema.safeParse(overCap);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual([
      expect.objectContaining({
        path: ["content"],
        message: `must be at most ${MAX_RECORD_CONTENT_CHARS} characters`,
      }),
    ]);
  });

  it("accepts a step with MAX_CITATIONS_PER_STEP citations and refuses one more", () => {
    const base = stepRec(SID, RUN_1, 3, "tra cứu");
    const atCap = {
      ...base,
      citations: Array.from({ length: MAX_CITATIONS_PER_STEP }, () => CITATION),
    };
    expect(appendRecordSchema.safeParse(atCap).success).toBe(true);

    const overCap = {
      ...base,
      citations: Array.from(
        { length: MAX_CITATIONS_PER_STEP + 1 },
        () => CITATION,
      ),
    };
    const result = appendRecordSchema.safeParse(overCap);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual([
      expect.objectContaining({
        path: ["citations"],
        message: `must have at most ${MAX_CITATIONS_PER_STEP} citations`,
      }),
    ]);
  });

  it("the store refuses an oversized record loudly and writes nothing", async () => {
    const store = makeStore(dir);
    await store.load();
    const id = (await store.create(OWNER_A)).session_id;
    const linesBefore = (await logLines(dir, id)).length;

    await expect(
      store.append(
        id,
        queryRec(id, RUN_1, 2, "a".repeat(MAX_RECORD_CONTENT_CHARS + 1)),
      ),
    ).rejects.toThrow(
      `SessionStore.append: invalid record (content: must be at most ${MAX_RECORD_CONTENT_CHARS} characters)`,
    );
    expect(await logLines(dir, id)).toHaveLength(linesBefore);
  });
});
