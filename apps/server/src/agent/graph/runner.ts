// ============================================================================
// Agent runner (plan r5 §5.1, §5.3, §5.6). Implements the AgentRunner contract
// on top of the LangGraph graph in graph.ts. Replaces the inline runner that
// used to live in api/server.ts.
// ============================================================================

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type {
  AgentConfig,
  AgentEvent,
  AgentRunResponse,
  AgentRunner,
  AgentStep,
  AgentTracer,
  ConsultContext,
  Filters,
  SessionRecord,
  SessionStore,
} from "../contract";
import type { SessionMemoryService } from "../memory/session-memory";
import logger from "../../shared/logger";
import { activityLog } from "../../shared/activity-log";
import { assertGeminiOnlyAgentConfig } from "./guard";
import { createAgentTools } from "./tools";
import {
  buildAgentGraph,
  ChatModelLike,
  EmitPayload,
  ToolFailure,
} from "./graph";

/** Google's native Gemini API root. GEMINI_OPENAI_BASE_URL is the OpenAI-compat path and is not used here. */
export const NATIVE_GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com";

const PROBE_TIMEOUT_MS = 3000;

const SYSTEM_PROMPT = [
  "Bạn là trợ lý tư vấn pháp luật dân sự Việt Nam (Bộ luật Dân sự 2015).",
  "Dùng công cụ để tìm điều luật trước khi trả lời. Không bịa điều luật.",
  "Khi trích dẫn, ghi rõ 'Điều N'. Nếu không tìm thấy căn cứ, nói rõ điều đó.",
  "Trả lời bằng tiếng Việt, ngắn gọn, có cấu trúc.",
].join("\n");

export class AgentEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentEndpointError";
  }
}

export interface AgentRunnerDeps {
  config: AgentConfig & {
    conGraphVectorDbPath?: string;
    embedding: {
      provider?: string;
      model?: string;
      dim: number;
      apiKey?: string;
    };
  };
  retrieval: {
    retrieve(
      query: string,
      mode: "local" | "global",
      filters?: Filters,
    ): Promise<any>;
  };
  store: SessionStore;
  memory: SessionMemoryService;
  tracer: AgentTracer;
  /** Test seam. Production uses ChatGoogleGenerativeAI. */
  createModel?: (opts: { baseUrl: string }) => ChatModelLike;
  fetchImpl?: typeof fetch;
}

export interface LegalAgentRunner extends AgentRunner {
  /** Real reachability check: GET {endpoint}/v1beta/models with a 3 s timeout. Never throws. */
  probe(): Promise<boolean>;
}

function redact(text: string, secret: string | undefined): string {
  const noKey = secret ? text.split(secret).join("[redacted]") : text;
  // Upstream URLs (the Gemini endpoint, with its path) are not shown to the client either.
  return noKey.replace(/https?:\/\/\S+/g, "[url]");
}

function classify(
  err: unknown,
  secret: string | undefined,
): {
  code:
    | "llm_unreachable"
    | "llm_rate_limited"
    | "llm_auth_error"
    | "llm_error"
    | "tool_error"
    | "embedding_error"
    | "aborted"
    | "internal";
  detail: string;
} {
  const raw =
    err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const detail = redact(raw, secret).slice(0, 500);
  if (err instanceof ToolFailure) {
    return { code: err.code ?? "tool_error", detail };
  }
  if (/aborted/i.test(raw)) return { code: "aborted", detail };
  if (/\b429\b|RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(raw))
    return { code: "llm_rate_limited", detail };
  if (/\b(401|403)\b|API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(raw))
    return { code: "llm_auth_error", detail };
  if (/\b400\b|INVALID_ARGUMENT/i.test(raw))
    return { code: "llm_error", detail };
  if (/fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|network|\b50[034]\b/i.test(raw))
    return { code: "llm_unreachable", detail };
  return { code: "internal", detail };
}

export function createLegalAgentRunner(
  deps: AgentRunnerDeps,
): LegalAgentRunner {
  // Guard first: a process with the wrong provider never builds a runner.
  assertGeminiOnlyAgentConfig(deps.config);

  const cfg = deps.config;
  const apiKey = cfg.gemini.apiKey as string;
  const model = cfg.gemini.model as string;
  const maxSteps = cfg.agent.maxSteps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  let endpoint = NATIVE_GEMINI_BASE_URL;

  const makeModel =
    deps.createModel ??
    ((opts: { baseUrl: string }) =>
      new ChatGoogleGenerativeAI({
        model,
        apiKey,
        temperature: cfg.gemini.temperature,
        maxOutputTokens: cfg.gemini.maxTokens,
        maxRetries: cfg.gemini.maxRetries,
        baseUrl: opts.baseUrl,
      }) as unknown as ChatModelLike);

  function embeddingInfo(): AgentRunResponse["embedding"] {
    const provider =
      cfg.embedding.provider === "transformers" ? "transformers" : "gemini";
    return {
      provider,
      model: cfg.embedding.model ?? "gemini-embedding-2",
      dim: cfg.embedding.dim,
      index_id: indexIdOf(provider),
    };
  }

  /**
   * The index_id the store was built with, read from the manifest next to
   * CONGRAPH_VECTOR_DB_PATH (plan §5.6). Falls back to the id the build uses.
   */
  function indexIdOf(provider: "gemini" | "transformers"): string {
    if (provider === "transformers") return "legacy-transformers-384";
    const storePath = cfg.conGraphVectorDbPath;
    try {
      const manifestPath = storePath ? `${storePath}.manifest.json` : "";
      if (manifestPath && existsSync(manifestPath)) {
        const id = JSON.parse(readFileSync(manifestPath, "utf8")).index_id;
        if (typeof id === "string" && id.length > 0) return id;
      }
    } catch {
      // Unreadable manifest: boot refuses to start on it, so the fallback is for display only.
    }
    return "gemini-embedding-2-768";
  }

  function toContext(
    query: string,
    seeds: any[],
    reports: any[],
  ): ConsultContext {
    return {
      query,
      seed_articles: seeds.map((art) => ({
        id: art.article_id,
        article_id: art.article_id,
        score: art.score,
        article_number: art.article?.article_number,
        title: art.article?.title,
        content: art.article?.content,
        part: art.article?.metadata?.part,
        chapter: art.article?.metadata?.chapter,
        matched_entity_id: art.matched_entity_id,
        clauses: art.article?.clauses || [],
      })),
      path_context: [],
      community_context: {
        hierarchical_context: "",
        part: undefined,
        chapter: undefined,
        section: undefined,
        subsection: undefined,
      },
      relevant_concepts: [],
      community_reports: reports,
    };
  }

  async function* stream(
    input: {
      query: string;
      sessionId: string;
      owner: string;
      created: boolean;
      mode?: "auto" | "local" | "global";
      filters?: Filters;
    },
    signal: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    const runId = randomUUID();
    const t0 = Date.now();
    const steps: AgentStep[] = [];
    const queue: AgentEvent[] = [];
    let wake: (() => void) | null = null;
    const push = (ev: AgentEvent) => {
      queue.push(ev);
      wake?.();
      wake = null;
    };
    const emit = (p: EmitPayload) => {
      const step: AgentStep = {
        index: steps.length,
        kind: p.kind,
        content: p.content,
        tool: p.tool,
        tool_input: p.tool_input,
        ok: p.ok,
        duration_ms: p.duration_ms,
        ...(p.citations ? { citations: p.citations } : {}),
        ...(p.graph ? { graph: p.graph } : {}),
        ...(p.reports ? { reports: p.reports } : {}),
      };
      steps.push(step);
      push({ event: "step", data: step });
    };

    let seq = 1;
    const persist = async (
      rec: Omit<SessionRecord, "session_id" | "run_id" | "seq" | "created_at">,
    ) => {
      await deps.store.append(input.sessionId, {
        session_id: input.sessionId,
        run_id: runId,
        seq: seq++,
        created_at: new Date().toISOString(),
        ...rec,
      });
    };

    let finished = false;
    let failure: unknown = null;
    let result: any = null;
    let traceId: string | null = null;
    let traceUrl: string | null = null;
    let windowInfo = { turns: 0, tokens: 0, summarized_turns: 0 };

    const work = (async () => {
      try {
        deps.memory.bindOwner(input.owner, input.sessionId);
        const win = await deps.memory.window(input.sessionId);
        windowInfo = {
          turns: win.turns,
          tokens: win.tokens,
          summarized_turns: win.summarized_turns,
        };
        const meta = await deps.store.get(input.owner, input.sessionId);
        seq = (meta?.record_count ?? 1) + 1;
        await persist({ kind: "query", content: input.query });

        const history: BaseMessage[] = [new SystemMessage(SYSTEM_PROMPT)];
        if (win.summary)
          history.push(
            new SystemMessage(`Tóm tắt hội thoại trước: ${win.summary}`),
          );
        for (const m of win.messages) {
          history.push(
            m.role === "user"
              ? new HumanMessage(m.content)
              : new AIMessage(m.content),
          );
        }
        history.push(new HumanMessage(input.query));

        const tools = createAgentTools({
          retrieval: {
            retrieve: (q, mode) =>
              deps.retrieval.retrieve(q, mode, input.filters),
          },
          memory: deps.memory,
          sessionId: input.sessionId,
          runId,
        });
        const graph = buildAgentGraph({
          model: makeModel({ baseUrl: endpoint }),
          tools,
          maxSteps,
          emit,
          callbacks: deps.tracer.langchainCallbacks({
            sessionId: input.sessionId,
          }),
          signal,
          modelName: model,
          onModelCall: async (llm) => {
            await persist({
              kind: "llm_call",
              content: `Lời gọi LLM #${llm.call_index}: ${llm.response.tool_calls.length} lệnh gọi công cụ, ${llm.response.text.length} ký tự trả lời`,
              llm,
            });
          },
        });
        result = await deps.tracer.runInTrace(
          {
            runId,
            sessionId: input.sessionId,
            query: input.query,
            toolMode: "native",
          },
          async (t) => {
            traceId = t.traceId;
            traceUrl = t.traceUrl;
            return graph.invoke(
              { messages: history },
              { recursionLimit: 2 * maxSteps + 6 },
            );
          },
        );
      } catch (err) {
        failure = err;
      } finally {
        finished = true;
        wake?.();
        wake = null;
      }
    })();

    while (true) {
      while (queue.length > 0) yield queue.shift() as AgentEvent;
      if (finished) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    await work;

    if (failure !== null) {
      const { code, detail } = classify(failure, apiKey);
      logger.warn(`agent run ${runId} failed: ${code}`);
      const errStep: AgentStep = {
        index: steps.length,
        kind: "reflection",
        content: `${code}: ${detail}`,
        tool: null,
        tool_input: null,
        ok: false,
        duration_ms: Date.now() - t0,
      };
      steps.push(errStep);
      yield { event: "step", data: errStep };
      try {
        for (const s of steps) {
          await persist({
            kind: "step",
            step_kind: s.kind,
            index: s.index,
            tool: s.tool,
            tool_input: s.tool_input,
            ok: s.ok,
            duration_ms: s.duration_ms,
            citations: s.citations ?? [],
            graph: s.graph,
            reports: s.reports,
            content: s.content,
          });
        }
        await persist({
          kind: "error",
          content: detail,
          ok: false,
          trace_id: traceId,
          trace_url: traceUrl,
        });
      } catch (persistErr) {
        logger.warn(
          `agent run ${runId}: could not persist error record: ${String(persistErr)}`,
        );
      }
      yield { event: "error", data: { code, detail } };
      return;
    }

    const answer: string = result.answer;
    if (!answer) {
      yield {
        event: "error",
        data: {
          code: "llm_error",
          detail: "The model returned no answer text.",
        },
      };
      return;
    }

    const finalStep: AgentStep = {
      index: steps.length,
      kind: "final",
      content: answer,
      tool: null,
      tool_input: null,
      ok: true,
      duration_ms: Date.now() - t0,
    };
    steps.push(finalStep);
    push({ event: "step", data: finalStep });
    while (queue.length > 0) yield queue.shift() as AgentEvent;
    yield { event: "token", data: { text: answer } };

    const usage = result.usage as {
      input: number;
      output: number;
      seen: boolean;
    };
    const seeds: any[] = result.seeds ?? [];
    const reports: any[] = result.reports ?? [];
    const runResponse: AgentRunResponse = {
      session_id: input.sessionId,
      run_id: runId,
      answer,
      steps,
      tool_mode: "native",
      provider: "gemini",
      model,
      endpoint,
      embedding: embeddingInfo(),
      prompt_tokens: usage.seen ? usage.input : null,
      completion_tokens: usage.seen ? usage.output : null,
      total_tokens: usage.seen ? usage.input + usage.output : null,
      context: toContext(input.query, seeds, reports),
      duration_ms: Date.now() - t0,
      memory: {
        window_turns: windowInfo.turns,
        window_tokens: windowInfo.tokens,
        summarized_turns: windowInfo.summarized_turns,
        recalled: result.recalled ?? 0,
      },
      trace_id: traceId,
      trace_url: traceUrl,
    };

    try {
      for (const s of steps) {
        await persist({
          kind: "step",
          step_kind: s.kind,
          index: s.index,
          tool: s.tool,
          tool_input: s.tool_input,
          ok: s.ok,
          duration_ms: s.duration_ms,
          citations: s.citations ?? [],
          graph: s.graph,
          reports: s.reports,
          content: s.content,
        });
      }
      await persist({
        kind: "answer",
        content: answer,
        ok: true,
        trace_id: traceId,
        trace_url: traceUrl,
      });
    } catch (persistErr) {
      logger.warn(
        `agent run ${runId}: could not persist answer records: ${String(persistErr)}`,
      );
    }
    deps.memory.recordTurn(input.sessionId, {
      run_id: runId,
      query: input.query,
      answer,
    });

    // Keep the admin Activities view fed, as the inline runner did (commit a9f7902).
    const citations = steps.flatMap((s) => s.citations ?? []);
    activityLog.addEntry(
      "query",
      `Tham vấn pháp lý: "${input.query.length > 50 ? input.query.slice(0, 47) + "..." : input.query}"`,
      {
        session_id: input.sessionId,
        query: input.query,
        answer,
        steps_count: steps.length,
        duration_ms: Date.now() - t0,
        citations,
      },
    );

    yield { event: "done", data: runResponse };
  }

  async function probe(): Promise<boolean> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${endpoint}/v1beta/models`, {
        headers: { "x-goog-api-key": apiKey },
        signal: ctl.signal,
      });
      return res.ok;
    } catch {
      logger.warn("agent LLM probe: Gemini did not respond");
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    stream: stream as AgentRunner["stream"],
    probe,
    setEndpoint(apiUrl: string) {
      let parsed: URL;
      try {
        parsed = new URL(apiUrl);
      } catch {
        throw new AgentEndpointError("Agent endpoint is not a valid URL.");
      }
      if (
        parsed.protocol !== "https:" ||
        !parsed.hostname.endsWith("googleapis.com")
      ) {
        throw new AgentEndpointError(
          "The agent is Gemini-only: its endpoint must be an https googleapis.com host. The change was not applied.",
        );
      }
      endpoint = `${parsed.protocol}//${parsed.host}`;
    },
    async forgetSession(sessionId: string) {
      deps.memory.forget(sessionId);
    },
    describe() {
      return {
        provider: "gemini" as const,
        model,
        endpoint,
        tool_mode: "native" as const,
        max_steps: maxSteps,
        embedding: embeddingInfo(),
      };
    },
  };
}

// The runner that server.ts booted. The admin endpoint route uses it to report
// what happened to the agent when the legacy endpoint changes (plan §5.6).
let activeRunner: LegalAgentRunner | null = null;

export function setActiveAgentRunner(runner: LegalAgentRunner | null): void {
  activeRunner = runner;
}

export function getActiveAgentRunner(): LegalAgentRunner | null {
  return activeRunner;
}
