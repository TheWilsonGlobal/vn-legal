// Unit tests for the LangGraph agent (plan r5 §5.1–§5.3). No network: the chat model,
// retrieval, store, memory and tracer are scripted fakes.

import { describe, it, expect } from "vitest";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import {
  createLegalAgentRunner,
  AgentEndpointError,
} from "../../../../src/agent/graph/runner";
import {
  assertGeminiOnlyAgentConfig,
  AgentConfigError,
} from "../../../../src/agent/graph/guard";
import type { ChatModelLike } from "../../../../src/agent/graph/graph";

// --- fakes -------------------------------------------------------------------

type Reply = AIMessage | Error;

function scriptedModel(plain: Reply[], bound: Reply[]) {
  const calls: { bound: boolean; messages: BaseMessage[] }[] = [];
  const take = (queue: Reply[]) => {
    const next = queue.shift();
    if (next === undefined)
      throw new Error("fake model: no scripted reply left");
    if (next instanceof Error) throw next;
    return next;
  };
  const model: ChatModelLike = {
    bindTools() {
      return {
        async invoke(messages: BaseMessage[]) {
          calls.push({ bound: true, messages });
          return take(bound);
        },
      };
    },
    async invoke(messages: BaseMessage[]) {
      calls.push({ bound: false, messages });
      return take(plain);
    },
  };
  return { model, calls };
}

const seedArticle = {
  article_id: "a25",
  score: 0.91,
  article: {
    article_number: 25,
    title: "Điều 25",
    content: "Nội dung Điều 25.",
    metadata: { part: "Phần thứ nhất", chapter: "Chương III" },
    clauses: [],
  },
};

function fakeRetrieval() {
  const queries: string[] = [];
  return {
    queries,
    retrieval: {
      async retrieve(query: string, mode: string = "local") {
        queries.push(`${mode}:${query}`);
        return { seed_articles: [seedArticle], community_reports: [] };
      },
    },
  };
}

const memoryStub = {
  bindOwner() {},
  async window() {
    return {
      messages: [],
      summary: "",
      turns: 0,
      tokens: 0,
      summarized_turns: 0,
    };
  },
  recordTurn: () => true,
  forget: () => true,
  stats: () => ({}) as any,
  async recall() {
    return { items: [], fresh_session: true };
  },
};

const storeStub = {
  appended: [] as any[],
  async get() {
    return { record_count: 1 };
  },
  async append(_id: string, rec: any) {
    this.appended.push(rec);
  },
};

const tracerStub = {
  async runInTrace<T>(_meta: unknown, fn: (t: any) => Promise<T>) {
    return fn({ traceId: null, traceUrl: null });
  },
  langchainCallbacks: () => [],
};

const SECRET = "test-gemini-key-do-not-leak";

function baseConfig(overrides: { provider?: string; maxSteps?: number } = {}) {
  return {
    llm: { provider: overrides.provider ?? "gemini" },
    gemini: {
      apiKey: SECRET,
      model: "gemini-3.5-flash-lite",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      temperature: 0.3,
      maxTokens: 2000,
      maxRetries: 2,
      maxConcurrency: 4,
    },
    agent: { maxSteps: overrides.maxSteps ?? 4 },
    memory: {
      shortTermMaxTurns: 8,
      shortTermMaxTokens: 512,
      historyMaxTokens: 1500,
      maxObservationTokens: 6000,
      maxSessions: 1000,
      sessionTtlS: 3600,
      sessionsDir: "unused",
    },
    embedding: { provider: "transformers", model: "legacy", dim: 384 },
  } as any;
}

async function drain(gen: AsyncIterable<any>) {
  const events: any[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

function makeRunner(model: ChatModelLike, maxSteps = 4) {
  const { retrieval, queries } = fakeRetrieval();
  const runner = createLegalAgentRunner({
    config: baseConfig({ maxSteps }),
    retrieval,
    store: storeStub as any,
    memory: memoryStub as any,
    tracer: tracerStub as any,
    createModel: () => model,
  });
  return { runner, queries };
}

const input = {
  query: "Điều 25 nói gì?",
  sessionId: "s1",
  owner: "o1",
  created: true,
};

// --- guard -------------------------------------------------------------------

describe("assertGeminiOnlyAgentConfig", () => {
  it("refuses a non-Gemini provider and names the variable", () => {
    expect(() =>
      assertGeminiOnlyAgentConfig(baseConfig({ provider: "anthropic" })),
    ).toThrow(AgentConfigError);
    expect(() =>
      assertGeminiOnlyAgentConfig(baseConfig({ provider: "anthropic" })),
    ).toThrow(/LLM_PROVIDER/);
  });

  it("refuses a missing key without printing any value", () => {
    const cfg = baseConfig();
    cfg.gemini.apiKey = undefined;
    expect(() => assertGeminiOnlyAgentConfig(cfg)).toThrow(/GEMINI_API_KEY/);
  });

  it("accepts a complete Gemini config", () => {
    expect(() => assertGeminiOnlyAgentConfig(baseConfig())).not.toThrow();
  });

  it("the runner factory refuses to build for a non-Gemini provider", () => {
    const { retrieval } = fakeRetrieval();
    expect(() =>
      createLegalAgentRunner({
        config: baseConfig({ provider: "llama" }),
        retrieval,
        store: storeStub as any,
        memory: memoryStub as any,
        tracer: tracerStub as any,
      }),
    ).toThrow(AgentConfigError);
  });
});

// --- graph and runner --------------------------------------------------------

describe("agent run with native tool calling", () => {
  it("calls a tool, then answers, and emits steps in order", async () => {
    const { model, calls } = scriptedModel(
      [],
      [
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "c1",
              name: "search_legal_articles",
              args: { query: "Điều 25" },
            },
          ],
        }),
        new AIMessage("Theo [Điều 25], người tham gia được bảo vệ."),
      ],
    );
    const { runner, queries } = makeRunner(model);
    const events = await drain(
      runner.stream(input as any, new AbortController().signal),
    );

    // One search runs the local side and the community-report side.
    expect(queries).toEqual(["local:Điều 25", "global:Điều 25"]);
    const kinds = events
      .filter((e) => e.event === "step")
      .map((e) => e.data.kind);
    expect(kinds).toEqual(["thought", "action", "observation", "final"]);
    const done = events.find((e) => e.event === "done");
    expect(done).toBeDefined();
    expect(done.data.answer).toContain("Điều 25");
    expect(done.data.tool_mode).toBe("native");
    expect(done.data.provider).toBe("gemini");
    expect(done.data.steps[2].citations[0].article_number).toBe(25);
    expect(calls.map((c) => c.bound)).toEqual([true, true]);
  });

  it("records each model call in full as an llm_call record", async () => {
    storeStub.appended.length = 0;
    const { model } = scriptedModel(
      [],
      [
        new AIMessage({
          content: "",
          tool_calls: [
            { id: "c1", name: "search_legal_articles", args: { query: "Điều 25" } },
          ],
        }),
        new AIMessage("Theo [Điều 25], người tham gia được bảo vệ."),
      ],
    );
    const { runner } = makeRunner(model);
    await drain(runner.stream(input as any, new AbortController().signal));

    const llm = storeStub.appended.filter((r) => r.kind === "llm_call");
    expect(llm).toHaveLength(2);
    expect(llm[0].content).toContain("Lời gọi LLM #1");
    expect(llm[0].llm.call_index).toBe(1);
    expect(llm[1].llm.call_index).toBe(2);
    // The system prompt is kept apart from the messages, and is not empty.
    expect(llm[0].llm.system.length).toBeGreaterThan(0);
    expect(llm[0].llm.messages.some((m: any) => m.role === "system")).toBe(false);
    // The first call carries the user's question as its last message.
    expect(llm[0].llm.messages.at(-1)).toEqual({ role: "user", content: input.query });
    expect(llm[0].llm.response.tool_calls[0].name).toBe("search_legal_articles");
    // The second call sees the tool output it was given.
    expect(llm[1].llm.messages.some((m: any) => m.role === "tool")).toBe(true);
    expect(llm[1].llm.response.text).toContain("Điều 25");
  });

  it("answers without tools once the tool budget is spent", async () => {
    const toolCall = new AIMessage({
      content: "",
      tool_calls: [
        { id: "c", name: "search_legal_articles", args: { query: "x" } },
      ],
    });
    // Bound model keeps asking for tools; with budget 1 the next turn must use the plain model.
    const { model, calls } = scriptedModel(
      [new AIMessage("Trả lời cuối.")],
      [toolCall],
    );
    const { runner } = makeRunner(model, 1);
    const events = await drain(
      runner.stream(input as any, new AbortController().signal),
    );
    const done = events.find((e) => e.event === "done");
    expect(done.data.answer).toBe("Trả lời cuối.");
    expect(calls.filter((c) => c.bound)).toHaveLength(1);
    expect(calls.filter((c) => !c.bound)).toHaveLength(1);
  });

  it("refuses an unknown tool and goes on, with no template answer", async () => {
    const { model } = scriptedModel(
      [],
      [
        new AIMessage({
          content: "",
          tool_calls: [{ id: "c", name: "web_search", args: { query: "x" } }],
        }),
        new AIMessage("Không đủ căn cứ để trả lời."),
      ],
    );
    const { runner } = makeRunner(model);
    const events = await drain(
      runner.stream(input as any, new AbortController().signal),
    );
    const refusal = events.find(
      (e) =>
        e.event === "step" &&
        e.data.kind === "reflection" &&
        /unknown tool/i.test(e.data.content),
    );
    expect(refusal).toBeDefined();
    expect(events.find((e) => e.event === "done").data.answer).toBe(
      "Không đủ căn cứ để trả lời.",
    );
  });

  it("maps a 429 to llm_rate_limited, with no done and no answer", async () => {
    const { model } = scriptedModel(
      [],
      [new Error("429 RESOURCE_EXHAUSTED: quota")],
    );
    const { runner } = makeRunner(model);
    const events = await drain(
      runner.stream(input as any, new AbortController().signal),
    );
    expect(events.find((e) => e.event === "done")).toBeUndefined();
    expect(events.find((e) => e.event === "token")).toBeUndefined();
    const err = events.find((e) => e.event === "error");
    expect(err.data.code).toBe("llm_rate_limited");
    const reflection = events.find(
      (e) => e.event === "step" && e.data.kind === "reflection",
    );
    expect(reflection.data.ok).toBe(false);
  });

  it("never echoes the API key in an error detail", async () => {
    const { model } = scriptedModel(
      [],
      [new Error(`401 invalid key ${SECRET}`)],
    );
    const { runner } = makeRunner(model);
    const events = await drain(
      runner.stream(input as any, new AbortController().signal),
    );
    const err = events.find((e) => e.event === "error");
    expect(err.data.code).toBe("llm_auth_error");
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });
});

// --- endpoint and probe ------------------------------------------------------

describe("runner endpoint and probe", () => {
  it("accepts a Google host and refuses any other endpoint", () => {
    const { model } = scriptedModel([], []);
    const { runner } = makeRunner(model);
    runner.setEndpoint("https://generativelanguage.googleapis.com");
    expect(runner.describe().endpoint).toBe(
      "https://generativelanguage.googleapis.com",
    );
    expect(() => runner.setEndpoint("http://localhost:5814")).toThrow(
      AgentEndpointError,
    );
    expect(runner.describe().endpoint).toBe(
      "https://generativelanguage.googleapis.com",
    );
  });

  it("probe reports true on HTTP 200 and false on a network error", async () => {
    const { model } = scriptedModel([], []);
    const { retrieval } = fakeRetrieval();
    const ok = createLegalAgentRunner({
      config: baseConfig(),
      retrieval,
      store: storeStub as any,
      memory: memoryStub as any,
      tracer: tracerStub as any,
      createModel: () => model,
      fetchImpl: (async () => new Response("{}", { status: 200 })) as any,
    });
    expect(await ok.probe()).toBe(true);

    const down = createLegalAgentRunner({
      config: baseConfig(),
      retrieval,
      store: storeStub as any,
      memory: memoryStub as any,
      tracer: tracerStub as any,
      createModel: () => model,
      fetchImpl: (async () => {
        throw new Error("fetch failed");
      }) as any,
    });
    expect(await down.probe()).toBe(false);
  });
});
