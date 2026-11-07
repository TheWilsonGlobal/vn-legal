/**
 * Shared fixtures and test harness for the agent route tests (C1-C10).
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, expect } from "vitest";
import {
  agentRoutes,
  type AgentRoutesOptions,
  type MemoryStatsSource,
} from "../../../../../src/api/routes/agent";
import type {
  AgentEvent,
  AgentRunResponse,
  AgentRunner,
  AgentTracer,
  ObservabilityStatus,
} from "../../../../../src/agent/contract";
import { FakeStore } from "./agent-fake-store";

export { FakeStore };

export const OWNER_A = "a".repeat(32);
export const OWNER_B = "b".repeat(32);

const P_GOOGLE = "AI" + "za";
const P_GOOGLE_OAUTH = "AQ" + "\\.";
const P_LF_SECRET = "sk-" + "lf-";
const P_LF_PUBLIC = "pk-" + "lf-";
export const KEY_SHAPES = new RegExp(
  [P_GOOGLE, P_GOOGLE_OAUTH, P_LF_SECRET, P_LF_PUBLIC, "sk-[A-Za-z0-9]"].join(
    "|",
  ),
);
export { P_GOOGLE, P_GOOGLE_OAUTH, P_LF_SECRET, P_LF_PUBLIC };

export interface StreamInput {
  query: string;
  sessionId: string;
  owner: string;
  mode?: "auto" | "local" | "global";
  filters?: unknown;
  created: boolean;
}
export type RunScript = (
  input: StreamInput,
  signal: AbortSignal,
) => AsyncGenerator<AgentEvent>;

export const DESCRIBE = {
  provider: "gemini" as const,
  model: "gemini-3.5-flash-lite",
  endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/",
  tool_mode: "native" as const,
  max_steps: 4,
  embedding: {
    provider: "gemini" as const,
    model: "gemini-embedding-2",
    dim: 768,
    index_id: "idx-test-768",
  },
};

export const TRACE_STATUS: ObservabilityStatus = {
  langfuse: "disabled_by_config",
  reason: null,
  capture: "metadata_only",
  export_errors: 0,
  last_error_at: null,
};

export const STATS: MemoryStatsSource = {
  short_term: {
    active_sessions: 2,
    turns: 5,
    tokens: 100,
    max_turns: 8,
    max_tokens: 512,
    max_sessions: 1000,
    ttl_s: 3600,
  },
  recall: { calls: 4, hits: 3, empty: 1 },
};

export function doneFor(sessionId: string, answer = "Đáp án"): AgentEvent {
  return {
    event: "done",
    data: {
      session_id: sessionId,
      run_id: "run-1",
      answer,
      steps: [],
      tool_mode: "native",
      provider: "gemini",
      model: DESCRIBE.model,
      endpoint: DESCRIBE.endpoint,
      embedding: DESCRIBE.embedding,
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      context: {} as AgentRunResponse["context"],
      duration_ms: 1,
      memory: {
        window_turns: 0,
        window_tokens: 0,
        summarized_turns: 0,
        recalled: 0,
      },
      trace_id: null,
      trace_url: null,
    } as unknown as AgentRunResponse,
  };
}

export const defaultScript: RunScript = async function* (input) {
  yield {
    event: "session",
    data: { session_id: input.sessionId, created: input.created },
  };
  yield doneFor(input.sessionId);
};

export function makeRunner(script: RunScript) {
  const inputs: StreamInput[] = [];
  const forgotten: string[] = [];
  const runner: AgentRunner & { inputs: StreamInput[]; forgotten: string[] } = {
    inputs,
    forgotten,
    stream(input, signal) {
      inputs.push(input as StreamInput);
      return script(input as StreamInput, signal);
    },
    setEndpoint() {},
    async forgetSession(id: string) {
      forgotten.push(id);
    },
    describe() {
      return DESCRIBE;
    },
  };
  return runner;
}

export const tracer: AgentTracer = {
  async runInTrace(_meta, fn) {
    return fn({
      traceId: null,
      traceUrl: null,
      tool: (_n, _i, f) => f(),
      retriever: (_n, _i, f) => f(),
      event() {},
    });
  },
  langchainCallbacks: () => [],
  status: () => TRACE_STATUS,
  shutdown: async () => {},
};

export const memoryFake = {
  window: async () => ({
    messages: [],
    summary: "",
    turns: 0,
    tokens: 0,
    summarized_turns: 0,
  }),
  recall: async () => ({ items: [], fresh_session: true }),
};

export const apps: FastifyInstance[] = [];

export async function harness(
  opts: {
    script?: RunScript;
    store?: FakeStore;
    probeLlm?: AgentRoutesOptions["probeLlm"] | "absent";
    logger?: unknown;
  } = {},
) {
  const store = opts.store ?? new FakeStore();
  const runner = makeRunner(opts.script ?? defaultScript);
  const app = Fastify({ logger: (opts.logger as boolean) ?? false });
  apps.push(app);
  const base: AgentRoutesOptions = {
    runner,
    store,
    memory: memoryFake,
    memoryStats: async () => STATS,
    tracer,
    probeLlm:
      opts.probeLlm === "absent"
        ? undefined
        : (opts.probeLlm ?? (async () => true)),
  };
  await app.register(agentRoutes, { prefix: "/api", ...base });
  await app.ready();
  return { app, store, runner };
}

export function as(owner: string) {
  return { cookie: `vl_owner=${owner}` };
}

export function parseSse(body: string): { event: string; data: unknown }[] {
  return body
    .split("\n\n")
    .filter((b) => b.length > 0)
    .map((block) => {
      const lines = block.split("\n");
      expect(lines.length, JSON.stringify(block)).toBe(2);
      expect(lines[0].startsWith("event: ")).toBe(true);
      expect(lines[1].startsWith("data: ")).toBe(true);
      return { event: lines[0].slice(7), data: JSON.parse(lines[1].slice(6)) };
    });
}

afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});
