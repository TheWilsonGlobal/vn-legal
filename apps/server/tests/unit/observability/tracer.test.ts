import { afterEach, describe, expect, it, vi } from "vitest";
import { LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import {
  createAgentTracer,
  type LangfuseSettings,
  type RunMeta,
} from "../../../src/observability";

import { RecordingExporter, allLogText, makeLogger } from "./fake-exporter";

const PUBLIC_VALUE = "pk-test-PUBLIC-VALUE-0001";
const SECRET_VALUE = "sk-test-SECRET-VALUE-0001";
const HOST = "https://langfuse.invalid";
const QUERY =
  "Toi co can tra cuu Dieu 123 cua Bo luat Dan su, so dien thoai 0912345678";
const TOOL_INPUT_TEXT = "tool-input-marker-XYZ";
const ANSWER_TEXT = "answer-marker-QRS";

function settings(over: Partial<LangfuseSettings> = {}): LangfuseSettings {
  return {
    enabled: true,
    publicKey: PUBLIC_VALUE,
    secretKey: SECRET_VALUE,
    baseUrl: HOST,
    capture: "metadata_only",
    projectId: undefined,
    sampleRate: 1,
    environment: "test",
    ...over,
  };
}

const META: RunMeta = {
  runId: "run-0001",
  sessionId: "sess-0001",
  userId: "vl_owner-cookie-value-9999",
  query: QUERY,
  toolMode: "local",
};

let tracer: ReturnType<typeof createAgentTracer> | undefined;

afterEach(async () => {
  if (tracer) await tracer.shutdown(2000);
  tracer = undefined;
  vi.restoreAllMocks();
});

describe("AgentTracer disabled by config (AC 29)", () => {
  it("runs fn exactly once with no SDK, no callbacks, and one info log", async () => {
    const logger = makeLogger();
    const exporter = new RecordingExporter();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    tracer = createAgentTracer(settings({ enabled: false }), {
      exporter,
      logger,
    });
    const fn = vi.fn(async (t: { traceId: string | null }) => ({
      traceId: t.traceId,
      value: 42,
    }));

    const result = await tracer.runInTrace(META, fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ traceId: null, value: 42 });
    expect(tracer.langchainCallbacks({ sessionId: META.sessionId })).toEqual(
      [],
    );
    expect(tracer.status()).toMatchObject({
      langfuse: "disabled_by_config",
      export_errors: 0,
      last_error_at: null,
      capture: "metadata_only",
    });
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(exporter.exportCalls).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("untraced RunTrace.tool and retriever still run fn once and event is a no-op", async () => {
    const logger = makeLogger();
    tracer = createAgentTracer(settings({ enabled: false }), { logger });
    const tool = vi.fn(async () => "tool-result");
    const retriever = vi.fn(async () => "retrieved");

    await tracer.runInTrace(META, async (t) => {
      expect(await t.tool("search", { q: "x" }, tool)).toBe("tool-result");
      expect(await t.retriever("hybrid", { q: "x" }, retriever)).toBe(
        "retrieved",
      );
      t.event("reflection", { ok: false, content: "x" });
      return null;
    });

    expect(tool).toHaveBeenCalledTimes(1);
    expect(retriever).toHaveBeenCalledTimes(1);
  });
});

describe("AgentTracer with keys missing (AC 27)", () => {
  it("does not start the SDK and warns with the variable name only", async () => {
    const logger = makeLogger();
    const exporter = new RecordingExporter();
    tracer = createAgentTracer(settings({ secretKey: "" }), {
      exporter,
      logger,
    });
    const fn = vi.fn(async () => "answer");

    const result = await tracer.runInTrace(META, fn);

    expect(result).toBe("answer");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(tracer.status()).toMatchObject({
      langfuse: "disabled_missing_keys",
      reason: "missing LANGFUSE_SECRET_KEY",
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const warning = String(logger.warn.mock.calls[0][0]);
    expect(warning).toContain("LANGFUSE_SECRET_KEY");
    expect(allLogText(logger)).not.toContain(PUBLIC_VALUE);
    expect(allLogText(logger)).not.toContain(SECRET_VALUE);
    await tracer.flush();
    expect(exporter.exportCalls).toBe(0);
  });

  it("names both variables when both keys are missing", async () => {
    const logger = makeLogger();
    tracer = createAgentTracer(
      settings({ publicKey: undefined, secretKey: "  " }),
      { logger },
    );
    expect(String(logger.warn.mock.calls[0][0])).toContain(
      "LANGFUSE_PUBLIC_KEY",
    );
    expect(String(logger.warn.mock.calls[0][0])).toContain(
      "LANGFUSE_SECRET_KEY",
    );
    expect(tracer.status().langfuse).toBe("disabled_missing_keys");
  });
});

describe("AgentTracer export failures (AC 28)", () => {
  it("returns fn's result unchanged, degrades, then recovers on a later successful export", async () => {
    const logger = makeLogger();
    const exporter = new RecordingExporter();
    exporter.failing = true;
    tracer = createAgentTracer(settings(), { exporter, logger });

    const result = await tracer.runInTrace(META, async () => ANSWER_TEXT);
    expect(result).toBe(ANSWER_TEXT);
    await tracer.flush();

    const degraded = tracer.status();
    expect(degraded.langfuse).toBe("degraded_export_errors");
    expect(degraded.export_errors).toBeGreaterThan(0);
    expect(degraded.last_error_at).not.toBeNull();
    expect(Number.isNaN(Date.parse(degraded.last_error_at ?? ""))).toBe(false);
    expect(logger.warn.mock.calls.length).toBeGreaterThan(0);
    expect(allLogText(logger)).toContain("langfuse export failed");
    expect(allLogText(logger)).not.toContain(SECRET_VALUE);

    exporter.failing = false;
    const second = await tracer.runInTrace(META, async () => "second");
    expect(second).toBe("second");
    await tracer.flush();

    const recovered = tracer.status();
    expect(recovered.langfuse).toBe("enabled");
    expect(recovered.reason).toBeNull();
    expect(recovered.export_errors).toBe(degraded.export_errors);
    expect(recovered.last_error_at).toBe(degraded.last_error_at);
    expect(exporter.spans.length).toBeGreaterThan(0);
  });

  it("logs the startup of an enabled tracer at info with host and capture only", () => {
    const logger = makeLogger();
    tracer = createAgentTracer(settings(), {
      exporter: new RecordingExporter(),
      logger,
    });
    expect(logger.info).toHaveBeenCalledWith(
      `Langfuse tracing enabled: host=${HOST}, capture=metadata_only`,
    );
    expect(tracer.status()).toMatchObject({
      langfuse: "enabled",
      reason: null,
    });
  });
});

describe("agent errors pass through the wrappers (AC 4)", () => {
  it("returns an agent error unchanged, by identity, and calls fn once", async () => {
    const logger = makeLogger();
    tracer = createAgentTracer(settings(), {
      exporter: new RecordingExporter(),
      logger,
    });
    const original = new Error("agent failure");
    const fn = vi.fn(async () => {
      throw original;
    });

    await expect(
      tracer.runInTrace(META, async (t) => t.tool("search", {}, fn)),
    ).rejects.toBe(original);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("trace linking (AC 6)", () => {
  it("builds trace_url only when LANGFUSE_PROJECT_ID is set", async () => {
    const logger = makeLogger();
    tracer = createAgentTracer(settings({ projectId: undefined }), {
      exporter: new RecordingExporter(),
      logger,
    });
    let seenTraceId: string | null | undefined;
    let seenUrl: string | null | undefined;
    await tracer.runInTrace(META, async (t) => {
      seenTraceId = t.traceId;
      seenUrl = t.traceUrl;
    });
    expect(seenTraceId).toMatch(/^[0-9a-f]{32}$/);
    expect(seenUrl).toBeNull();
  });

  it("builds ${LANGFUSE_BASE_URL}/project/${id}/traces/${traceId} when project id is set", async () => {
    const logger = makeLogger();
    tracer = createAgentTracer(settings({ projectId: "proj-abc123" }), {
      exporter: new RecordingExporter(),
      logger,
    });
    let seen: { traceId: string | null; traceUrl: string | null } | undefined;
    await tracer.runInTrace(META, async (t) => {
      seen = { traceId: t.traceId, traceUrl: t.traceUrl };
    });
    expect(seen?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(seen?.traceUrl).toBe(
      `${HOST}/project/proj-abc123/traces/${seen?.traceId}`,
    );
  });
});

describe("span structure and capture privacy (AC 8, AC 30)", () => {
  it("nests tool and retriever spans under the agent run in one trace", async () => {
    const exporter = new RecordingExporter();
    tracer = createAgentTracer(settings({ capture: "full" }), {
      exporter,
      logger: makeLogger(),
    });
    await tracer.runInTrace(META, async (t) => {
      await t.tool("search_articles", { q: "dieu 123" }, async () => ["a1"]);
      await t.retriever("hybrid", { q: "dieu 123" }, async () => ["a1", "a2"]);
      t.event("reflection", { ok: false, content: "tool failed" });
      return null;
    });
    await tracer.flush();

    const byName = (name: string) =>
      exporter.spans.find((s) => s.name === name);
    const agent = byName("agent-run");
    const tool = byName("search_articles");
    const retriever = byName("hybrid");
    expect(agent && tool && retriever).toBeTruthy();
    const traceIds = new Set(
      exporter.spans.map((s) => s.spanContext().traceId),
    );
    expect(traceIds.size).toBe(1);
    expect(tool?.parentSpanContext?.spanId).toBe(agent?.spanContext().spanId);
    expect(retriever?.parentSpanContext?.spanId).toBe(
      agent?.spanContext().spanId,
    );
    expect(exporter.spans.some((s) => s.name === "reflection")).toBe(true);
  });

  it("metadata_only sends no query, tool input, or answer text, and no userId", async () => {
    const exporter = new RecordingExporter();
    tracer = createAgentTracer(settings({ capture: "metadata_only" }), {
      exporter,
      logger: makeLogger(),
    });
    await tracer.runInTrace(META, async (t) => {
      await t.tool("search_articles", { q: TOOL_INPUT_TEXT }, async () => ({
        text: ANSWER_TEXT,
      }));
      return ANSWER_TEXT;
    });
    await tracer.flush();

    const everything = JSON.stringify(
      exporter.spans.map((s) => ({ n: s.name, a: s.attributes })),
    );
    expect(everything).not.toContain("0912345678");
    expect(everything).not.toContain("Dieu 123");
    expect(everything).not.toContain(TOOL_INPUT_TEXT);
    expect(everything).not.toContain(ANSWER_TEXT);
    expect(everything).not.toContain(META.userId ?? "");
    expect(everything).toContain("[redacted]");
    expect(everything).toContain(META.runId);
  });

  it("masked redacts a phone number and a 12-digit ID in the query before export", async () => {
    const exporter = new RecordingExporter();
    tracer = createAgentTracer(settings({ capture: "masked" }), {
      exporter,
      logger: makeLogger(),
    });
    const query = "so 0912345678 va CCCD 012345678901, mail a.b@example.com";
    await tracer.runInTrace({ ...META, query }, async () => null);
    await tracer.flush();

    const agent = exporter.spans.find((s) => s.name === "agent-run");
    const input = String(
      agent?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_INPUT] ?? "",
    );
    expect(input).toContain("[phone]");
    expect(input).toContain("[id]");
    expect(input).not.toContain("0912345678");
    expect(input).not.toContain("012345678901");
    expect(input).not.toContain("a.b@example.com");
  });

  it("never emits generation observations from the tracer itself (AC 8)", async () => {
    const exporter = new RecordingExporter();
    tracer = createAgentTracer(settings({ capture: "full" }), {
      exporter,
      logger: makeLogger(),
    });
    await tracer.runInTrace(META, async (t) => {
      await t.tool("search_articles", {}, async () => "x");
      await t.retriever("hybrid", {}, async () => "y");
      t.event("error", { ok: false, content: "z" });
      return null;
    });
    await tracer.flush();

    const types = exporter.spans.map(
      (s) => s.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE],
    );
    expect(types).not.toContain("generation");
    expect(types.length).toBeGreaterThan(0);
  });
});

describe("bounded shutdown (AC 31)", () => {
  it("logs 'langfuse shutdown ok' after a clean shutdown", async () => {
    const logger = makeLogger();
    tracer = createAgentTracer(settings(), {
      exporter: new RecordingExporter(),
      logger,
    });
    await tracer.shutdown(2000);
    expect(logger.info).toHaveBeenCalledWith("langfuse shutdown ok");
  });

  it("resolves within the timeout when sdk.shutdown hangs, and names the wait", async () => {
    const logger = makeLogger();
    const exporter = new RecordingExporter();
    exporter.hangOnShutdown = true;
    tracer = createAgentTracer(settings(), { exporter, logger });
    const started = Date.now();

    await tracer.shutdown(150);

    expect(Date.now() - started).toBeLessThan(2000);
    const warning = logger.warn.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes("shutdown"));
    expect(warning).toContain("did not finish within 150 ms");
    expect(warning).toContain("waited");
    tracer = undefined;
  });

  it("rejects a non-positive timeout instead of waiting forever", async () => {
    tracer = createAgentTracer(settings({ enabled: false }), {
      logger: makeLogger(),
    });
    await expect(tracer.shutdown(0)).rejects.toThrow(RangeError);
  });
});

describe("LANGFUSE_SAMPLE_RATE is refused when invalid (R9-05)", () => {
  it.each([Number.NaN, -0.1, 1.5, Number.POSITIVE_INFINITY])(
    "throws at construction naming the variable for %s, and starts no SDK",
    (sampleRate) => {
      const exporter = new RecordingExporter();
      expect(() =>
        createAgentTracer(settings({ sampleRate }), {
          exporter,
          logger: makeLogger(),
        }),
      ).toThrow(/LANGFUSE_SAMPLE_RATE must be a number between 0 and 1/);
      expect(exporter.exportCalls).toBe(0);
    },
  );

  it.each([0, 0.5, 1])("accepts %s and starts normally", async (sampleRate) => {
    const logger = makeLogger();
    tracer = createAgentTracer(settings({ sampleRate }), {
      exporter: new RecordingExporter(),
      logger,
    });
    expect(tracer.status()).toMatchObject({ langfuse: "enabled" });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
