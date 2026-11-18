// ============================================================================
// Agent contract (C0). The wire types live in apps/shared/types/agent.ts and
// are shared with the client and the admin app. This file re-exports them and
// adds the server-only ports (session store, runner, tracer, config).
// ============================================================================

import type {
  AgentEvent,
  AgentFilters,
  AgentMode,
  EmbeddingInfo,
  ObservabilityStatus,
  SessionMeta,
  SessionRecord,
  SessionTurn,
} from "../../../shared/types/agent";

export type {
  AgentEvent,
  AgentRunResponse,
  AgentStep,
  Citation,
  ConsultContext,
  EmbeddingInfo,
  LlmCallDetail,
  ObservabilityStatus,
  ObservationGraph,
  ObservationReport,
  SessionMeta,
  SessionRecord,
  StepKind,
} from "../../../shared/types/agent";

/** The `filters` accepted by C1 and C2 (shared name: AgentFilters). */
export type Filters = AgentFilters;

/** One completed run, as returned by C5 (`turns[]`). */
export type Turn = SessionTurn;

// r2: memory port. B5 implements it (apps/server/src/agent/memory/**) on top of B4's SessionStore.
export interface SessionMemory {
  window(sessionId: string): Promise<{
    messages: { role: "user" | "assistant"; content: string }[];
    summary: string;
    turns: number;
    tokens: number;
    summarized_turns: number;
  }>;
  recall(
    sessionId: string,
    key: string,
    opts: { excludeRunId: string; limit?: number },
  ): Promise<{
    items: { kind: "query" | "answer"; run_id: string; content: string }[];
    fresh_session: boolean;
  }>;
}

// r2: persistence port. B4 implements it (apps/server/src/agent/sessions/**).
export interface SessionStore {
  create(owner: string): Promise<SessionMeta>;
  list(owner: string): Promise<SessionMeta[]>; // hidden sessions excluded
  get(owner: string, id: string): Promise<SessionMeta | null>; // null for missing, hidden or foreign
  append(id: string, rec: SessionRecord): Promise<void>;
  turns(owner: string, id: string): Promise<Turn[]>;
  records(
    owner: string,
    q: {
      session_id?: string;
      kind?: string;
      q?: string;
      offset: number;
      limit: number;
    },
  ): Promise<{ records: SessionRecord[]; total: number }>;
  softDelete(owner: string, id: string): Promise<boolean>;
  verify(owner: string): Promise<{
    ok: boolean;
    records: number;
    first_bad: { session_id: string; line: number } | null;
  }>; // decision Q13
  // Global counts across all owners (feeds C10 `store`).
  counts(): Promise<{ sessions: number; records: number; hidden: number }>;
}

/**
 * Read access across every owner. Only the admin routes (permission logs:read)
 * use it. Kept apart from SessionStore so owner-scoped fakes stay valid.
 */
export interface AuditableSessionStore extends SessionStore {
  /** Live sessions of all owners, newest created first. */
  listAll(): Promise<Array<SessionMeta & { owner: string }>>;
  /** Records of all live sessions, same filters and order as records(). */
  recordsAll(
    q: Parameters<SessionStore["records"]>[1],
  ): Promise<{ records: SessionRecord[]; total: number }>;
}

export interface RunTrace {
  traceId: string | null;
  traceUrl: string | null;
  tool<T>(name: string, input: unknown, fn: () => Promise<T>): Promise<T>; // asType "tool"
  retriever<T>(name: string, input: unknown, fn: () => Promise<T>): Promise<T>; // asType "retriever"
  event(name: string, data: { ok: boolean; content: string }): void; // reflections and errors
}

// r2: observability port. B6 implements it (§5.8); B1 only calls it.
export interface AgentTracer {
  runInTrace<T>(
    meta: {
      runId: string;
      sessionId: string;
      userId?: string;
      query: string;
      toolMode: string;
    },
    fn: (t: RunTrace) => Promise<T>,
  ): Promise<T>;
  langchainCallbacks(meta: { sessionId: string; userId?: string }): unknown[]; // [] when tracing is off
  status(): ObservabilityStatus;
  shutdown(timeoutMs: number): Promise<void>;
}

export interface AgentRunner {
  stream(
    input: {
      query: string;
      sessionId: string;
      // The route resolved or created the session and passes owner and created.
      // The runner binds memory to the owner.
      owner: string;
      created: boolean;
      mode?: AgentMode;
      filters?: Filters;
    },
    signal: AbortSignal,
  ): AsyncIterable<AgentEvent>;
  setEndpoint(apiUrl: string): void;
  forgetSession(sessionId: string): Promise<void>;
  describe(): {
    provider: "gemini";
    model: string;
    endpoint: string;
    tool_mode: "native";
    max_steps: number;
    embedding: EmbeddingInfo;
  }; // r5: provider added
}

/**
 * The subset of shared/config.ts the agent runner reads. config.ts is a
 * structural superset, so the whole `config` object can be passed in. Keys
 * are read in config.ts only. `undefined` means the variable is unset: the
 * runner factory refuses to start and never substitutes a value.
 */
export interface AgentConfig {
  llm: {
    provider: string; // LLM_PROVIDER; must be "gemini" for the agent (§5.3)
  };
  gemini: {
    apiKey: string | undefined; // GEMINI_API_KEY
    model: string | undefined; // GEMINI_MODEL_NAME
    baseUrl: string; // GEMINI_OPENAI_BASE_URL
    temperature: number;
    maxTokens: number;
    maxRetries: number; // GEMINI_MAX_RETRIES
    maxConcurrency: number; // GEMINI_MAX_CONCURRENCY
  };
  agent: {
    maxSteps: number; // AGENT_MAX_STEPS
  };
  memory: {
    shortTermMaxTurns: number; // SHORT_TERM_MAX_TURNS
    shortTermMaxTokens: number; // SHORT_TERM_MAX_TOKENS
    historyMaxTokens: number; // HISTORY_MAX_TOKENS
    maxObservationTokens: number; // MAX_OBSERVATION_TOKENS
    maxSessions: number; // MAX_SESSIONS
    sessionTtlS: number; // SESSION_TTL_S
    sessionsDir: string; // AGENT_SESSIONS_DIR
  };
}
