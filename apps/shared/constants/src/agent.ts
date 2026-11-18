// ============================================================================
// Agent wire constants shared by the server, the client and the admin app.
// The types in ../types/agent.ts are derived from these lists, so a value is
// added in exactly one place.
// ============================================================================

export const STEP_KINDS = [
  "thought",
  "action",
  "observation",
  "reflection",
  "final",
] as const;

export const CITATION_VIA = ["vector", "path", "community", "lookup"] as const;

export const AGENT_MODES = ["auto", "local", "global"] as const;

export const AGENT_ERROR_CODES = [
  "llm_unreachable",
  "llm_rate_limited",
  "llm_auth_error",
  "llm_error",
  "embedding_error",
  "tool_error",
  "aborted",
  "internal",
] as const;

export const EMBEDDING_PROVIDERS = ["gemini", "jina", "transformers"] as const;

export const LEGAL_CONCEPT_CATEGORIES = [
  "person",
  "property",
  "contract",
  "inheritance",
  "family",
  "tort",
  "other",
] as const;

export const SESSION_RECORD_KINDS = [
  "session_created",
  "query",
  "step",
  "answer",
  "error",
  "deleted",
  "llm_call",
] as const;

/** Longest question accepted by the agent and consultation routes. */
export const MAX_QUERY_LENGTH = 1000;
