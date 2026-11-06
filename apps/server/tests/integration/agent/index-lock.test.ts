/**
 * Index lock and index match on a server booted against the RB1 index.
 * AC 41 (409 index_locked_by_manifest on both admin routes),
 * AC 39 (positive half: C9 embedding block equals the RB1 manifest).
 *
 * SAFETY. The 409 probes call destructive admin routes (the legacy builder
 * clears the store it is pointed at). Until the lock exists they would
 * actually run. So the AC 41 server is booted on a TEMP COPY of the RB1 index
 * (never the original), with a fake embedding key so a job that wrongly
 * starts cannot spend real quota. The add-index probe is sent only after the
 * rebuild probe has proven the lock exists, and carries an empty `content`
 * array so it could not add rows even if the guard were missing; any file it
 * wrote under data/ is removed.
 *
 * Why the upload probe cannot use an isolated graph: the server takes the graph
 * store path from `config.graphDbPath` = <cwd>/storage/graph.cgraph with no env
 * override (apps/server/src/shared/config.ts:80), and the data file from
 * <cwd>/data. Only the vector store path (CONGRAPH_VECTOR_DB_PATH) is
 * overridable, and that one IS the temp copy. With `content: []` the route
 * writes an empty JSON array and addGraph/addIndex have nothing to insert, so
 * even a missing guard leaves the real graph store without new nodes; the
 * residual effect, an empty data/lock-probe.json, is asserted absent and
 * removed in afterAll.
 *
 * The AC 39 positive check uses a separate server on the real path and makes
 * no destructive call. The chat LLM is a dead port with a fake key in both.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Client,
  REPO_ROOT,
  deadLlmEnv,
  expectNoKeyShapes,
  makeTempArea,
  sleep,
  startReadyServer,
  stopAll,
  type ServerHandle,
} from "./helpers/harness";

const area = makeTempArea("vnl-lock-");
const GEMINI_STEM = "congraph_vectors_gemini-embedding-2_768";
const probeFile = path.join(REPO_ROOT, "data", "lock-probe.json");

afterAll(async () => {
  await stopAll();
  area.cleanup();
  fs.rmSync(probeFile, { force: true });
});

describe("AC 41: a store with a manifest is locked against the legacy builder", () => {
  let server: ServerHandle;
  let c: Client;
  let lockProven = false;

  beforeAll(async () => {
    const storage = path.join(REPO_ROOT, "storage");
    const copyDir = path.join(area.root, "gemini-index-copy");
    fs.mkdirSync(copyDir, { recursive: true });
    const files = fs
      .readdirSync(storage)
      .filter((f) => f.startsWith(GEMINI_STEM));
    expect(
      files,
      `RB1 index storage/${GEMINI_STEM}.* (with its manifest) must exist`,
    ).toContain(`${GEMINI_STEM}.cgraph.manifest.json`);
    for (const f of files)
      fs.copyFileSync(path.join(storage, f), path.join(copyDir, f));
    server = await startReadyServer({
      sessionsDir: area.sessionsDir,
      env: {
        ...(await deadLlmEnv()),
        CONGRAPH_VECTOR_DB_PATH: path.join(copyDir, `${GEMINI_STEM}.cgraph`),
        GEMINI_EMBEDDING_API_KEY: "fake-embedding-key-not-a-secret",
      },
    });
    c = new Client(server.base);
  }, 240_000);

  it("POST /api/admin/rebuild-vector -> 409 index_locked_by_manifest with the path, and no job starts", async () => {
    const logBefore = server.log().length;
    const r = await c.post("/api/admin/rebuild-vector");
    expect(r.status, r.text).toBe(409);
    lockProven = true;
    expect(r.json.error).toBe("index_locked_by_manifest");
    expect(typeof r.json.path).toBe("string");
    expect(r.json.path.length).toBeGreaterThan(0);
    await sleep(3000);
    const added = server.log().slice(logBefore);
    expect(added).not.toMatch(/re-?index(ing)? (started|completed|complete)/i);
    expect(added).not.toMatch(/clearAll|cleared/i);
    // Strict: NO [ERROR] line may appear after the request. The only request in
    // this window is the rebuild-vector POST; the ERROR emitters reachable from
    // it are system.routes.ts:50 and :91 (a rebuild that started and failed),
    // which must not run. The dead-LLM probe errors (agent.ts:716,
    // health.ts:65/:121) fire only on /api/agent/info or /health requests,
    // which this test never sends, and the server has no timers, so there is
    // no expected unrelated ERROR line to exclude.
    expect(added).not.toMatch(/\[ERROR\]/);
  });

  it("the add-index admin route (POST /api/admin/knowledge/upload) -> 409 index_locked_by_manifest and writes nothing", async () => {
    expect(
      lockProven,
      "refusing to probe the upload route: the rebuild-vector lock was not proven (the route mutates the graph and vector stores)",
    ).toBe(true);
    const res = await fetch(`${server.base}/api/admin/knowledge/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "lock-probe.json", content: [] }),
    });
    const text = await res.text();
    expect(res.status, text).toBe(409);
    expect(JSON.parse(text).error).toBe("index_locked_by_manifest");
    expect(
      fs.existsSync(probeFile),
      "a refused upload must not write data/",
    ).toBe(false);
  });
});

describe("AC 39 (positive half): C9 embedding block matches the RB1 manifest", () => {
  it("embedding {provider:gemini, model:gemini-embedding-2, dim:768, index_id} equals the manifest next to CONGRAPH_VECTOR_DB_PATH", async () => {
    const server = await startReadyServer({
      sessionsDir: area.sessionsDir,
      env: await deadLlmEnv(),
    });
    const c = new Client(server.base);
    const info = await c.get("/api/agent/info");
    expect(info.status, info.text).toBe(200);
    expectNoKeyShapes("C9", info.text);
    expect(info.json.embedding).toMatchObject({
      provider: "gemini",
      model: "gemini-embedding-2",
      dim: 768,
    });
    expect(typeof info.json.embedding.index_id).toBe("string");

    // The default RB1 location; TR1 may override with RB1_MANIFEST_PATH.
    const manifestPath =
      process.env.RB1_MANIFEST_PATH ||
      path.join(REPO_ROOT, "storage", `${GEMINI_STEM}.cgraph.manifest.json`);
    expect(
      fs.existsSync(manifestPath),
      `RB1 manifest not found at ${manifestPath}`,
    ).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(info.json.embedding.index_id).toBe(manifest.index_id);
    expect(manifest.provider).toBe("gemini");
    expect(manifest.model).toBe("gemini-embedding-2");
    expect(manifest.dim).toBe(768);
  }, 240_000);
});
