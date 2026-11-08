// ============================================================================
// Gemini-only guard for the agent path (plan r5 §5.3, decision Q1).
// Names the variable that is wrong. Never prints a value.
// ============================================================================

export class AgentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentConfigError";
  }
}

export interface AgentGuardInput {
  llm: { provider?: string };
  gemini: { apiKey?: string; model?: string };
}

export function assertGeminiOnlyAgentConfig(cfg: AgentGuardInput): void {
  const provider = cfg.llm.provider;
  if (provider !== "gemini") {
    const shown =
      provider === undefined || provider === "" ? "unset" : `"${provider}"`;
    throw new AgentConfigError(
      `LLM_PROVIDER must be "gemini" for the agent path (it is ${shown}). The agent accepts no other provider.`,
    );
  }
  if (!cfg.gemini.apiKey) {
    throw new AgentConfigError(
      "GEMINI_API_KEY is missing or empty (required by the agent path). The value is never logged.",
    );
  }
  if (!cfg.gemini.model) {
    throw new AgentConfigError(
      "GEMINI_MODEL_NAME is missing or empty (required by the agent path).",
    );
  }
}
