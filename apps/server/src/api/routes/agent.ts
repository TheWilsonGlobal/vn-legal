// ============================================================================
// Agent Routes (plan §6, C1-C10)
//
// Registered by server.ts under the /api prefix, so the paths below are the
// relative ones and the public paths are /api/agent/...
// ============================================================================

import type { ServerResponse } from "node:http";
import type {
  FastifyBaseLogger,
  FastifyError,
  FastifyInstance,
  FastifyReply,
} from "fastify";
import fastifyCookie from "@fastify/cookie";
import { z } from "zod";
import type {
  AgentEvent,
  AgentRunner,
  AgentStep,
  AgentTracer,
  SessionMemory,
  SessionMeta,
  SessionStore,
  Turn,
} from "../../agent/contract";
import { applyOwnerCookie } from "../plugins/owner";
import { activityLog } from "../../shared/activity-log";

// ----------------------------------------------------------------------------
// Options and exported shapes
// ----------------------------------------------------------------------------

/** C10 body. `SessionMemory` has no stats method in contract.ts, so this comes from its own option. */
export interface MemoryStats {
  short_term: {
    active_sessions: number;
    turns: number;
    tokens: number;
    max_turns: number;
    max_tokens: number;
    max_sessions: number;
    ttl_s: number;
  };
  store: { sessions: number; records: number; hidden: number };
  recall: { calls: number; hits: number; empty: number };
}

/** C10 `short_term` and `recall` blocks. The `store` block comes from `store.counts()`. */
export type MemoryStatsSource = Omit<MemoryStats, "store">;

export interface AgentRoutesOptions {
  runner: AgentRunner;
  store: SessionStore;
  /**
   * Optional and unread: the routes reach memory only through the runner, which
   * binds it to the owner. Kept so the wiring can pass the memory service
   * without a type error.
   */
  memory?: SessionMemory;
  /** C10 source: short-term counters and recall counters. */
  memoryStats: () => Promise<MemoryStatsSource>;
  tracer: AgentTracer;
  /**
   * C9 `llm_status` probe. Resolves true when Gemini answers GET {base}models.
   * Provided by the wiring (B3). When absent, C9 fails with 500, never a guess.
   */
  probeLlm?: () => Promise<boolean>;
}

type StreamInput = Parameters<AgentRunner["stream"]>[0];

/** How a hijacked SSE run ended. Written to the one completion log line. */
type StreamStatus =
  | "done"
  | "error"
  | "aborted"
  | "no_terminal_event"
  | "runner_failed";

type ErrorData = Extract<AgentEvent, { event: "error" }>["data"];

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** Exactly the format from the brief. Anything else is refused before any store call. */
const UUID_RE = /^[a-f0-9-]{36}$/;

const SESSION_KINDS = [
  "session_created",
  "query",
  "step",
  "answer",
  "error",
  "deleted",
] as const;

const LLM_FAILURE_CODES: ReadonlySet<string> = new Set([
  "llm_unreachable",
  "llm_rate_limited",
  "llm_auth_error",
  "llm_error",
  "embedding_error",
]);

const LLM_PROBE_TIMEOUT_MS = 3000;
const LLM_PROBE_TIMED_OUT = Symbol("llm-probe-timed-out");

/** C7. Static server list (the real source for the chips). */
const EXAMPLES: { label: string; query: string }[] = [
  {
    label: "Quyền của người chưa thành niên",
    query: "Quyền của người chưa thành niên",
  },
  { label: "Điều kiện kết hợp đồng", query: "Điều kiện kết hợp đồng" },
  { label: "Sở hữu tài sản chung", query: "Sở hữu tài sản chung" },
  { label: "Thừa kế theo pháp luật", query: "Thừa kế theo pháp luật" },
  { label: "Bồi thường thiệt hại", query: "Bồi thường thiệt hại" },
  { label: "Quyền nhân thân (Điều 25)", query: "Quyền nhân thân (Điều 25)" },
  { label: "Giám hộ (Điều 46)", query: "Giám hộ (Điều 46)" },
  { label: "Năng lực hành vi dân sự", query: "Năng lực hành vi dân sự" },
  {
    label: "Quyền nhân thân và các điều liên quan",
    query: "Quyền nhân thân theo Điều 25 liên quan đến những điều nào khác?",
  },
  {
    label: "Nghĩa vụ người giám hộ và điều liên quan",
    query: "Người giám hộ có những nghĩa vụ gì và các điều liên quan là gì?",
  },
  {
    label: "Tóm tắt chương về quyền sở hữu",
    query: "Tóm tắt các quy định về quyền sở hữu trong Bộ luật",
  },
  {
    label: "Nhắc lại: tôi đã hỏi gì trước đó?",
    query: "Tôi đã hỏi gì trước đó?",
  },
];

// ----------------------------------------------------------------------------
// Request schemas (zod 3)
// ----------------------------------------------------------------------------

const RunBodySchema = z.object({
  query: z
    .string()
    .min(1)
    .max(1000)
    .refine((q) => q.trim().length > 0, { message: "query must not be blank" })
    .transform((q) => q.normalize("NFC")),
  session_id: z.string().nullable().optional(),
  mode: z.enum(["auto", "local", "global"]).optional(),
  filters: z
    .object({
      part_id: z.string().optional(),
      chapter_id: z.string().optional(),
      section_id: z.string().optional(),
      subsection_id: z.string().optional(),
    })
    .optional(),
});
type RunBody = z.infer<typeof RunBodySchema>;

const boundedInt = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d{1,9}$/, "must be a non-negative integer")
    .refine((v) => Number(v) >= min && Number(v) <= max, {
      message: `must be between ${min} and ${max}`,
    })
    .optional();

const TracesQuerySchema = z.object({
  session_id: z.string().optional(),
  kind: z.enum(SESSION_KINDS).optional(),
  q: z
    .string()
    .max(500)
    .transform((s) => s.normalize("NFC"))
    .optional(),
  offset: boundedInt(0, 1_000_000_000),
  limit: boundedInt(1, 500),
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

interface ResolvedSession {
  sessionId: string;
  created: boolean;
}

function sendInvalid(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "invalid_request",
    details: error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  });
}

/**
 * Writes one SSE frame and waits when the socket buffer is full, so the runner
 * is not pulled faster than the client reads. The wait also ends on `close`,
 * because a client that has gone away never emits `drain`.
 */
async function writeEvent(raw: ServerResponse, ev: AgentEvent): Promise<void> {
  // A client that has gone away cannot receive events; the abort path handles the run.
  if (raw.destroyed || raw.writableEnded) return;
  const flushed = raw.write(
    `event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`,
  );
  if (flushed) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      raw.off("drain", done);
      raw.off("close", done);
      resolve();
    };
    raw.on("drain", done);
    raw.on("close", done);
  });
}

/** Class name only. Messages can carry a URL or a key, so they are never logged. */
function errorClass(err: unknown): string {
  return err instanceof Error ? err.constructor.name : typeof err;
}

function toListItem(m: SessionMeta) {
  return {
    session_id: m.session_id,
    title: m.title,
    turns: m.turns,
    message_count: m.turns * 2,
    record_count: m.record_count,
    tokens: m.tokens,
    active: m.active,
    created_at: m.created_at,
    last_active_at: m.last_active_at,
  };
}

function toTurn(t: Turn) {
  return {
    run_id: t.run_id,
    query: t.query,
    answer: t.answer,
    steps: t.steps,
    created_at: t.created_at,
    ok: t.ok,
    trace_id: t.trace_id,
    trace_url: t.trace_url,
  };
}

function toInput(
  body: RunBody,
  session: ResolvedSession,
  owner: string,
): StreamInput {
  return {
    query: body.query,
    sessionId: session.sessionId,
    owner,
    created: session.created,
    mode: body.mode ?? "auto",
    filters: body.filters,
  };
}

/**
 * C9 probe. A timeout or a rejection both report `disconnected`: the probe
 * answered "no" and the route still answers 200. The reason is logged at warn
 * (the class name only, never the message).
 */
async function probeWithTimeout(
  probe: () => Promise<boolean>,
  log: FastifyBaseLogger,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = (async (): Promise<boolean> => {
    try {
      return await probe();
    } catch (err) {
      log.warn(
        { error_class: errorClass(err) },
        "agent info: llm probe failed, reporting disconnected",
      );
      return false;
    }
  })();
  try {
    const winner = await Promise.race([
      attempt,
      new Promise<typeof LLM_PROBE_TIMED_OUT>((resolve) => {
        timer = setTimeout(
          () => resolve(LLM_PROBE_TIMED_OUT),
          LLM_PROBE_TIMEOUT_MS,
        );
      }),
    ]);
    if (winner === LLM_PROBE_TIMED_OUT) {
      log.warn(
        { timeout_ms: LLM_PROBE_TIMEOUT_MS },
        "agent info: llm probe timed out, reporting disconnected",
      );
      return false;
    }
    return winner;
  } finally {
    clearTimeout(timer);
  }
}

// ----------------------------------------------------------------------------
// Plugin
// ----------------------------------------------------------------------------

export async function agentRoutes(
  fastify: FastifyInstance,
  options: AgentRoutesOptions,
): Promise<void> {
  const { runner, store, tracer, memoryStats, probeLlm } = options;

  // Cookie support and the owner hook live inside this plugin's encapsulation
  // context, so the legacy routes never see them.
  await fastify.register(fastifyCookie);
  applyOwnerCookie(fastify, {
    secure: process.env.NODE_ENV === "production",
  });

  // K10: one active run per session. Held from before the stream starts until
  // the run's events are finished (done, error, abort or throw).
  const busy = new Set<string>();

  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    if (
      error.statusCode !== undefined &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return reply
        .code(error.statusCode)
        .send({ error: "invalid_request", details: error.message });
    }
    request.log.error({ err: error }, "agent route failed");
    return reply.code(500).send({ error: "internal" });
  });

  /** A requested id must match the UUID format and be visible to this owner. */
  async function resolveSession(
    owner: string,
    requested: string | null | undefined,
  ): Promise<ResolvedSession | null> {
    if (requested === undefined || requested === null) {
      const meta = await store.create(owner);
      return { sessionId: meta.session_id, created: true };
    }
    if (!UUID_RE.test(requested)) return null;
    const meta = await store.get(owner, requested);
    return meta === null
      ? null
      : { sessionId: meta.session_id, created: false };
  }

  /** Aborts the run when the client goes away before the response finished. */
  function watchClient(
    raw: ServerResponse,
    abort: AbortController,
    log: FastifyBaseLogger,
    sessionId: string,
  ): () => void {
    const onClose = () => {
      if (!raw.writableFinished) {
        log.info(
          { session_id: sessionId },
          "agent run aborted: client disconnected",
        );
        abort.abort();
      }
    };
    raw.on("close", onClose);
    return () => {
      raw.off("close", onClose);
    };
  }

  function sendRunError(
    log: FastifyBaseLogger,
    reply: FastifyReply,
    data: ErrorData,
    steps: AgentStep[],
    sessionId: string,
  ) {
    if (LLM_FAILURE_CODES.has(data.code)) {
      return reply
        .code(502)
        .send({ error: data.code, detail: data.detail, steps });
    }
    if (data.code === "aborted") {
      log.info({ session_id: sessionId }, "agent run aborted");
      return reply
        .code(499)
        .send({ error: "aborted", detail: data.detail, steps });
    }
    log.error(
      { session_id: sessionId, code: data.code, detail: data.detail },
      "agent run failed",
    );
    return reply.code(500).send({ error: "internal" });
  }

  // --------------------------------------------------------------------------
  // C1 POST /agent/stream (SSE)
  // --------------------------------------------------------------------------
  fastify.post("/agent/stream", async (request, reply) => {
    const parsed = RunBodySchema.safeParse(request.body);
    if (!parsed.success) return sendInvalid(reply, parsed.error);

    const session = await resolveSession(request.owner, parsed.data.session_id);
    if (session === null) {
      return reply.code(404).send({ error: "session_not_found" });
    }
    if (busy.has(session.sessionId)) {
      return reply.code(409).send({ error: "session_busy" });
    }

    const sessionId = session.sessionId;
    const raw = reply.raw;
    const abort = new AbortController();
    const startedAt = Date.now();
    let status: StreamStatus = "runner_failed";
    busy.add(sessionId);
    const unwatch = watchClient(raw, abort, request.log, sessionId);
    try {
      reply.hijack();
      // Headers queued on the reply (owner cookie) are copied across, because
      // a hijacked reply never sends them itself.
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) raw.setHeader(name, value);
      }
      raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      let terminal = false;
      for await (const ev of runner.stream(
        toInput(parsed.data, session, request.owner),
        abort.signal,
      )) {
        await writeEvent(raw, ev);
        if (ev.event === "done" || ev.event === "error") {
          terminal = true;
          status = ev.event;
          break;
        }
      }
      if (!terminal) {
        if (abort.signal.aborted) {
          status = "aborted";
        } else {
          status = "no_terminal_event";
          request.log.error(
            { session_id: sessionId },
            "agent runner ended without a terminal event",
          );
          await writeEvent(raw, {
            event: "error",
            data: { code: "internal", detail: "stream ended without a result" },
          });
        }
      }
    } catch (err) {
      if (abort.signal.aborted) {
        status = "aborted";
        request.log.info(
          { session_id: sessionId },
          "agent stream stopped after client abort",
        );
      } else {
        request.log.error(
          { err, session_id: sessionId },
          "agent runner failed mid-stream",
        );
        await writeEvent(raw, {
          event: "error",
          data: { code: "internal", detail: "agent run failed" },
        });
      }
    } finally {
      unwatch();
      busy.delete(sessionId);
      if (!raw.writableEnded) raw.end();
      request.log.info(
        { session_id: sessionId, status, duration_ms: Date.now() - startedAt },
        "agent stream finished",
      );
    }
    return reply;
  });

  // --------------------------------------------------------------------------
  // C2 POST /agent/run (JSON)
  // --------------------------------------------------------------------------
  fastify.post("/agent/run", async (request, reply) => {
    const parsed = RunBodySchema.safeParse(request.body);
    if (!parsed.success) return sendInvalid(reply, parsed.error);

    const session = await resolveSession(request.owner, parsed.data.session_id);
    if (session === null) {
      return reply.code(404).send({ error: "session_not_found" });
    }
    if (busy.has(session.sessionId)) {
      return reply.code(409).send({ error: "session_busy" });
    }

    const sessionId = session.sessionId;
    const abort = new AbortController();
    busy.add(sessionId);
    const unwatch = watchClient(reply.raw, abort, request.log, sessionId);
    const steps: AgentStep[] = [];
    try {
      for await (const ev of runner.stream(
        toInput(parsed.data, session, request.owner),
        abort.signal,
      )) {
        if (ev.event === "step") steps.push(ev.data);
        else if (ev.event === "done") return reply.code(200).send(ev.data);
        else if (ev.event === "error") {
          return sendRunError(request.log, reply, ev.data, steps, sessionId);
        }
      }
      request.log.error(
        { session_id: sessionId },
        "agent runner ended without a terminal event",
      );
      return reply.code(500).send({ error: "internal" });
    } catch (err) {
      if (abort.signal.aborted) {
        request.log.info({ session_id: sessionId }, "agent run aborted");
        return reply.code(499).send({ error: "aborted", steps });
      }
      request.log.error({ err, session_id: sessionId }, "agent run failed");
      return reply.code(500).send({ error: "internal" });
    } finally {
      unwatch();
      busy.delete(sessionId);
    }
  });

  // --------------------------------------------------------------------------
  // C3 POST /agent/sessions
  // --------------------------------------------------------------------------
  fastify.post("/agent/sessions", async (request, reply) => {
    const meta = await store.create(request.owner);
    activityLog.addEntry(
      "system",
      `Tạo phiên làm việc mới: ${meta.session_id.slice(0, 8)}`,
      { session_id: meta.session_id },
    );
    return reply.code(201).send({
      session_id: meta.session_id,
      created_at: meta.created_at,
    });
  });

  // --------------------------------------------------------------------------
  // C4 GET /agent/sessions
  // --------------------------------------------------------------------------
  fastify.get("/agent/sessions", async (request, reply) => {
    const metas = await store.list(request.owner);
    // ISO 8601 UTC strings sort correctly as text. Newest created first.
    const sorted = [...metas].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
    return reply.send({ sessions: sorted.map(toListItem) });
  });

  // --------------------------------------------------------------------------
  // C5 GET /agent/sessions/:id
  // --------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>(
    "/agent/sessions/:id",
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) {
        return reply.code(404).send({ error: "session_not_found" });
      }
      const owner = request.owner;
      const meta = await store.get(owner, id);
      if (meta === null) {
        return reply.code(404).send({ error: "session_not_found" });
      }
      const turns = await store.turns(owner, id);
      return reply.send({
        session_id: meta.session_id,
        title: meta.title,
        turns: turns.map(toTurn),
      });
    },
  );

  // --------------------------------------------------------------------------
  // C6 DELETE /agent/sessions/:id (soft, decision Q14)
  // --------------------------------------------------------------------------
  fastify.delete<{ Params: { id: string } }>(
    "/agent/sessions/:id",
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) {
        return reply.code(404).send({ error: "session_not_found" });
      }
      const owner = request.owner;
      // Ownership and visibility first: a foreign or hidden id gets 404, never 409.
      const meta = await store.get(owner, id);
      if (meta === null) {
        return reply.code(404).send({ error: "session_not_found" });
      }
      // A run in flight refuses the delete (K10). Checked and marked with no
      // await in between, and the mark is held until the delete finishes.
      if (busy.has(id)) {
        return reply.code(409).send({ error: "session_busy" });
      }
      busy.add(id);
      try {
        // Forget first: if forgetting fails, nothing is deleted and the
        // failure is a 500. Soft-deleting first would hide the session and
        // then report 500 for a delete that already happened.
        await runner.forgetSession(id);
        const removed = await store.softDelete(owner, id);
        if (!removed) {
          return reply.code(404).send({ error: "session_not_found" });
        }
      } finally {
        busy.delete(id);
      }
      activityLog.addEntry("system", `Xóa phiên làm việc: ${id.slice(0, 8)}`, {
        session_id: id,
      });
      return reply.send({ session_id: id, deleted: true, mode: "soft" });
    },
  );

  // --------------------------------------------------------------------------
  // C7 GET /agent/examples
  // --------------------------------------------------------------------------
  fastify.get("/agent/examples", async (_request, reply) => {
    return reply.send(EXAMPLES);
  });

  // --------------------------------------------------------------------------
  // C8 GET /agent/traces
  // --------------------------------------------------------------------------
  fastify.get("/agent/traces", async (request, reply) => {
    const parsed = TracesQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendInvalid(reply, parsed.error);
    const { kind, q } = parsed.data;
    const offset =
      parsed.data.offset === undefined ? 0 : Number(parsed.data.offset);
    const limit =
      parsed.data.limit === undefined ? 50 : Number(parsed.data.limit);
    const owner = request.owner;

    const requested = parsed.data.session_id;
    let scope: { session_id?: string } = {};
    if (requested !== undefined) {
      if (!UUID_RE.test(requested)) {
        return reply.code(404).send({ error: "session_not_found" });
      }
      const meta = await store.get(owner, requested);
      if (meta === null) {
        return reply.code(404).send({ error: "session_not_found" });
      }
      scope = { session_id: requested };
    }

    const page = await store.records(owner, {
      ...scope,
      kind,
      q,
      offset,
      limit,
    });
    // Counts per kind for the same session and text filter, without the kind filter.
    const counts = await Promise.all(
      SESSION_KINDS.map((k) =>
        store.records(owner, { ...scope, q, kind: k, offset: 0, limit: 1 }),
      ),
    );
    const kind_counts: Record<string, number> = {};
    SESSION_KINDS.forEach((k, i) => {
      kind_counts[k] = counts[i].total;
    });
    return reply.send({
      records: page.records,
      total: page.total,
      kind_counts,
    });
  });

  // --------------------------------------------------------------------------
  // C8v GET /agent/traces/verify
  // --------------------------------------------------------------------------
  fastify.get("/agent/traces/verify", async (request, reply) => {
    const v = await store.verify(request.owner);
    return reply.send({
      ok: v.ok,
      records: v.records,
      first_bad: v.first_bad,
    });
  });

  // --------------------------------------------------------------------------
  // C9 GET /agent/info
  // --------------------------------------------------------------------------
  fastify.get("/agent/info", async (request, reply) => {
    if (probeLlm === undefined) {
      request.log.error("agent info: no llm probe is wired (probeLlm)");
      return reply.code(500).send({ error: "internal" });
    }
    // Fields are picked one by one, so an extra field on describe() can never leak out.
    const d = runner.describe();
    const reachable = await probeWithTimeout(probeLlm, request.log);
    return reply.send({
      provider: d.provider,
      model: d.model,
      endpoint: d.endpoint,
      tool_mode: d.tool_mode,
      max_steps: d.max_steps,
      embedding: {
        provider: d.embedding.provider,
        model: d.embedding.model,
        dim: d.embedding.dim,
        index_id: d.embedding.index_id,
      },
      llm_status: reachable ? "connected" : "disconnected",
      observability: tracer.status(),
    });
  });

  // --------------------------------------------------------------------------
  // C10 GET /agent/memory/stats
  // --------------------------------------------------------------------------
  fastify.get("/agent/memory/stats", async (_request, reply) => {
    const mem = await memoryStats();
    const counts = await store.counts();
    return reply.send({
      short_term: mem.short_term,
      store: {
        sessions: counts.sessions,
        records: counts.records,
        hidden: counts.hidden,
      },
      recall: mem.recall,
    });
  });
}
