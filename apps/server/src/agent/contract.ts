// ============================================================================
// Agent contract (C0). Source of truth: plan §6 "C0: shared TypeScript types".
// The client mirrors these in apps/client/src/types/agent.ts. Do not rename.
// ============================================================================

import type {
  ArticleClause,
  ArticleNode,
  ChapterNode,
  LegalConceptNode,
  PartNode,
  SectionNode,
  SubsectionNode,
} from "../shared/types";

export type StepKind =
  | "thought"
  | "action"
  | "observation"
  | "reflection"
  | "final";

export interface Citation {
  article_id: string;
  article_number: number;
  clause_id?: string;
  breadcrumb: string[]; // ["Bộ luật Dân sự 2015","Phần thứ nhất","Chương III","Điều 25","Khoản 1"]
  via: "vector" | "path" | "community" | "lookup";
  score?: number;
}

/** Articles reached by one search, with the reference links between them. */
export interface ObservationGraph {
  nodes: Array<{
    id: string;
    number: number;
    title: string;
    kind: "vector" | "path";
    /** Reference hops from the nearest semantic seed (0 = seed). Absent in older records. */
    depth?: number;
  }>;
  edges: Array<{ from: string; to: string }>;
}

/** A community report shown in the step's synthesis tab. */
export interface ObservationReport {
  title: string;
  summary: string;
  rating?: number;
}

export interface AgentStep {
  index: number;
  kind: StepKind;
  content: string;
  tool: string | null;
  tool_input: string | null;
  ok: boolean;
  duration_ms: number;
  citations?: Citation[];
  graph?: ObservationGraph;
  reports?: ObservationReport[];
}

/** Filters accepted by C1 and C2 (`filters` in the request body). */
export interface Filters {
  part_id?: string;
  chapter_id?: string;
  section_id?: string;
  subsection_id?: string;
}

/**
 * The `context` object POST /api/consult returns today. It is the explicit
 * mapping in apps/server/src/api/routes/consultation.ts (lines 130-186), not a
 * raw LegalContextBundle, so the field names and nesting follow that mapping.
 */
export interface ConsultContext {
  query: string;
  seed_articles: {
    id: string;
    article_id: string;
    score: number;
    article_number: number | undefined;
    title: string | undefined;
    content: string | undefined;
    part: string | undefined;
    chapter: string | undefined;
    matched_entity_id: string | undefined;
    clauses: ArticleClause[];
  }[];
  path_context: {
    id: string | undefined;
    article_id: string | undefined;
    article_number: ArticleNode["article_number"] | undefined;
    title: string | undefined;
    content: string | undefined;
    part: string | undefined;
    chapter: string | undefined;
    depth: number;
    matched_entity_id: string | undefined;
    clauses: ArticleClause[];
    path: string[];
  }[];
  community_context: {
    hierarchical_context: string;
    part: PartNode | undefined;
    chapter: ChapterNode | undefined;
    section: SectionNode | null | undefined;
    subsection: SubsectionNode | null | undefined;
  };
  relevant_concepts: {
    name: LegalConceptNode["name"];
    category: LegalConceptNode["category"];
  }[];
  community_reports: {
    id: string;
    level: number;
    title: string;
    summary: string;
    findings: string[];
    rating: number;
  }[];
}

/** One completed run, as returned by C5 (`turns[]`). */
export interface Turn {
  run_id: string;
  query: string;
  answer: string;
  steps: AgentStep[];
  created_at: string;
  ok: boolean;
  trace_id: string | null;
  trace_url: string | null;
}

export interface AgentRunResponse {
  session_id: string;
  run_id: string;
  answer: string;
  steps: AgentStep[];
  tool_mode: "native";
  provider: "gemini";
  model: string;
  endpoint: string; // r4: Gemini-only, native only
  embedding: {
    provider: "gemini" | "transformers";
    model: string;
    dim: number;
    index_id: string;
  }; // r4 (§5.9); r5: "transformers" only in rollback mode (§8 item 5)
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null; // null = not reported, never 0
  context: ConsultContext; // exactly the `context` object POST /api/consult returns today
  duration_ms: number;
  memory: {
    window_turns: number;
    window_tokens: number;
    summarized_turns: number;
    recalled: number;
  }; // r2
  trace_id: string | null; // r2: Langfuse/OTel trace id, null when tracing is off (§5.8)
  trace_url: string | null; // r2: deep link, null unless LANGFUSE_PROJECT_ID is set
}

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

export interface SessionMeta {
  session_id: string;
  title: string;
  created_at: string;
  last_active_at: string;
  turns: number;
  record_count: number;
  // Estimate, computed with the memory module's countTokens. No token source is persisted.
  tokens: number;
  active: boolean;
}

/** One chat-model call of a run, kept whole (no truncation). Written as an `llm_call` record. */
export interface LlmCallDetail {
  /** 1-based index of the model call within its run. */
  call_index: number;
  model: string;
  latency_ms: number;
  /** Text of every system message sent with this call, joined by a blank line. */
  system: string;
  /** Every non-system message sent with this call, in order. */
  messages: {
    role: "user" | "assistant" | "tool";
    content: string;
    tool_calls?: { name: string; args: unknown }[];
    tool_call_id?: string;
    name?: string;
  }[];
  response: { text: string; tool_calls: { name: string; args: unknown }[] };
  /** Null when the provider reported no usage. */
  usage: { input: number; output: number } | null;
}

export type SessionRecord = {
  session_id: string;
  run_id: string | null;
  seq: number;
  created_at: string;
  kind:
    | "session_created"
    | "query"
    | "step"
    | "answer"
    | "error"
    | "deleted"
    | "llm_call";
  /** Only on `llm_call` records. The content field stays a short summary. */
  llm?: LlmCallDetail;
  step_kind?: StepKind;
  tool?: string | null;
  content: string;
  ok?: boolean;
  trace_id?: string | null;
  // Step records written by the runner MUST carry index, tool_input, duration_ms and
  // citations. The store replays them as stored. The fields are optional only so that
  // records written before these fields existed still parse.
  index?: number;
  // Same type as AgentStep.tool_input so a step record round-trips to an AgentStep.
  tool_input?: AgentStep["tool_input"];
  duration_ms?: number;
  citations?: Citation[];
  graph?: ObservationGraph;
  reports?: ObservationReport[];
  trace_url?: string | null; // written on `answer` and `error` records
  prev_hash?: string;
  row_hash?: string;
};

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

export type ObservabilityStatus = {
  langfuse:
    | "enabled"
    | "disabled_by_config"
    | "disabled_missing_keys"
    | "degraded_export_errors";
  reason: string | null;
  capture: "full" | "masked" | "metadata_only";
  export_errors: number;
  last_error_at: string | null;
};

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

export type AgentEvent =
  | { event: "session"; data: { session_id: string; created: boolean } }
  | { event: "step"; data: AgentStep }
  | { event: "token"; data: { text: string } }
  | { event: "reset"; data: Record<string, never> }
  | { event: "done"; data: AgentRunResponse }
  | {
      event: "error";
      data: {
        code:
          | "llm_unreachable"
          | "llm_rate_limited"
          | "llm_auth_error"
          | "llm_error"
          | "embedding_error"
          | "tool_error"
          | "aborted"
          | "internal";
        detail: string;
      };
    }; // r4: rate-limit, auth, embedding codes

export interface AgentRunner {
  stream(
    input: {
      query: string;
      sessionId: string;
      // The route resolved or created the session and passes owner and created.
      // The runner binds memory to the owner.
      owner: string;
      created: boolean;
      mode?: "auto" | "local" | "global";
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
    embedding: {
      provider: "gemini" | "transformers";
      model: string;
      dim: number;
      index_id: string;
    };
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
