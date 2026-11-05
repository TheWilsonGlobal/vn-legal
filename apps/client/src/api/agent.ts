/**
 * Fetch-based client for the agent API (plan §6, C1-C10).
 *
 * - Every request sends `credentials: "same-origin"` (httpOnly `vl_owner` cookie).
 * - Any non-2xx response, network failure or malformed payload throws an
 *   `ApiError`. Nothing here returns an empty or sample substitute.
 * - Aborting via `AbortSignal` rejects with the browser's `AbortError`
 *   (use `isAbortError`); it is never converted to an ApiError.
 */
import type {
  AgentEvent,
  AgentInfo,
  AgentRequest,
  AgentRunResponse,
  CreateSessionResponse,
  DeleteSessionResponse,
  ExampleChip,
  ListSessionsResponse,
  MemoryStats,
  SessionDetail,
  TracesQuery,
  TracesResponse,
  VerifyTracesResponse,
} from "../types/agent";

const BASE = "/api/agent";

/** Typed failure. `status` 0 = no HTTP response (network or stream problem). */
export class ApiError extends Error {
  readonly status: number;
  /** Server `error` code (`session_busy`, `llm_unreachable`, ...) or a client code. */
  readonly code: string;
  readonly detail: string | null;
  /** Validation details of a 400 `invalid_request`, as sent by the server. */
  readonly details: unknown;
  /** Partial steps of a 502 from C2. */
  readonly steps: unknown;

  constructor(
    status: number,
    code: string,
    detail: string | null = null,
    extra: { details?: unknown; steps?: unknown } = {},
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.details = extra.details;
    this.steps = extra.steps;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    return new ApiError(
      res.status,
      typeof b.error === "string" ? b.error : `http_${res.status}`,
      typeof b.detail === "string"
        ? b.detail
        : typeof b.message === "string"
          ? b.message
          : null,
      { details: b.details, steps: b.steps },
    );
  }
  return new ApiError(res.status, `http_${res.status}`, res.statusText || null);
}

async function send(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, credentials: "same-origin", signal });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiError(
      0,
      "network_error",
      err instanceof Error ? err.message : String(err),
    );
  }
  if (!res.ok) throw await toApiError(res);
  return res;
}

async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const res = await send(url, init, signal);
  try {
    return (await res.json()) as T;
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiError(res.status, "invalid_response", "Response is not JSON");
  }
}

function postJson(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ---- SSE parsing ----

const EVENT_NAMES: ReadonlySet<string> = new Set([
  "session",
  "step",
  "token",
  "reset",
  "done",
  "error",
]);

/**
 * Parse one SSE block (text between blank lines). Comment lines (`:`) are
 * ignored, multiple `data:` lines are joined with `\n`. Returns null for
 * blocks without data (comments/keep-alives). A block that carries data under
 * an event name outside the contract, or with malformed JSON, throws an
 * ApiError `invalid_event`.
 */
export function parseSseBlock(block: string): AgentEvent | null {
  let name = "message";
  const dataLines: string[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "" || line.startsWith(":")) continue;
    const idx = line.indexOf(":");
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? "" : line.slice(idx + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") name = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  if (!EVENT_NAMES.has(name)) {
    throw new ApiError(0, "invalid_event", `Unknown event "${name}"`);
  }
  try {
    return {
      event: name,
      data: JSON.parse(dataLines.join("\n")),
    } as AgentEvent;
  } catch {
    throw new ApiError(0, "invalid_event", `Malformed "${name}" event payload`);
  }
}

/**
 * Incremental SSE splitter: feed decoded text chunks of any size (events may
 * be split across reads); returns the complete events found so far.
 */
export class SseBuffer {
  private buffer = "";

  push(text: string): AgentEvent[] {
    this.buffer = (this.buffer + text).replace(/\r\n/g, "\n");
    const out: AgentEvent[] = [];
    let sep = this.buffer.indexOf("\n\n");
    while (sep !== -1) {
      const ev = parseSseBlock(this.buffer.slice(0, sep));
      this.buffer = this.buffer.slice(sep + 2);
      if (ev) out.push(ev);
      sep = this.buffer.indexOf("\n\n");
    }
    return out;
  }

  /** Call at end of stream: parses a trailing block without final blank line. */
  flush(): AgentEvent[] {
    const rest = this.buffer.replace(/\r/g, "");
    this.buffer = "";
    if (!rest.trim()) return [];
    const ev = parseSseBlock(rest);
    return ev ? [ev] : [];
  }
}

export interface StreamOptions {
  signal?: AbortSignal;
  onEvent: (event: AgentEvent) => void;
}

/**
 * C1. Resolves after the stream closes having delivered a terminal `done` or
 * `error` event. Pre-stream 400/404/409 reject with ApiError (`invalid_request`,
 * `session_not_found`, `session_busy`). A stream that ends with neither a
 * `done` nor an `error` event rejects with ApiError code `stream_ended`.
 * Abort rejects with AbortError.
 */
export async function streamAgent(
  body: AgentRequest,
  { signal, onEvent }: StreamOptions,
): Promise<void> {
  const res = await send(
    `${BASE}/stream`,
    {
      ...postJson(body),
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
    },
    signal,
  );
  if (!res.body) {
    throw new ApiError(res.status, "no_stream", "Response has no body");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const sse = new SseBuffer();
  let terminal = false;
  const deliver = (events: AgentEvent[]) => {
    for (const ev of events) {
      if (ev.event === "done" || ev.event === "error") terminal = true;
      onEvent(ev);
    }
  };
  let finished = false;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (isAbortError(err)) throw err;
        throw new ApiError(
          0,
          "stream_interrupted",
          err instanceof Error ? err.message : String(err),
        );
      }
      if (chunk.done) break;
      // onEvent / parse errors propagate unmapped (outside the read catch).
      deliver(sse.push(decoder.decode(chunk.value, { stream: true })));
    }
    deliver(sse.push(decoder.decode()));
    deliver(sse.flush());
    finished = true;
  } finally {
    if (!finished) {
      reader.cancel().catch(() => {
        /* stream already errored or closed; nothing left to release */
      });
    }
  }
  if (!terminal) {
    throw new ApiError(
      0,
      "stream_ended",
      "Stream closed without a done or error event",
    );
  }
}

// ---- JSON endpoints ----

/** C2 */
export const runAgent = (body: AgentRequest, signal?: AbortSignal) =>
  requestJson<AgentRunResponse>(`${BASE}/run`, postJson(body), signal);

/** C3 */
export const createSession = (signal?: AbortSignal) =>
  requestJson<CreateSessionResponse>(
    `${BASE}/sessions`,
    { method: "POST" },
    signal,
  );

/** C4 */
export const listSessions = (signal?: AbortSignal) =>
  requestJson<ListSessionsResponse>(`${BASE}/sessions`, {}, signal);

/** C5 */
export const getSession = (id: string, signal?: AbortSignal) =>
  requestJson<SessionDetail>(
    `${BASE}/sessions/${encodeURIComponent(id)}`,
    {},
    signal,
  );

/** C6 */
export const deleteSession = (id: string, signal?: AbortSignal) =>
  requestJson<DeleteSessionResponse>(
    `${BASE}/sessions/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    signal,
  );

/** C7 */
export const getExamples = (signal?: AbortSignal) =>
  requestJson<ExampleChip[]>(`${BASE}/examples`, {}, signal);

/** C8 */
export function getTraces(query: TracesQuery = {}, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (query.session_id) params.set("session_id", query.session_id);
  if (query.kind) params.set("kind", query.kind);
  if (query.q) params.set("q", query.q);
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const qs = params.toString();
  return requestJson<TracesResponse>(
    `${BASE}/traces${qs ? `?${qs}` : ""}`,
    {},
    signal,
  );
}

/** C8v */
export const verifyTraces = (signal?: AbortSignal) =>
  requestJson<VerifyTracesResponse>(`${BASE}/traces/verify`, {}, signal);

/** C9 */
export const getInfo = (signal?: AbortSignal) =>
  requestJson<AgentInfo>(`${BASE}/info`, {}, signal);

/** C10 */
export const getMemoryStats = (signal?: AbortSignal) =>
  requestJson<MemoryStats>(`${BASE}/memory/stats`, {}, signal);
