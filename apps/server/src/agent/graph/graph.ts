// ============================================================================
// LangGraph StateGraph for the legal agent (plan r5 §5.1, subset):
//   START -> agent -> (tools -> agent)* -> END
// Native tool calling only. The tool budget is counted in code: once it is
// spent, the model is called WITHOUT tools, so the next turn must answer.
// Steps are emitted through `emit` as they happen; the runner turns them into
// AgentEvents. No template answer exists on any path.
// ============================================================================

import { EmbeddingFailure } from "./embedding-failure";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  AIMessage,
  type BaseMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { tool as lcTool } from "@langchain/core/tools";
import type {
  Citation,
  ObservationGraph,
  ObservationReport,
  StepKind,
} from "../contract";
import type { AgentToolSpec, ToolResult } from "./tools";

export interface EmitPayload {
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

export type EmitStep = (step: EmitPayload) => void;

/** Minimal chat-model surface the graph needs. ChatGoogleGenerativeAI satisfies it. */
export interface ChatModelLike {
  bindTools(tools: unknown[]): {
    invoke(input: BaseMessage[], options?: object): Promise<AIMessage>;
  };
  invoke(input: BaseMessage[], options?: object): Promise<AIMessage>;
}

/** Thrown when a tool throws. The runner maps it to a failed reflection and `tool_error`. */
export class ToolFailure extends Error {
  constructor(
    readonly toolName: string,
    detail: string,
    /** Optional error code the runner reports instead of tool_error (e.g. embedding_error). */
    readonly code?: "embedding_error",
  ) {
    super(`${toolName} failed: ${detail}`);
    this.name = "ToolFailure";
  }
}

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
  toolCallsUsed: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  citations: Annotation<Citation[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
  seeds: Annotation<any[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
  reports: Annotation<any[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
  recalled: Annotation<number>({
    reducer: (a, b) => a + b,
    default: () => 0,
  }),
  usage: Annotation<{ input: number; output: number; seen: boolean }>({
    reducer: (a, b) => ({
      input: a.input + b.input,
      output: a.output + b.output,
      seen: a.seen || b.seen,
    }),
    default: () => ({ input: 0, output: 0, seen: false }),
  }),
  answer: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => "",
  }),
});

export type AgentGraphState = typeof AgentState.State;

export interface BuildGraphOptions {
  model: ChatModelLike;
  tools: AgentToolSpec[];
  maxSteps: number;
  emit: EmitStep;
  callbacks?: unknown[];
  signal?: AbortSignal;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === "object" && "text" in p
          ? String((p as { text: unknown }).text)
          : "",
      )
      .join("");
  }
  return "";
}

function argsSummary(args: unknown): string {
  try {
    return JSON.stringify(args).slice(0, 200);
  } catch {
    return "{}";
  }
}

// The tool output is untrusted text. Neutralise a forged closing tag inside it.
function wrapToolOutput(name: string, ok: boolean, content: string): string {
  const safe = content.replace(/<\/tool_output/gi, "<\\/tool_output");
  return `<tool_output tool="${name}" ok="${ok}">\n${safe}\n</tool_output>`;
}

export function buildAgentGraph(opts: BuildGraphOptions) {
  const { model, tools, maxSteps, emit, callbacks, signal } = opts;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const lcTools = tools.map((t) =>
    lcTool(async () => "", {
      name: t.name,
      description: t.description,
      schema: t.schema,
    }),
  );
  const bound = model.bindTools(lcTools);
  const callOpts = { callbacks, signal };

  async function agentNode(state: AgentGraphState) {
    const budgetLeft = state.toolCallsUsed < maxSteps;
    const runner = budgetLeft ? bound : model;
    const ai = await runner.invoke(state.messages, callOpts);
    const calls = ai.tool_calls ?? [];
    const text = textOf(ai.content).trim();

    if (calls.length > 0 && text) {
      emit({
        kind: "thought",
        content: text,
        tool: null,
        tool_input: null,
        ok: true,
        duration_ms: 0,
      });
    }
    for (const call of calls) {
      emit({
        kind: "thought",
        content: `Model chose ${call.name} (${argsSummary(call.args)})`,
        tool: call.name,
        tool_input: argsSummary(call.args),
        ok: true,
        duration_ms: 0,
      });
    }

    const meta = (
      ai as AIMessage & {
        usage_metadata?: { input_tokens?: number; output_tokens?: number };
      }
    ).usage_metadata;
    return {
      messages: [ai],
      usage: {
        input: meta?.input_tokens ?? 0,
        output: meta?.output_tokens ?? 0,
        seen: meta !== undefined,
      },
      answer: calls.length === 0 ? text : "",
    };
  }

  async function toolsNode(state: AgentGraphState) {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const out: ToolMessage[] = [];
    let used = state.toolCallsUsed;
    const citations: Citation[] = [];
    const seeds: any[] = [];
    const reports: any[] = [];
    let recalled = 0;

    for (const call of last.tool_calls ?? []) {
      const id = call.id ?? call.name;
      const spec = byName.get(call.name);
      if (!spec) {
        emit({
          kind: "reflection",
          content: `Refused unknown tool ${call.name}`,
          tool: call.name,
          tool_input: argsSummary(call.args),
          ok: false,
          duration_ms: 0,
        });
        out.push(
          new ToolMessage({
            content: wrapToolOutput(call.name, false, "unknown tool"),
            tool_call_id: id,
            name: call.name,
          }),
        );
        continue;
      }
      if (used >= maxSteps) {
        emit({
          kind: "reflection",
          content: `Refused ${call.name}: tool budget spent`,
          tool: call.name,
          tool_input: argsSummary(call.args),
          ok: false,
          duration_ms: 0,
        });
        out.push(
          new ToolMessage({
            content: wrapToolOutput(call.name, false, "tool budget spent"),
            tool_call_id: id,
            name: call.name,
          }),
        );
        continue;
      }
      const parsed = spec.schema.safeParse(call.args);
      if (!parsed.success) {
        emit({
          kind: "reflection",
          content: `Refused ${call.name}: invalid arguments`,
          tool: call.name,
          tool_input: argsSummary(call.args),
          ok: false,
          duration_ms: 0,
        });
        out.push(
          new ToolMessage({
            content: wrapToolOutput(call.name, false, "invalid arguments"),
            tool_call_id: id,
            name: call.name,
          }),
        );
        continue;
      }
      used += 1;
      const input = JSON.stringify(parsed.data);
      emit({
        kind: "action",
        content: `Gọi ${spec.name}`,
        tool: spec.name,
        tool_input: input,
        ok: true,
        duration_ms: 0,
      });

      const t0 = Date.now();
      let res: ToolResult;
      try {
        res = await spec.run(parsed.data);
      } catch (err) {
        throw new ToolFailure(
          spec.name,
          err instanceof Error ? err.message : String(err),
          err instanceof EmbeddingFailure ? "embedding_error" : undefined,
        );
      }
      emit({
        kind: "observation",
        content: res.summary,
        tool: spec.name,
        tool_input: input,
        ok: res.ok,
        duration_ms: Date.now() - t0,
        citations: res.citations,
        ...(res.graph ? { graph: res.graph } : {}),
        ...(res.shown_reports ? { reports: res.shown_reports } : {}),
      });
      citations.push(...res.citations);
      seeds.push(...res.seeds);
      reports.push(...res.reports);
      recalled += res.recalled;
      out.push(
        new ToolMessage({
          content: wrapToolOutput(spec.name, res.ok, res.content),
          tool_call_id: id,
          name: spec.name,
        }),
      );
    }

    return {
      messages: out,
      toolCallsUsed: used,
      citations,
      seeds,
      reports,
      recalled,
    };
  }

  function route(state: AgentGraphState): "tools" | typeof END {
    const last = state.messages[state.messages.length - 1];
    return last instanceof AIMessage && (last.tool_calls?.length ?? 0) > 0
      ? "tools"
      : END;
  }

  const graph = new StateGraph(AgentState)
    .addNode("agent", agentNode)
    .addNode("tools", toolsNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", route, ["tools", END])
    .addEdge("tools", "agent");

  return graph.compile();
}
