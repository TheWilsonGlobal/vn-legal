/**
 * AC 42: rollback drill (plan 8 item 5).
 *
 * The ORIGINAL old store (storage/congraph_vectors.*) is never opened. The
 * test hashes it before, copies storage/congraph_vectors.* (including the
 * legacy manifest written by RB1) into a temp dir, boots a server on the copy
 * with EXACTLY two changed settings, and hashes the original again.
 * Reading bytes to hash/copy is not opening the store.
 *
 * Offline half: boot, rollback warn, C9 embedding block (dead chat LLM).
 * Live half (VN_LEGAL_LIVE=1): one C2 run returns done with citations.
 * The "only one setting" negatives are in boot-refusals.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Client,
  LIVE,
  Q_ART25,
  REPO_ROOT,
  deadLlmEnv,
  expectNoKeyShapes,
  makeTempArea,
  sha256File,
  startReadyServer,
  stopAll,
} from "./helpers/harness";

const area = makeTempArea("vnl-rollback-");
const storage = path.join(REPO_ROOT, "storage");
const originalNames = () =>
  fs
    .readdirSync(storage)
    .filter((f) => f.startsWith("congraph_vectors.") && !f.includes("gemini"))
    .sort();
let hashesBefore: Record<string, string> = {};
let copyStore = "";

function hashOriginals(names: string[]) {
  const out: Record<string, string> = {};
  for (const n of names) out[n] = sha256File(path.join(storage, n));
  return out;
}

beforeAll(() => {
  const names = originalNames();
  expect(names, "old store storage/congraph_vectors.* must exist").toContain(
    "congraph_vectors.cgraph",
  );
  expect(
    names,
    "RB1's legacy manifest storage/congraph_vectors.cgraph.manifest.json must exist",
  ).toContain("congraph_vectors.cgraph.manifest.json");
  hashesBefore = hashOriginals(names);
  const copyDir = path.join(area.root, "oldstore-copy");
  fs.mkdirSync(copyDir, { recursive: true });
  for (const n of names)
    fs.copyFileSync(path.join(storage, n), path.join(copyDir, n));
  copyStore = path.join(copyDir, "congraph_vectors.cgraph");
});

afterAll(async () => {
  await stopAll();
  area.cleanup();
});

describe("AC 42: rollback drill on a COPY of the old store", () => {
  it("exactly CONGRAPH_VECTOR_DB_PATH=<copy> + EMBEDDING_PROVIDER=transformers starts, logs the rollback warn, C9 shows transformers/384/legacy-transformers-384", async () => {
    const server = await startReadyServer({
      sessionsDir: area.sessionsDir,
      env: {
        ...(await deadLlmEnv()), // chat endpoint only; not an embedding setting
        CONGRAPH_VECTOR_DB_PATH: copyStore,
        EMBEDDING_PROVIDER: "transformers",
      },
    });
    expect(server.log()).toMatch(/\[WARN\][^\n]*rollback[^\n]*transformers/i);
    const info = await new Client(server.base).get("/api/agent/info");
    expect(info.status, info.text).toBe(200);
    expect(info.json.embedding).toMatchObject({
      provider: "transformers",
      dim: 384,
      index_id: "legacy-transformers-384",
    });
    expectNoKeyShapes("C9", info.text);
    await server.stop();
  }, 240_000);

  it.runIf(LIVE)(
    "[live] one C2 run on the rolled-back server returns done with citations",
    async () => {
      const server = await startReadyServer({
        sessionsDir: area.sessionsDir,
        env: {
          CONGRAPH_VECTOR_DB_PATH: copyStore,
          EMBEDDING_PROVIDER: "transformers",
        },
      });
      const run = await new Client(server.base).post(
        "/api/agent/run",
        { query: Q_ART25 },
        170_000,
      );
      expect(run.status, run.text).toBe(200);
      expect(run.json.answer).toBeTruthy();
      expect(run.json.embedding.provider).toBe("transformers");
      const cites = (run.json.steps as any[]).flatMap((s) => s.citations ?? []);
      expect(cites.length).toBeGreaterThan(0);
      await server.stop();
    },
    300_000,
  );

  it("the original old store files have the same SHA-256 as before the drill", () => {
    const after = hashOriginals(Object.keys(hashesBefore));
    expect(after).toEqual(hashesBefore);
    // and no new non-manifest file appeared beside the original store
    expect(originalNames()).toEqual(Object.keys(hashesBefore).sort());
  });
});
