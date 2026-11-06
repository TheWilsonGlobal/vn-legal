import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentTracer, type RunMeta } from "../../../src/observability";
import type { ObservabilityTracer } from "../../../src/observability";
import { RecordingExporter, makeLogger } from "./fake-exporter";

// Forces the tracing layer to throw around one named observation. Everything else
// delegates to the real @langfuse/tracing, so the spans are still real.
const control = vi.hoisted(() => ({
  mode: "none" as "none" | "throw-before" | "throw-after" | "resolve-silent",
  target: "agent-run" as string,
}));

vi.mock("@langfuse/tracing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langfuse/tracing")>();
  return {
    ...actual,
    startActiveObservation: (
      name: string,
      fn: (obs: any) => any,
      opts: any,
    ) => {
      const hit = control.mode !== "none" && control.target === name;
      if (hit && control.mode === "throw-before") {
        throw new Error(`tracing boom before ${name}`);
      }
      // The opener resolves but never calls fn (R9-03).
      if (hit && control.mode === "resolve-silent") {
        return Promise.resolve(undefined);
      }
      if (hit && control.mode === "throw-after") {
        return actual.startActiveObservation(
          name,
          async (obs: any) => {
            await fn(obs);
            throw new Error(`tracing boom after ${name}`);
          },
          opts,
        );
      }
      return actual.startActiveObservation(name, fn, opts);
    },
  };
});

const META: RunMeta = {
  runId: "run-wrap",
  sessionId: "sess-wrap",
  query: "cau hoi thu nghiem",
  toolMode: "local",
};

const SETTINGS = {
  enabled: true,
  publicKey: "pk-test-PUBLIC-VALUE-0003",
  secretKey: "sk-test-SECRET-VALUE-0003",
  baseUrl: "https://langfuse.invalid",
  capture: "metadata_only" as const,
  sampleRate: 1,
};

let tracer: ObservabilityTracer | undefined;

afterEach(async () => {
  control.mode = "none";
  if (tracer) await tracer.shutdown(2000);
  tracer = undefined;
});

describe("tracing errors around the agent call (AC 4)", () => {
  it("throw before the agent-run starts: fn runs exactly once and its result is returned", async () => {
    control.mode = "throw-before";
    control.target = "agent-run";
    const logger = makeLogger();
    tracer = createAgentTracer(SETTINGS, {
      exporter: new RecordingExporter(),
      logger,
    });
    const fn = vi.fn(async () => "agent-answer");

    const result = await tracer.runInTrace(META, fn);

    expect(result).toBe("agent-answer");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(tracer.status()).toMatchObject({
      langfuse: "degraded_export_errors",
    });
    expect(tracer.status().export_errors).toBe(1);
    expect(String(logger.warn.mock.calls[0][0])).toContain(
      "langfuse agent-run failed",
    );
  });

  it("opener resolves without calling the agent body: fn runs exactly once, failure counted and logged (R9-03)", async () => {
    control.mode = "resolve-silent";
    control.target = "agent-run";
    const logger = makeLogger();
    tracer = createAgentTracer(SETTINGS, {
      exporter: new RecordingExporter(),
      logger,
    });
    const fn = vi.fn(async () => "agent-answer");

    const result = await tracer.runInTrace(META, fn);

    expect(result).toBe("agent-answer");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(tracer.status()).toMatchObject({
      langfuse: "degraded_export_errors",
    });
    expect(tracer.status().export_errors).toBe(1);
    expect(String(logger.warn.mock.calls[0][0])).toContain(
      "langfuse agent-run failed",
    );
  });

  it("opener resolves without calling a tool body: the tool runs exactly once and its error reaches the agent (R9-03)", async () => {
    control.mode = "resolve-silent";
    control.target = "search_articles";
    const logger = makeLogger();
    tracer = createAgentTracer(SETTINGS, {
      exporter: new RecordingExporter(),
      logger,
    });
    const original = new Error("tool failure");
    const tool = vi.fn(async () => {
      throw original;
    });

    await expect(
      tracer.runInTrace(META, async (t) => t.tool("search_articles", {}, tool)),
    ).rejects.toBe(original);
    expect(tool).toHaveBeenCalledTimes(1);
    expect(tracer.status().export_errors).toBe(1);
  });

  it("throw after the agent settled: the agent's result is returned, not the tracing error", async () => {
    control.mode = "throw-after";
    control.target = "agent-run";
    const logger = makeLogger();
    tracer = createAgentTracer(SETTINGS, {
      exporter: new RecordingExporter(),
      logger,
    });
    const fn = vi.fn(async () => "agent-answer");

    const result = await tracer.runInTrace(META, fn);

    expect(result).toBe("agent-answer");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(tracer.status().export_errors).toBe(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("throw before a tool starts: the tool runs exactly once and its result is returned", async () => {
    control.mode = "throw-before";
    control.target = "search_articles";
    const logger = makeLogger();
    tracer = createAgentTracer(SETTINGS, {
      exporter: new RecordingExporter(),
      logger,
    });
    const tool = vi.fn(async () => ["article-1"]);

    const result = await tracer.runInTrace(META, async (t) =>
      t.tool("search_articles", {}, tool),
    );

    expect(result).toEqual(["article-1"]);
    expect(tool).toHaveBeenCalledTimes(1);
    expect(tracer.status().export_errors).toBe(1);
  });

  it("throw after a tool settled: the tool's result is returned and the agent continues", async () => {
    control.mode = "throw-after";
    control.target = "search_articles";
    const logger = makeLogger();
    tracer = createAgentTracer(SETTINGS, {
      exporter: new RecordingExporter(),
      logger,
    });
    const tool = vi.fn(async () => "hits");

    const result = await tracer.runInTrace(META, async (t) => {
      const hits = await t.tool("search_articles", {}, tool);
      return `agent saw ${hits}`;
    });

    expect(result).toBe("agent saw hits");
    expect(tool).toHaveBeenCalledTimes(1);
    expect(tracer.status().export_errors).toBe(1);
  });

  it("a tool's own error still reaches the agent by identity when tracing also fails", async () => {
    control.mode = "throw-after";
    control.target = "search_articles";
    const logger = makeLogger();
    tracer = createAgentTracer(SETTINGS, {
      exporter: new RecordingExporter(),
      logger,
    });
    const original = new Error("tool failure");
    const tool = vi.fn(async () => {
      throw original;
    });

    const failure = tracer.runInTrace(META, async (t) =>
      t.tool("search_articles", {}, tool),
    );

    await expect(failure).rejects.toBe(original);
    expect(tool).toHaveBeenCalledTimes(1);
  });
});
