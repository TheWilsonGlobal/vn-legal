// ============================================================================
// LLM Tracker for prompt tracking and auditing
// ============================================================================

export interface LLMPromptLog {
  systemPrompt: string;
  userPrompt: string;
  response: string;
  timestamp: string;
}

class LLMTracker {
  private lastLog: LLMPromptLog | null = null;

  setLastLog(systemPrompt: string, userPrompt: string, response: string) {
    this.lastLog = {
      systemPrompt,
      userPrompt,
      response,
      timestamp: new Date().toISOString(),
    };
  }

  getLastLog(): LLMPromptLog | null {
    return this.lastLog;
  }
}

export const llmTracker = new LLMTracker();
