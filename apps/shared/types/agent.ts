// ============================================================================
// Agent wire contract (C0), shared by the server, the client and the admin app.
// Source of truth: plan §6 "C0: shared TypeScript types". Field names must
// match the JSON exactly. Do not rename. Server-only ports (SessionStore,
// AgentRunner, AgentTracer) stay in apps/server/src/agent/contract.ts.
// ============================================================================

import type {
  AGENT_ERROR_CODES,
  AGENT_MODES,
  CITATION_VIA,
  EMBEDDING_PROVIDERS,
  SESSION_RECORD_KINDS,
  STEP_KINDS,
} from "../constants/src";
import type {
  ArticleClause,
  ChapterNode,
  LegalConceptCategory,
  PartNode,
  SectionNode,
  SubsectionNode,
} from "./legal";

export type StepKind = (typeof STEP_KINDS)[number];
export type CitationVia = (typeof CITATION_VIA)[number];
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];
export type AgentMode = (typeof AGENT_MODES)[number];
export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];
export type SessionRecordKind = (typeof SESSION_RECORD_KINDS)[number];

export interface Citation {
  article_id: string;
  article_number: number;
  clause_id?: string;
  /** ["Bộ luật Dân sự 2015","Phần thứ nhất","Chương III","Điều 25","Khoản 1"] */
  breadcrumb: string[];
  via: CitationVia;
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

/** The `filters` object of C1 and C2. */
export interface AgentFilters {
  part_id?: string;
  chapter_id?: string;
  section_id?: string;
  subsection_id?: string;
}

/** Body of C1 and C2. */
export interface AgentRequest {
  query: string;
  session_id?: string | null;
  mode?: AgentMode;
  filters?: AgentFilters;
}

export interface EmbeddingInfo {
  provider: EmbeddingProvider;
  model: string;
  dim: number;
  index_id: string;
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

/** One chat-model call of a run, kept whole. Written as an `llm_call` record. */
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
  kind: SessionRecordKind;
  /** Only on `llm_call` records. The content field stays a short summary. */
  llm?: LlmCallDetail;
  step_kind?: StepKind;
  tool?: string | null;
  content: string;
  ok?: boolean;
  trace_id?: string | null;
  index?: number;
  tool_input?: AgentStep["tool_input"];
  duration_ms?: number;
  citations?: Citation[];
  graph?: ObservationGraph;
  reports?: ObservationReport[];
  trace_url?: string | null;
  prev_hash?: string;
  row_hash?: string;
};

/** The `context` object POST /api/consult returns (consultation.ts mapping). */
export interface ConsultSeedArticle {
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
}

export interface ConsultPathArticle {
  id: string | undefined;
  article_id: string | undefined;
  article_number: number | undefined;
  title: string | undefined;
  content: string | undefined;
  part: string | undefined;
  chapter: string | undefined;
  depth: number;
  matched_entity_id: string | undefined;
  clauses: ArticleClause[];
  path: string[];
}

export interface ConsultCommunityReport {
  id: string;
  level: number;
  title: string;
  summary: string;
  findings: string[];
  rating: number;
}

export interface ConsultContext {
  query: string;
  seed_articles: ConsultSeedArticle[];
  path_context: ConsultPathArticle[];
  community_context: {
    hierarchical_context: string;
    part: PartNode | undefined;
    chapter: ChapterNode | undefined;
    section: SectionNode | null | undefined;
    subsection: SubsectionNode | null | undefined;
  };
  relevant_concepts: {
    name: string;
    category: LegalConceptCategory;
  }[];
  community_reports: ConsultCommunityReport[];
}

export interface AgentRunResponse {
  session_id: string;
  run_id: string;
  answer: string;
  steps: AgentStep[];
  tool_mode: "native";
  provider: "gemini";
  model: string;
  endpoint: string;
  embedding: EmbeddingInfo;
  /** null = not reported, never 0 */
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  context: ConsultContext;
  duration_ms: number;
  memory: {
    window_turns: number;
    window_tokens: number;
    summarized_turns: number;
    recalled: number;
  };
  trace_id: string | null;
  trace_url: string | null;
}

/** One completed run, as returned by C5 (turns). */
export interface SessionTurn {
  run_id: string;
  query: string;
  answer: string;
  steps: AgentStep[];
  created_at: string;
  ok: boolean;
  trace_id: string | null;
  trace_url: string | null;
}

export interface SessionMeta {
  session_id: string;
  title: string;
  created_at: string;
  last_active_at: string;
  turns: number;
  record_count: number;
  tokens: number;
  active: boolean;
}

export type AgentEvent =
  | { event: "session"; data: { session_id: string; created: boolean } }
  | { event: "step"; data: AgentStep }
  | { event: "token"; data: { text: string } }
  | { event: "reset"; data: Record<string, never> }
  | { event: "done"; data: AgentRunResponse }
  | { event: "error"; data: { code: AgentErrorCode; detail: string } };

// ---- HTTP response shapes (plan §6 endpoint table) ----

/** C3 */
export interface CreateSessionResponse {
  session_id: string;
  created_at: string;
}

/** C4 row */
export interface SessionListItem {
  session_id: string;
  title: string;
  turns: number;
  message_count: number;
  record_count: number;
  tokens: number;
  active: boolean;
  created_at: string;
  last_active_at: string;
}

/** C4 */
export interface ListSessionsResponse {
  sessions: SessionListItem[];
}

/** Admin list row (GET /api/admin/sessions): a C4 row plus its owner. */
export interface AdminSessionItem extends SessionListItem {
  owner: string;
}

/** C5 */
export interface SessionDetail {
  session_id: string;
  title: string;
  turns: SessionTurn[];
}

/** C6 */
export interface DeleteSessionResponse {
  session_id: string;
  deleted: true;
  mode: "soft";
}

/** C7 */
export interface ExampleChip {
  label: string;
  query: string;
}

/** C8 query */
export interface TracesQuery {
  session_id?: string;
  kind?: SessionRecordKind;
  q?: string;
  offset?: number;
  limit?: number;
}

/** C8 */
export interface TracesResponse {
  records: SessionRecord[];
  total: number;
  kind_counts: Record<string, number>;
}

/** C8v */
export interface VerifyTracesResponse {
  ok: boolean;
  records: number;
  first_bad: { session_id: string; line: number } | null;
}

/** C9: runner.describe() plus llm_status and observability. */
export interface AgentInfo {
  provider: "gemini";
  model: string;
  endpoint: string;
  tool_mode: "native";
  max_steps: number;
  embedding: EmbeddingInfo;
  llm_status: "connected" | "disconnected";
  observability: ObservabilityStatus;
}

/** C10 */
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
