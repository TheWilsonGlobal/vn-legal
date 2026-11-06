/**
 * Boot refusals (plan 5.3, 5.6, 5.9, 8 item 5).
 * AC 34, 35, 39 (refusal half), 42 (one-setting-only half).
 *
 * Each case spawns the REAL server (NODE_ENV=development) and expects it to
 * exit non-zero by itself with a log that names the variable or path and never
 * contains a key value. "Missing" is the empty string, never a deleted var.
 *
 * Needs a bootable baseline (.env keys + the RB1 index at CONGRAPH_VECTOR_DB_PATH)
 * for the cases where a LATER boot step is the one under test (AC 34, 35),
 * because the manifest check runs before the runner factory (plan 5.6).
 * No Gemini request is made by any case in this file.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  expectBootRefusal,
  expectNoKeyShapes,
  makeTempArea,
  stopAll,
  syntheticGeminiManifest,
  tail,
  writeTemp,
  REPO_ROOT,
} from "./helpers/harness";

const area = makeTempArea("vnl-boot-");

afterAll(async () => {
  await stopAll();
  area.cleanup();
});

async function refuse(env: Record<string, string>) {
  const r = await expectBootRefusal({ sessionsDir: area.sessionsDir, env });
  expect(r.exit.code, `exit code; log tail:\n${tail(r.log)}`).not.toBe(0);
  expect(r.exit.code).not.toBeNull();
  expectNoKeyShapes("boot log", r.log);
  return r.log;
}

/** A temp store path whose only content is a manifest (the check runs first). */
function syntheticStore(name: string, manifestOverrides = {}) {
  const store = path.join(area.root, name, "store.cgraph");
  writeTemp(
    area,
    `${name}/store.cgraph.manifest.json`,
    syntheticGeminiManifest(manifestOverrides),
  );
  return store;
}

/**
 * Copies the old 384-d store plus RB1's legacy manifest into a temp dir and
 * proves the copy really carries the legacy manifest (provider transformers,
 * dim 384) before any boot, so a refusal cannot be a "no manifest" refusal.
 */
function copyOldStore(name: string): string {
  const copyDir = path.join(area.root, name);
  fs.mkdirSync(copyDir, { recursive: true });
  const storage = path.join(REPO_ROOT, "storage");
  const files = fs
    .readdirSync(storage)
    .filter((f) => f.startsWith("congraph_vectors.") && !f.includes("gemini"));
  expect(files, "storage/congraph_vectors.* (old store) must exist").toContain(
    "congraph_vectors.cgraph",
  );
  for (const f of files)
    fs.copyFileSync(path.join(storage, f), path.join(copyDir, f));
  const manifestFile = path.join(
    copyDir,
    "congraph_vectors.cgraph.manifest.json",
  );
  expect(
    fs.existsSync(manifestFile),
    "the store copy must carry RB1's legacy manifest",
  ).toBe(true);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  expect(manifest.provider).toBe("transformers");
  expect(manifest.dim).toBe(384);
  return path.join(copyDir, "congraph_vectors.cgraph");
}

describe("AC 34: provider guard (runner factory)", () => {
  it("LLM_PROVIDER=llama exits non-zero and names LLM_PROVIDER and 'gemini'", async () => {
    const log = await refuse({ LLM_PROVIDER: "llama" });
    // one line must carry both the variable and the required value
    expect(log).toMatch(/LLM_PROVIDER[^\n]*\bgemini\b/i);
  });

  it("LLM_PROVIDER='' exits non-zero and names LLM_PROVIDER and 'gemini'", async () => {
    const log = await refuse({ LLM_PROVIDER: "" });
    // one line must carry both the variable and the required value
    expect(log).toMatch(/LLM_PROVIDER[^\n]*\bgemini\b/i);
  });
});

describe("AC 35: missing keys (empty string, not deleted)", () => {
  it("GEMINI_API_KEY='' exits non-zero naming GEMINI_API_KEY", async () => {
    const log = await refuse({ GEMINI_API_KEY: "" });
    expect(log).toContain("GEMINI_API_KEY");
  });

  it("GEMINI_EMBEDDING_API_KEY='' exits non-zero naming GEMINI_EMBEDDING_API_KEY", async () => {
    const log = await refuse({ GEMINI_EMBEDDING_API_KEY: "" });
    expect(log).toContain("GEMINI_EMBEDDING_API_KEY");
  });
});

describe("AC 39: index / embedder match refusals", () => {
  it("EMBEDDING_PROVIDER='' exits non-zero naming EMBEDDING_PROVIDER", async () => {
    const log = await refuse({ EMBEDDING_PROVIDER: "" });
    expect(log).toContain("EMBEDDING_PROVIDER");
  });

  it("EMBEDDING_PROVIDER=gemini + a COPY of the old 384-d store (legacy manifest) exits non-zero naming path and field", async () => {
    // The original old store is never opened: copy it, plus its legacy manifest.
    const copyStore = copyOldStore("oldcopy");
    const log = await refuse({
      CONGRAPH_VECTOR_DB_PATH: copyStore,
      EMBEDDING_PROVIDER: "gemini",
    });
    expect(log, "log names the store path").toContain(
      "congraph_vectors.cgraph",
    );
    // a manifest field AND its value, on one line: not just the word "manifest"
    // index-manifest.ts:225: `index manifest <path>: field provider is
    // "transformers" but the configured embedder has "gemini"` (path, field,
    // stored and configured value on ONE line).
    expect(log, "log names path, field, stored and configured value").toMatch(
      /index manifest [^\n]*congraph_vectors\.cgraph\.manifest\.json: field provider is "transformers" but the configured embedder has "gemini"/,
    );
  });

  it("a store with no manifest exits non-zero naming the path", async () => {
    const dir = path.join(area.root, "nomanifest");
    fs.mkdirSync(dir, { recursive: true });
    const store = path.join(dir, "bare.cgraph");
    fs.writeFileSync(store, "");
    const log = await refuse({
      CONGRAPH_VECTOR_DB_PATH: store,
      EMBEDDING_PROVIDER: "gemini",
    });
    expect(log).toContain("bare.cgraph");
    expect(log).toMatch(/manifest/i);
  });

  it("EMBEDDING_DIM=384 against a 768-d Gemini manifest exits non-zero naming path and 'dim'", async () => {
    const store = syntheticStore("dim384");
    const log = await refuse({
      CONGRAPH_VECTOR_DB_PATH: store,
      EMBEDDING_PROVIDER: "gemini",
      EMBEDDING_DIM: "384",
    });
    expect(log).toContain("store.cgraph");
    // index-manifest.ts:225 (provider and model match, dim is the first diff)
    expect(log).toMatch(
      /index manifest [^\n]*store\.cgraph\.manifest\.json: field dim is 768 but the configured embedder has 384/,
    );
  });

  it("VECTOR_STORE_TYPE=lancedb with Gemini embeddings exits non-zero naming VECTOR_STORE_TYPE", async () => {
    const store = syntheticStore("lance");
    const log = await refuse({
      CONGRAPH_VECTOR_DB_PATH: store,
      EMBEDDING_PROVIDER: "gemini",
      VECTOR_STORE_TYPE: "lancedb",
    });
    expect(log).toContain("VECTOR_STORE_TYPE");
  });
});

describe("AC 42 (negative half): changing only ONE of the two rollback settings fails", () => {
  it("EMBEDDING_PROVIDER=transformers with a Gemini-manifest store exits non-zero", async () => {
    const store = syntheticStore("only-provider");
    const log = await refuse({
      CONGRAPH_VECTOR_DB_PATH: store,
      EMBEDDING_PROVIDER: "transformers",
    });
    expect(log).toContain("store.cgraph");
    // index-manifest.ts:225: stored "gemini", configured "transformers"
    expect(log).toMatch(
      /index manifest [^\n]*store\.cgraph\.manifest\.json: field provider is "gemini" but the configured embedder has "transformers"/,
    );
  });

  it("only CONGRAPH_VECTOR_DB_PATH changed (old-store COPY, .env keeps EMBEDDING_PROVIDER=gemini) exits non-zero naming the field", async () => {
    const copyStore = copyOldStore("oldcopy2");
    // EMBEDDING_PROVIDER and EMBEDDING_DIM are deliberately NOT set here.
    const log = await refuse({ CONGRAPH_VECTOR_DB_PATH: copyStore });
    expect(log).toContain("congraph_vectors.cgraph");
    // index-manifest.ts:225: `index manifest <path>: field provider is
    // "transformers" but the configured embedder has "gemini"` (path, field,
    // stored and configured value on ONE line).
    expect(log, "log names path, field, stored and configured value").toMatch(
      /index manifest [^\n]*congraph_vectors\.cgraph\.manifest\.json: field provider is "transformers" but the configured embedder has "gemini"/,
    );
  });
});
