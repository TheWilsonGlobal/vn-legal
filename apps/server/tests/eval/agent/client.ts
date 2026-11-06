// HTTP client for the live server: C2 run, C3 create session, C9 info, legacy consult.
// Every failure becomes a RunError. Nothing here retries, skips or substitutes a value.

import type { AgentRunResponse } from "../../../src/agent/contract";
import { parseLegacyBody } from "./legacy";
import type { LegacyOutcome, RunError, TurnOutcome } from "./types";

export class PreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreconditionError";
  }
}

export class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(setCookies: readonly string[]): void {
    for (const sc of setCookies) {
      const pair = sc.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  header(): string | null {
    if (this.cookies.size === 0) return null;
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export interface HttpResult {
  status: number;
  text: string;
  json: unknown;
  wall_ms: number;
}

export class NetworkFailure extends Error {
  constructor(
    readonly kind: "network" | "timeout",
    message: string,
    readonly wall_ms: number,
  ) {
    super(message);
  }
}

export class Http {
  constructor(
    readonly baseUrl: string,
    readonly jar: CookieJar = new CookieJar(),
    private readonly timeoutMs = 180_000,
  ) {}

  async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    timeoutMs = this.timeoutMs,
  ): Promise<HttpResult> {
    const started = performance.now();
    const headers: Record<string, string> = { accept: "application/json" };
    const cookie = this.jar.header();
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const wall = performance.now() - started;
      const err = e as { name?: string; cause?: { code?: string } };
      if (err.name === "TimeoutError" || err.name === "AbortError")
        throw new NetworkFailure(
          "timeout",
          `${method} ${path} timed out after ${timeoutMs} ms`,
          wall,
        );
      throw new NetworkFailure(
        "network",
        `${method} ${path} failed: ${err.cause?.code ?? (e as Error).message}`,
        wall,
      );
    }
    this.jar.absorb(res.headers.getSetCookie());
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return {
      status: res.status,
      text,
      json,
      wall_ms: performance.now() - started,
    };
  }
}

// ---------------------------------------------------------------------------
// C9 preflight
// ---------------------------------------------------------------------------

export interface AgentInfo {
  provider: string;
  model: string;
  tool_mode: string;
  max_steps: number;
  embedding: { provider: string; model: string; dim: number; index_id: string };
  llm_status: string;
}

/** Fails (PreconditionError) when the server is unreachable or C9 does not describe a live Gemini + RB1 setup. */
export async function preflight(baseUrl: string): Promise<AgentInfo> {
  const http = new Http(baseUrl);
  let res: HttpResult;
  try {
    res = await http.request("GET", "/api/agent/info", undefined, 10_000);
  } catch (e) {
    throw new PreconditionError(
      `server unreachable at ${baseUrl}: ${(e as Error).message}`,
    );
  }
  if (res.status !== 200)
    throw new PreconditionError(
      `GET /api/agent/info (C9) returned HTTP ${res.status}; the agent routes are not available`,
    );
  const info = res.json as Partial<AgentInfo> | null;
  if (!info || typeof info !== "object")
    throw new PreconditionError("C9 body is not a JSON object");
  if (info.llm_status !== "connected")
    throw new PreconditionError(
      `C9 llm_status is ${JSON.stringify(info.llm_status)}, not "connected"; the LLM is not reachable`,
    );
  if (info.provider !== "gemini" || info.tool_mode !== "native")
    throw new PreconditionError(
      `C9 reports provider=${info.provider} tool_mode=${info.tool_mode}; the suite measures gemini + native only`,
    );
  if (typeof info.max_steps !== "number" || info.max_steps < 1)
    throw new PreconditionError("C9 has no numeric max_steps");
  const emb = info.embedding;
  if (!emb || typeof emb.index_id !== "string" || emb.index_id === "")
    throw new PreconditionError("C9 has no embedding.index_id");
  if (emb.provider !== "gemini")
    throw new PreconditionError(
      `C9 embedding.provider is ${emb.provider}; live KPIs are measured on the Gemini RB1 index, not the rollback store`,
    );
  if (typeof info.model !== "string" || info.model === "")
    throw new PreconditionError("C9 has no model");
  return info as AgentInfo;
}

// ---------------------------------------------------------------------------
// Turn execution
// ---------------------------------------------------------------------------

export interface Header {
  provider: "gemini";
  /** From the first `done`; null until a run has completed. */
  model: string | null;
  index_id: string;
}

/** A done whose provider, model or index_id differs from the report header is an error. */
export function checkAgainstHeader(
  r: AgentRunResponse,
  header: Header,
): RunError | null {
  if (r.provider !== header.provider)
    return {
      kind: "provider_mismatch",
      detail: `done.provider=${r.provider}, header ${header.provider}`,
    };
  if (header.model !== null && r.model !== header.model)
    return {
      kind: "model_mismatch",
      detail: `done.model=${r.model}, header ${header.model}`,
    };
  if (r.embedding?.index_id !== header.index_id)
    return {
      kind: "index_mismatch",
      detail: `done.embedding.index_id=${r.embedding?.index_id}, C9 ${header.index_id}`,
    };
  return null;
}

export function classifyFailure(status: number, body: unknown): RunError {
  const b = body as { error?: unknown; detail?: unknown } | null;
  const code = typeof b?.error === "string" ? b.error : null;
  const detail = typeof b?.detail === "string" ? b.detail : `HTTP ${status}`;
  if (code === "llm_rate_limited")
    return { kind: "rate_limited", status, detail };
  if (code) return { kind: code, status, detail };
  return { kind: `http_${status}`, status, detail };
}

export async function createSession(http: Http): Promise<string | RunError> {
  try {
    const res = await http.request("POST", "/api/agent/sessions");
    const sid = (res.json as { session_id?: unknown } | null)?.session_id;
    if (res.status === 201 && typeof sid === "string") return sid;
    return {
      kind: "session_create_failed",
      status: res.status,
      detail: `C3 returned HTTP ${res.status}`,
    };
  } catch (e) {
    const f = e as NetworkFailure;
    return { kind: f.kind ?? "network", detail: f.message };
  }
}

export async function runTurn(
  http: Http,
  sessionId: string,
  query: string,
  header: Header,
): Promise<TurnOutcome> {
  let res: HttpResult;
  try {
    res = await http.request("POST", "/api/agent/run", {
      query,
      session_id: sessionId,
    });
  } catch (e) {
    const f = e as NetworkFailure;
    return {
      ok: false,
      wall_ms: f.wall_ms,
      error: { kind: f.kind ?? "network", detail: f.message },
    };
  }
  if (res.status !== 200)
    return {
      ok: false,
      wall_ms: res.wall_ms,
      error: classifyFailure(res.status, res.json),
    };
  const r = res.json as AgentRunResponse | null;
  if (!r || typeof r.answer !== "string" || !Array.isArray(r.steps))
    return {
      ok: false,
      wall_ms: res.wall_ms,
      error: {
        kind: "bad_response",
        status: 200,
        detail: "C2 200 body is not an AgentRunResponse",
      },
    };
  const mismatch = checkAgainstHeader(r, header);
  if (mismatch) return { ok: false, wall_ms: res.wall_ms, error: mismatch };
  if (header.model === null) header.model = r.model;
  return { ok: true, response: r, wall_ms: res.wall_ms };
}

export async function runLegacy(
  http: Http,
  query: string,
): Promise<LegacyOutcome> {
  let res: HttpResult;
  try {
    res = await http.request("POST", "/api/consult", { query, mode: "auto" });
  } catch (e) {
    const f = e as NetworkFailure;
    return {
      ok: false,
      wall_ms: f.wall_ms,
      error: { kind: f.kind ?? "network", detail: f.message },
    };
  }
  if (res.status !== 200)
    return {
      ok: false,
      wall_ms: res.wall_ms,
      error: classifyFailure(res.status, res.json),
    };
  const parsed = parseLegacyBody(res.json);
  return parsed.ok === true
    ? { ok: true, cited_articles: parsed.cited_articles, wall_ms: res.wall_ms }
    : { ok: false, error: parsed.error, wall_ms: res.wall_ms };
}
