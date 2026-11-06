import { afterEach, describe, expect, it } from "vitest";
import { LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import {
  createAgentTracer,
  type LangfuseSettings,
  type RunMeta,
} from "../../../src/observability";
import type { CallbackHandler } from "@langfuse/langchain";
import { RecordingExporter, makeLogger } from "./fake-exporter";

const SETTINGS: LangfuseSettings = {
  enabled: true,
  publicKey: "pk-test-PUBLIC-VALUE-0004",
  secretKey: "sk-test-SECRET-VALUE-0004",
  baseUrl: "https://langfuse.invalid",
  capture: "metadata_only",
  sampleRate: 1,
};

const META: RunMeta = {
  runId: "run-nest",
  sessionId: "sess-nest",
  userId: "vl_owner-cookie-value-4444",
  query: "cau hoi nest",
  toolMode: "local",
};

const PROMPT_TEXT = "prompt-marker-LLM-IN";
const ANSWER_TEXT = "answer-marker-LLM-OUT";

let tracer: ReturnType<typeof createAgentTracer> | undefined;

afterEach(async () => {
  if (tracer) await tracer.shutdown(2000);
  tracer = undefined;
});

describe("CallbackHandler generations nest under the agent run (A12, AC 8)", () => {
  it("records an LLM call as one generation in the agent's trace, with text redacted", async () => {
    const exporter = new RecordingExporter();
    tracer = createAgentTracer(SETTINGS, { exporter, logger: makeLogger() });

    await tracer.runInTrace(META, async () => {
      const [handler] = tracer?.langchainCallbacks({
        sessionId: META.sessionId,
      }) as CallbackHandler[];
      await handler.handleLLMStart(
        { lc: 1, type: "not_implemented", id: ["fake-llm"] } as never,
        [PROMPT_TEXT],
        "llm-run-1",
        undefined,
        undefined,
        undefined,
        undefined,
        "fake-llm-call",
      );
      await handler.handleLLMEnd(
        {
          generations: [[{ text: ANSWER_TEXT }]],
          llmOutput: {
            tokenUsage: {
              promptTokens: 10,
              completionTokens: 5,
              totalTokens: 15,
            },
          },
        } as never,
        "llm-run-1",
      );
      return null;
    });
    await tracer.flush();

    const agent = exporter.spans.find((s) => s.name === "agent-run");
    const generations = exporter.spans.filter(
      (s) =>
        s.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE] ===
        "generation",
    );
    expect(agent).toBeDefined();
    expect(generations).toHaveLength(1);
    const [gen] = generations;
    expect(gen.spanContext().traceId).toBe(agent?.spanContext().traceId);
    expect(gen.parentSpanContext?.spanId).toBe(agent?.spanContext().spanId);
    const attributes = JSON.stringify(gen.attributes);
    expect(attributes).not.toContain(PROMPT_TEXT);
    expect(attributes).not.toContain(ANSWER_TEXT);
  });
});

describe("production exporter wiring (no injected exporter, no network)", () => {
  it("starts, reports enabled, and shuts down cleanly when no span was recorded", async () => {
    const logger = makeLogger();
    tracer = createAgentTracer(SETTINGS, { logger });
    expect(tracer.status()).toMatchObject({
      langfuse: "enabled",
      export_errors: 0,
    });

    await tracer.shutdown(3000);

    expect(logger.info).toHaveBeenCalledWith("langfuse shutdown ok");
    expect(logger.warn).not.toHaveBeenCalled();
    tracer = undefined;
  });
});
