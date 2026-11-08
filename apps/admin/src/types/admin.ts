export interface AdminStats {
  graph: {
    total_nodes: number;
    total_edges: number;
    [key: string]: number;
  };
  vector: {
    total_chunks: number;
    [key: string]: number;
  };
}

export interface Activity {
  id: string;
  type: string;
  message: string;
  timestamp: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details?: any;
}

/** A live agent session of any owner (GET /api/admin/sessions). */
export interface AdminSession {
  session_id: string;
  title: string;
  turns: number;
  message_count: number;
  record_count: number;
  tokens: number;
  active: boolean;
  created_at: string;
  last_active_at: string;
  owner: string;
}

/** One chat-model call, kept whole (llm_call records only). */
export interface LlmCall {
  call_index: number;
  model: string;
  latency_ms: number;
  system: string;
  messages: {
    role: "user" | "assistant" | "tool";
    content: string;
    tool_calls?: { name: string; args: unknown }[];
    tool_call_id?: string;
    name?: string;
  }[];
  response: { text: string; tool_calls: { name: string; args: unknown }[] };
  usage: { input: number; output: number } | null;
}

/** One record of a session log (GET /api/admin/traces). */
export interface TraceRecord {
  session_id: string;
  run_id: string | null;
  seq: number;
  created_at: string;
  kind: string;
  content: string;
  llm?: LlmCall;
}

export interface TracesPage {
  records: TraceRecord[];
  total: number;
  kind_counts: Record<string, number>;
}

export interface Community {
  id: string;
  community_id: string;
  level: number;
  title: string;
  summary: string;
  findings: (string | { explanation: string; articles?: string[] })[];
  rating: number;
  parent_id?: string;
  article_count?: number;
  principles?: string;
}

export interface VectorStoreStatus {
  status: string;
  count: number;
  [key: string]: unknown;
}

export interface VectorResult {
  id: string;
  score: number;
  content: string;
  metadata?: Record<string, unknown>;
  _distance: number;
  article_id: string;
  type: string;
  article_title?: string;
  clause_number?: number;
  title?: string;
  article_number?: number;
  part?: string;
  chapter?: string;
  keywords?: string;
}

export interface AppConfig {
  vectorStoreType: string;
  embeddingBackend: string;
  embeddingDimension: number;
  embeddingModel: string;
  llmProvider?: string;
  llmModel: string;
  graphDbPath?: string;
  [key: string]: unknown;
}
