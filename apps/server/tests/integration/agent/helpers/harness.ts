/**
 * Shared harness for the agent acceptance tests (plan r5, section 9.5).
 *
 * Everything here drives a REAL server over HTTP. The vitest process never
 * imports server code (setup-unit.ts mocks shared/config inside vitest) and
 * never reads `.env`: the spawned child loads `.env` itself.
 *
 * Rules enforced here:
 *  - children are spawned with NODE_ENV=development (vitest sets "test", which
 *    makes server.ts skip its boot block);
 *  - "missing" variables are passed as the EMPTY STRING, never deleted;
 *  - every child is tracked and killed by stopAll();
 *  - every test gets its own AGENT_SESSIONS_DIR under os.tmpdir().
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** helpers -> agent -> integration -> tests -> server -> apps -> repo root */
export const REPO_ROOT = path.resolve(HERE, "../../../../../..");

/** Live-path tests need real Gemini and the RB1 index. Gate: VN_LEGAL_LIVE=1. */
export const LIVE = process.env.VN_LEGAL_LIVE === "1";

/** Default location RB1 writes the Gemini index to (plan 5.9 step 5). */
export const GEMINI_INDEX_PATH = path.join(
  REPO_ROOT,
  "storage",
  "congraph_vectors_gemini-embedding-2_768.cgraph",
);

export const REGISTERED_TOOLS = [
  "search_legal_articles",
  "traverse_references",
  "get_community_context",
  "get_article",
  "recall_session",
];

export const Q_ART25 = "Quyền nhân thân theo Điều 25 là gì?";

// ---------------------------------------------------------------------------
// Key-shaped strings. Built from fragments so this repo never contains the
// literal prefixes (the AC 32/40 git grep scans the whole tree, tests too).
// ---------------------------------------------------------------------------
const P_GOOGLE = "AI" + "za";
// Anchored: a bare `AQ\.` also matches "FAQ." in prose. The prefix must not be
// preceded by a letter, digit or underscore (deviation from the plan's literal
// regex, recorded in README.md).
const P_GOOGLE_OAUTH = "(^|[^A-Za-z0-9_])AQ" + "\\.";
const P_LF_SECRET = "sk-" + "lf-";
const P_LF_PUBLIC = "pk-" + "lf-";
/** AC 32 pattern (git grep -E). */
export const LANGFUSE_GREP_ERE = [P_LF_SECRET, P_LF_PUBLIC].join("|");
/** AC 40 pattern (git grep -E). Alternatives are not split on "|" by callers. */
export const GOOGLE_GREP_ERE = [P_GOOGLE, P_GOOGLE_OAUTH].join("|");
export const KEY_GREP_ERE = [LANGFUSE_GREP_ERE, GOOGLE_GREP_ERE].join("|");
export const KEY_SHAPES: RegExp[] = [
  new RegExp(P_GOOGLE),
  new RegExp(P_GOOGLE_OAUTH),
  new RegExp(P_LF_SECRET),
  new RegExp(P_LF_PUBLIC),
  /[?&]key=/i,
  /Bearer\s+[A-Za-z0-9_.-]{12,}/,
];

/** Returns the list of key-shaped matches (descriptions only, never values). */
export function findKeyShapes(text: string): string[] {
  return KEY_SHAPES.filter((re) => re.test(text)).map((re) => re.source);
}

export function expectNoKeyShapes(label: string, text: string): void {
  const hits = findKeyShapes(text);
  if (hits.length > 0) {
    throw new Error(
      `${label} contains key-shaped content matching: ${hits.join(" , ")} (value not printed)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Temp dirs and files
// ---------------------------------------------------------------------------
export interface TempArea {
  root: string;
  /** root/a/b/sessions so that "../../x" escapes to root/a (inside root). */
  sessionsDir: string;
  cleanup(): void;
}

export function makeTempArea(prefix = "vnl-agent-"): TempArea {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const sessionsDir = path.join(root, "a", "b", "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  return {
    root,
    sessionsDir,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export function walkFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(path.relative(base, full).replace(/\\/g, "/"));
  }
  return out.sort();
}

export function sha256File(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function readJsonl(file: string): Record<string, any>[] {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

export function sessionFile(sessionsDir: string, id: string): string {
  return path.join(sessionsDir, `${id}.jsonl`);
}

export function randomOwner(): string {
  return randomBytes(16).toString("hex");
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

/** A port that nothing listens on (obtained free, then released). */
export const deadPort = freePort;

export function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
}

// ---------------------------------------------------------------------------
// Spawned server
// ---------------------------------------------------------------------------
export interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface ServerHandle {
  port: number;
  base: string;
  child: ChildProcess;
  sessionsDir: string;
  /** stdout + stderr captured so far */
  log(): string;
  exited: Promise<ExitInfo>;
  hasExited(): boolean;
  stop(): Promise<void>;
}

export interface SpawnOptions {
  sessionsDir: string;
  /** Extra env. Use "" to make a variable missing; never rely on deleting. */
  env?: Record<string, string>;
  /** Spawn the SIGTERM-emulation wrapper (Windows AC 31). Adds an IPC channel. */
  ipcWrapper?: boolean;
}

const live = new Set<ServerHandle>();

const FAKE_KEY = "fake-upstream-key-not-a-secret-0001";

/**
 * Environment that points the agent at a port nothing listens on, with a fake
 * chat key, so offline tests never send the real key anywhere.
 */
export async function deadLlmEnv(): Promise<Record<string, string>> {
  const p = await deadPort();
  return {
    GEMINI_OPENAI_BASE_URL: `http://127.0.0.1:${p}/`,
    GEMINI_API_KEY: FAKE_KEY,
  };
}

export const FAKE_CHAT_KEY = FAKE_KEY;

export async function spawnServer(opts: SpawnOptions): Promise<ServerHandle> {
  const port = await freePort();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith("VITEST") || k === "NODE_ENV") continue;
    env[k] = v;
  }
  Object.assign(env, {
    NODE_ENV: "development",
    PORT: String(port),
    HOST: "127.0.0.1",
    AGENT_SESSIONS_DIR: opts.sessionsDir,
    GEMINI_MAX_CONCURRENCY: "2",
    AGENT_MAX_STEPS: "4",
    LANGFUSE_ENABLED: "false",
  });
  Object.assign(env, opts.env ?? {});
  // Never let an overridden endpoint receive the real chat key.
  if (
    opts.env?.GEMINI_OPENAI_BASE_URL !== undefined &&
    opts.env?.GEMINI_API_KEY === undefined
  ) {
    env.GEMINI_API_KEY = FAKE_KEY;
  }

  const entry = opts.ipcWrapper
    ? path.join(HERE, "sigterm-wrapper", "server.ts")
    : path.join(REPO_ROOT, "apps", "server", "src", "api", "server.ts");
  const child = spawn(process.execPath, ["--import", "tsx", entry], {
    cwd: REPO_ROOT,
    env,
    stdio: opts.ipcWrapper
      ? ["ignore", "pipe", "pipe", "ipc"]
      : ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let buf = "";
  const onData = (d: Buffer) => {
    buf += d.toString("utf8");
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  let done = false;
  const exited = new Promise<ExitInfo>((resolve) => {
    child.once("exit", (code, signal) => {
      done = true;
      resolve({ code, signal });
    });
  });
  const handle: ServerHandle = {
    port,
    base: `http://127.0.0.1:${port}`,
    child,
    sessionsDir: opts.sessionsDir,
    log: () => buf,
    exited,
    hasExited: () => done,
    async stop() {
      if (!done) {
        child.kill();
        const t = setTimeout(() => {
          if (!done && child.pid) {
            if (process.platform === "win32") {
              try {
                spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
                  windowsHide: true,
                  stdio: "ignore",
                }).on("error", () => undefined);
              } catch {
                /* ignore */
              }
            }
            try {
              child.kill("SIGKILL");
            } catch {
              /* ignore */
            }
          }
        }, 5000);
        await exited;
        clearTimeout(t);
      }
      live.delete(handle);
    },
  };
  live.add(handle);
  return handle;
}

export async function waitReady(h: ServerHandle, timeoutMs = 150_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (h.hasExited()) {
      throw new Error(
        `server exited before ready (code ${(await h.exited).code}). Log tail:\n${tail(h.log())}`,
      );
    }
    try {
      // Any HTTP answer means the server is listening. /api/health may answer
      // 503 ("degraded") on this machine for reasons unrelated to the agent
      // (graph store not ready), so its status code is not used.
      await fetch(`${h.base}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(
    `server not ready after ${timeoutMs} ms. Log tail:\n${tail(h.log())}`,
  );
}

export async function startReadyServer(opts: SpawnOptions) {
  const h = await spawnServer(opts);
  await waitReady(h);
  return h;
}

/** Spawn and expect the process to exit by itself. Returns exit info and log. */
export async function expectBootRefusal(
  opts: SpawnOptions,
  timeoutMs = 60_000,
): Promise<{ exit: ExitInfo; log: string }> {
  const h = await spawnServer(opts);
  const timeout = new Promise<"timeout">((r) =>
    setTimeout(() => r("timeout"), timeoutMs),
  );
  const res = await Promise.race([h.exited, timeout]);
  if (res === "timeout") {
    const log = h.log();
    await h.stop();
    throw new Error(
      `server did not exit within ${timeoutMs} ms (it should refuse to start). Log tail:\n${tail(log)}`,
    );
  }
  return { exit: res, log: h.log() };
}

export async function stopAll() {
  await Promise.all([...live].map((h) => h.stop()));
}

export function tail(s: string, n = 40): string {
  return s.split("\n").slice(-n).join("\n");
}

export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

export async function waitFor(
  what: string,
  pred: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
  stepMs = 200,
) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await pred()) return;
    await sleep(stepMs);
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for: ${what}`);
}

// ---------------------------------------------------------------------------
// HTTP client with a cookie jar (vl_owner)
// ---------------------------------------------------------------------------
export interface SseEvent {
  event: string;
  data: any;
}

export interface HttpResult {
  status: number;
  headers: Headers;
  text: string;
  json: any;
}

export interface StreamResult {
  status: number;
  headers: Headers;
  events: SseEvent[];
  raw: string;
  /** body parsed as JSON when the status was not 200 */
  json: any;
  elapsedMs: number;
}

export class Client {
  cookie: string | null = null;
  constructor(
    public base: string,
    ownerValue?: string,
  ) {
    if (ownerValue) this.cookie = `vl_owner=${ownerValue}`;
  }

  private capture(res: Response) {
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const m = /^vl_owner=([^;]*)/.exec(sc);
      if (m) this.cookie = `vl_owner=${m[1]}`;
    }
  }

  private headers(extra: Record<string, string> = {}) {
    const h: Record<string, string> = { ...extra };
    if (this.cookie) h.cookie = this.cookie;
    return h;
  }

  async request(
    method: string,
    p: string,
    body?: unknown,
    timeoutMs = 60_000,
  ): Promise<HttpResult> {
    const res = await fetch(`${this.base}${p}`, {
      method,
      headers: this.headers(
        body !== undefined ? { "content-type": "application/json" } : {},
      ),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    this.capture(res);
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, headers: res.headers, text, json };
  }

  get(p: string, timeoutMs?: number) {
    return this.request("GET", p, undefined, timeoutMs);
  }
  post(p: string, body?: unknown, timeoutMs?: number) {
    return this.request("POST", p, body ?? {}, timeoutMs);
  }
  del(p: string) {
    return this.request("DELETE", p);
  }

  /** POST /api/agent/stream and collect every SSE event until the stream closes. */
  async stream(
    body: unknown,
    o: {
      timeoutMs?: number;
      signal?: AbortSignal;
      onEvent?: (e: SseEvent) => void;
    } = {},
  ): Promise<StreamResult> {
    const t0 = Date.now();
    const res = await fetch(`${this.base}/api/agent/stream`, {
      method: "POST",
      headers: this.headers({
        "content-type": "application/json",
        accept: "text/event-stream",
      }),
      body: JSON.stringify(body),
      signal: o.signal ?? AbortSignal.timeout(o.timeoutMs ?? 180_000),
    });
    this.capture(res);
    const events: SseEvent[] = [];
    let raw = "";
    if (res.status !== 200) {
      raw = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(raw);
      } catch {
        /* ignore */
      }
      return {
        status: res.status,
        headers: res.headers,
        events,
        raw,
        json,
        elapsedMs: Date.now() - t0,
      };
    }
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let pending = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      raw += chunk;
      pending += chunk.replace(/\r\n/g, "\n");
      let idx;
      while ((idx = pending.indexOf("\n\n")) >= 0) {
        const block = pending.slice(0, idx);
        pending = pending.slice(idx + 2);
        const ev = parseSseBlock(block);
        if (ev) {
          events.push(ev);
          o.onEvent?.(ev);
        }
      }
    }
    return {
      status: res.status,
      headers: res.headers,
      events,
      raw,
      json: null,
      elapsedMs: Date.now() - t0,
    };
  }
}

export function parseSseBlock(block: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  const joined = data.join("\n");
  let parsed: any = joined;
  try {
    parsed = JSON.parse(joined);
  } catch {
    /* keep raw text */
  }
  return { event, data: parsed };
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------
export const stepsOf = (events: SseEvent[]) =>
  events.filter((e) => e.event === "step").map((e) => e.data);
export const ofKind = (events: SseEvent[], name: string) =>
  events.filter((e) => e.event === name);

/** Assert the stream grammar of C1: session first, exactly one terminal event. */
export function assertStreamGrammar(events: SseEvent[]): "done" | "error" {
  if (events.length === 0) throw new Error("stream produced no events");
  if (events[0].event !== "session")
    throw new Error(`first event was "${events[0].event}", expected session`);
  const allowed = new Set([
    "session",
    "step",
    "token",
    "reset",
    "done",
    "error",
  ]);
  for (const e of events)
    if (!allowed.has(e.event)) throw new Error(`unknown event "${e.event}"`);
  const terminals = events.filter(
    (e) => e.event === "done" || e.event === "error",
  );
  if (terminals.length !== 1)
    throw new Error(`expected exactly one done|error, got ${terminals.length}`);
  if (events.at(-1)!.event !== terminals[0].event)
    throw new Error("terminal event is not the last event");
  return terminals[0].event as "done" | "error";
}

// ---------------------------------------------------------------------------
// Upstream (Gemini) stub. Simulates UPSTREAM failure only.
// ---------------------------------------------------------------------------
export interface StubRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  body: string;
}

export interface UpstreamStub {
  port: number;
  /** base URL with trailing slash, like GEMINI_OPENAI_BASE_URL */
  url: string;
  requests: StubRequest[];
  /** POSTs only (chat completions); GET /models probes are excluded */
  posts(): StubRequest[];
  /** requests whose connection was closed by the peer before the stub answered */
  abortedCount(): number;
  close(): Promise<void>;
}

export type StubMode = "429" | "401" | "hang";

export async function startUpstreamStub(mode: StubMode): Promise<UpstreamStub> {
  const requests: StubRequest[] = [];
  let aborted = 0;
  const sockets = new Set<net.Socket>();
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        authorization: req.headers.authorization,
        body,
      });
      if (req.method !== "POST") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [] }));
        return;
      }
      if (mode === "hang") {
        res.on("close", () => {
          if (!res.writableEnded) aborted += 1;
        });
        return; // never answer
      }
      if (mode === "429") {
        res.writeHead(429, {
          "content-type": "application/json",
          "retry-after": "1",
        });
        res.end(
          JSON.stringify({
            error: {
              code: 429,
              message: "Resource has been exhausted (stub).",
              status: "RESOURCE_EXHAUSTED",
            },
          }),
        );
        return;
      }
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            code: 401,
            message: "Request had invalid authentication credentials (stub).",
            status: "UNAUTHENTICATED",
          },
        }),
      );
    });
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    requests,
    posts: () => requests.filter((r) => r.method === "POST"),
    abortedCount: () => aborted,
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** TCP listener that only counts connections (AC 29: no outbound connection). */
export async function startConnectionCounter() {
  let n = 0;
  const server = net.createServer((s) => {
    n += 1;
    s.on("error", () => undefined);
    s.destroy();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    count: () => n,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Write `data` to a file only inside a temp area (guard against typos). */
export function writeTemp(area: TempArea, rel: string, data: string | Buffer) {
  const full = path.join(area.root, rel);
  if (!full.startsWith(area.root)) throw new Error("writeTemp escaped area");
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
  return full;
}

/** Synthetic Gemini manifest for boot-refusal tests (the store itself is absent). */
export function syntheticGeminiManifest(
  overrides: Record<string, unknown> = {},
) {
  return JSON.stringify(
    {
      index_id: "synthetic-test-index",
      provider: "gemini",
      model: "gemini-embedding-2",
      dim: 768,
      doc_prefix: "title: {title} | text: {content}",
      query_prefix: "task: search result | query: {content}",
      corpus_sha256: "0".repeat(64),
      counts: { articles: 689, clauses: 0, community_reports: 0 },
      created_at: new Date().toISOString(),
      ...overrides,
    },
    null,
    2,
  );
}
