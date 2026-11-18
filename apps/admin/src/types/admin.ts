import type {
  AdminSessionItem,
  LlmCallDetail,
  SessionRecord,
  TracesResponse,
} from "@shared/types/agent";

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
export type AdminSession = AdminSessionItem;

/** One chat-model call, kept whole (llm_call records only). */
export type LlmCall = LlmCallDetail;

/** One record of a session log (GET /api/admin/traces). */
export type TraceRecord = SessionRecord;

export type TracesPage = TracesResponse;

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
