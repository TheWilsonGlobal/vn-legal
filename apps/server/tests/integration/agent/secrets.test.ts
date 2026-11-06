/**
 * No secrets leak (plan AC 32 and AC 40).
 *
 * The repo is scanned with `git grep` for Langfuse and Google key prefixes,
 * excluding `.env`. Only FILE NAMES are printed on a hit (-l), never the
 * matching line, because a hit may be a real key. The patterns are built from
 * fragments in helpers/harness.ts so this test tree does not match itself.
 *
 * Runtime artifacts (RB1 manifests, community_reports.json, agent sessions
 * on disk, the C9 response) are scanned read-only when they exist.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Client,
  GOOGLE_GREP_ERE,
  KEY_GREP_ERE,
  LANGFUSE_GREP_ERE,
  REPO_ROOT,
  deadLlmEnv,
  findKeyShapes,
  makeTempArea,
  startReadyServer,
  stopAll,
  walkFiles,
  type ServerHandle,
} from "./helpers/harness";

const area = makeTempArea("vnl-secrets-");
let server: ServerHandle;

beforeAll(async () => {
  server = await startReadyServer({
    sessionsDir: area.sessionsDir,
    env: await deadLlmEnv(),
  });
}, 180_000);

afterAll(async () => {
  await stopAll();
  area.cleanup();
});

function gitGrepFiles(ere: string): string[] {
  const r = spawnSync(
    "git",
    [
      "grep",
      "-lE",
      "--untracked",
      "--exclude-standard",
      ere,
      "--",
      ".",
      ":(exclude).env",
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (r.status === 1) return []; // no match
  if (r.status !== 0) throw new Error(`git grep failed: ${r.stderr}`);
  return r.stdout.split("\n").filter(Boolean);
}

describe("AC 32: Langfuse keys", () => {
  it("git grep for the Langfuse key prefixes finds nothing in the repo (excluding .env)", () => {
    const hits = gitGrepFiles(LANGFUSE_GREP_ERE);
    expect(
      hits,
      `files containing Langfuse-key-shaped text: ${hits.join(", ")}`,
    ).toEqual([]);
  });

  it("C9 /api/agent/info contains no key value", async () => {
    const info = await new Client(server.base).get("/api/agent/info");
    expect(info.status, info.text).toBe(200);
    expect(findKeyShapes(info.text)).toEqual([]);
    // no JSON field of C9 is named like a secret (a reason string may name a variable)
    expect(info.text).not.toMatch(
      /"(api[_-]?key|[a-z_]*secret[a-z_]*|password)"\s*:/i,
    );
  });
});

describe("AC 40: Google keys", () => {
  it("git grep for the Google key prefixes finds nothing in the repo (excluding .env)", () => {
    const hits = gitGrepFiles(GOOGLE_GREP_ERE);
    expect(
      hits,
      `files containing Google-key-shaped text: ${hits.join(", ")}`,
    ).toEqual([]);
  });

  it("combined AC 32 + AC 40 pattern finds nothing", () => {
    expect(gitGrepFiles(KEY_GREP_ERE)).toEqual([]);
  });

  it("existing runtime artifacts (manifests, community_reports.json, sessions) hold no key-shaped text", () => {
    const candidates: string[] = [];
    const storage = path.join(REPO_ROOT, "storage");
    if (fs.existsSync(storage)) {
      for (const f of fs.readdirSync(storage))
        if (f.endsWith(".manifest.json"))
          candidates.push(path.join(storage, f));
      const sess = path.join(storage, "agent-sessions");
      for (const f of walkFiles(sess)) candidates.push(path.join(sess, f));
    }
    const reports = path.join(REPO_ROOT, "data", "community_reports.json");
    if (fs.existsSync(reports)) candidates.push(reports);
    for (const f of walkFiles(area.sessionsDir))
      candidates.push(path.join(area.sessionsDir, f));
    const bad = candidates.filter(
      (f) => findKeyShapes(fs.readFileSync(f, "utf8")).length > 0,
    );
    expect(bad, `files with key-shaped content: ${bad.join(", ")}`).toEqual([]);
  });

  it("the spawned server's startup log holds no key-shaped text", () => {
    expect(findKeyShapes(server.log())).toEqual([]);
  });
});
