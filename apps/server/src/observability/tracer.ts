import { trace } from "@opentelemetry/api";
import { CallbackHandler } from "@langfuse/langchain";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  getActiveTraceId,
  propagateAttributes,
  startActiveObservation,
  startObservation,
} from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  AlwaysOnSampler,
  TraceIdRatioBasedSampler,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import type {
  AgentTracer,
  ObservabilityStatus,
  RunTrace,
} from "../agent/contract";
import { logger as defaultLogger } from "../shared/logger";
import {
  CountingSpanExporter,
  buildOtlpExporter,
  describeError,
} from "./exporter";
import { maskPayload, type CaptureMode } from "./mask";

export interface LangfuseSettings {
  enabled: boolean;
  publicKey?: string;
  secretKey?: string;
  baseUrl: string;
  capture: CaptureMode;
  projectId?: string;
  sampleRate: number;
  environment?: string;
}

export interface TracerLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
}

export interface TracerDeps {
  // Replaces the OTLP exporter. Tests inject one; production leaves it unset.
  exporter?: SpanExporter;
  logger?: TracerLogger;
}

export interface RunMeta {
  runId: string;
  sessionId: string;
  userId?: string;
  query: string;
  toolMode: string;
}

type Handle = {
  update(attributes: { input?: unknown; output?: unknown }): unknown;
};

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function settle<T>(fn: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

export function traceUrlFor(
  settings: Pick<LangfuseSettings, "baseUrl" | "projectId">,
  traceId: string | null,
): string | null {
  if (!settings.projectId || !traceId) return null;
  const base = settings.baseUrl.replace(/\/+$/, "");
  return `${base}/project/${encodeURIComponent(settings.projectId)}/traces/${encodeURIComponent(traceId)}`;
}

// Used when tracing is off: fn runs directly and nothing is recorded.
class UntracedRun implements RunTrace {
  traceId: string | null = null;
  traceUrl: string | null = null;
  tool<T>(_name: string, _input: unknown, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
  retriever<T>(
    _name: string,
    _input: unknown,
    fn: () => Promise<T>,
  ): Promise<T> {
    return fn();
  }
  event(_name: string, _data: { ok: boolean; content: string }): void {}
}

class TracedRun implements RunTrace {
  traceId: string | null = null;
  traceUrl: string | null = null;
  constructor(private readonly owner: ObservabilityTracer) {}
  tool<T>(name: string, input: unknown, fn: () => Promise<T>): Promise<T> {
    return this.owner.observe("tool", name, input, fn);
  }
  retriever<T>(name: string, input: unknown, fn: () => Promise<T>): Promise<T> {
    return this.owner.observe("retriever", name, input, fn);
  }
  event(name: string, data: { ok: boolean; content: string }): void {
    this.owner.event(name, data);
  }
}

// Implements the AgentTracer port (contract.ts) over Langfuse Cloud via OpenTelemetry.
//
// Fail-open (plan §5.8 item 5): export and tracing failures are counted and logged
// at warn, and the agent run continues. A tracing error never changes the result or
// error of the agent call, and fn is never invoked twice.
export class ObservabilityTracer implements AgentTracer {
  private readonly logger: TracerLogger;
  private sdk: NodeSDK | null = null;
  private processor: LangfuseSpanProcessor | null = null;
  private finished: Promise<"ok" | "failed"> | null = null;
  private missingKeys: string[] = [];
  private exportErrors = 0;
  private lastErrorAt: string | null = null;
  private degraded = false;

  constructor(
    private readonly config: LangfuseSettings,
    deps: TracerDeps,
  ) {
    this.logger = deps.logger ?? defaultLogger;
    if (!config.enabled) {
      this.logger.info(
        "Langfuse tracing disabled by config (LANGFUSE_ENABLED is not true)",
      );
      return;
    }
    // R9-05: an out-of-range rate reached TraceIdRatioBasedSampler as NaN or a negative
    // number and dropped every span. Refuse it here; never clamp it silently.
    if (
      !Number.isFinite(config.sampleRate) ||
      config.sampleRate < 0 ||
      config.sampleRate > 1
    ) {
      throw new RangeError(
        `LANGFUSE_SAMPLE_RATE must be a number between 0 and 1 (got ${String(config.sampleRate)})`,
      );
    }
    const publicKey = config.publicKey?.trim();
    const secretKey = config.secretKey?.trim();
    if (!publicKey || !secretKey) {
      this.missingKeys = [
        ...(publicKey ? [] : ["LANGFUSE_PUBLIC_KEY"]),
        ...(secretKey ? [] : ["LANGFUSE_SECRET_KEY"]),
      ];
      this.logger.warn(
        `LANGFUSE_ENABLED=true but ${this.missingKeys.join(" and ")} is not set; Langfuse tracing is off for this run`,
      );
      return;
    }

    const exporter = new CountingSpanExporter(
      deps.exporter ??
        buildOtlpExporter({ baseUrl: config.baseUrl, publicKey, secretKey }),
      {
        onSuccess: () => this.recordExportSuccess(),
        onFailure: (error) => this.recordFailure("export", error),
      },
    );
    this.processor = new LangfuseSpanProcessor({
      exporter,
      mask: ({ data }) => maskPayload(data, config.capture),
      environment: config.environment,
    });
    this.sdk = new NodeSDK({
      serviceName: "vn-legal-server",
      autoDetectResources: false,
      sampler:
        config.sampleRate >= 1
          ? new AlwaysOnSampler()
          : new TraceIdRatioBasedSampler(config.sampleRate),
      spanProcessors: [this.processor],
    });
    this.sdk.start();
    this.logger.info(
      `Langfuse tracing enabled: host=${config.baseUrl}, capture=${config.capture}`,
    );
  }

  status(): ObservabilityStatus {
    const base = {
      capture: this.config.capture,
      export_errors: this.exportErrors,
      last_error_at: this.lastErrorAt,
    };
    if (!this.config.enabled) {
      return {
        langfuse: "disabled_by_config",
        reason: "LANGFUSE_ENABLED is not true",
        ...base,
      };
    }
    if (!this.sdk) {
      return {
        langfuse: "disabled_missing_keys",
        reason: `missing ${this.missingKeys.join(", ")}`,
        ...base,
      };
    }
    if (this.degraded) {
      return {
        langfuse: "degraded_export_errors",
        reason: "last export failed; spans may be dropped until one succeeds",
        ...base,
      };
    }
    return { langfuse: "enabled", reason: null, ...base };
  }

  async runInTrace<T>(
    meta: RunMeta,
    fn: (t: RunTrace) => Promise<T>,
  ): Promise<T> {
    if (!this.sdk) return fn(new UntracedRun());
    const run = new TracedRun(this);
    return this.guarded(
      "agent-run",
      () => fn(run),
      (body) =>
        propagateAttributes(
          {
            sessionId: meta.sessionId,
            traceName: "vn-legal-agent",
            tags: [meta.toolMode],
            metadata: { run_id: meta.runId },
          },
          () =>
            startActiveObservation(
              "agent-run",
              async (span) => {
                this.attachTrace(run);
                span.update(this.captured({ input: { query: meta.query } }));
                await body(span);
              },
              { asType: "agent" },
            ),
        ),
      false,
    );
  }

  // Only CallbackHandler creates generation observations; this method never does.
  // userId is accepted by the port and deliberately not forwarded (plan §5.8 item 2).
  langchainCallbacks(meta: { sessionId: string; userId?: string }): unknown[] {
    if (!this.sdk) return [];
    return [new CallbackHandler({ sessionId: meta.sessionId })];
  }

  async shutdown(timeoutMs: number): Promise<void> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError("shutdown timeoutMs must be a positive number");
    }
    if (!this.sdk) return;
    const sdk = this.sdk;
    this.finished ??= sdk.shutdown().then(
      () => "ok" as const,
      (error: unknown) => {
        this.logger.warn(`langfuse shutdown failed: ${describeError(error)}`);
        return "failed" as const;
      },
    );
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const outcome = await Promise.race([this.finished, timedOut]);
    clearTimeout(timer);
    // Spans created after shutdown must not reach a provider that has stopped.
    trace.disable();
    if (outcome === "ok") {
      this.logger.info("langfuse shutdown ok");
    } else if (outcome === "timeout") {
      this.logger.warn(
        `langfuse shutdown did not finish within ${timeoutMs} ms (waited ${Date.now() - started} ms); continuing without the export queue`,
      );
    }
  }

  // Forces the batch queue out. Used by tests and by the eval runner before exit.
  async flush(): Promise<void> {
    if (!this.processor) return;
    const before = this.exportErrors;
    await this.processor.forceFlush().catch((error: unknown) => {
      // An export failure has already been counted by CountingSpanExporter. Count
      // only a rejection that nothing else recorded.
      if (this.exportErrors === before) this.recordFailure("flush", error);
    });
  }

  // Startup probe (plan §5.8 item 5). Runs only when tracing started. A failure is
  // counted as an export error, logged at warn, and leaves the run going.
  async runStartupProbe(probe: () => Promise<void>): Promise<void> {
    if (!this.sdk) return;
    try {
      await probe();
    } catch (error) {
      this.recordFailure("startup probe", error);
    }
  }

  // Called by TracedRun. Not part of the AgentTracer port.
  async observe<T>(
    kind: "tool" | "retriever",
    name: string,
    input: unknown,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!this.sdk) return fn();
    return this.guarded(
      name,
      fn,
      (body) => {
        const enter = async (span: Handle): Promise<void> => {
          span.update(this.captured({ input }));
          await body(span);
        };
        return kind === "tool"
          ? startActiveObservation(name, enter, { asType: "tool" })
          : startActiveObservation(name, enter, { asType: "retriever" });
      },
      true,
    );
  }

  // Called by TracedRun. Not part of the AgentTracer port.
  event(name: string, data: { ok: boolean; content: string }): void {
    if (!this.sdk) return;
    try {
      startObservation(
        name,
        {
          level: data.ok ? "DEFAULT" : "ERROR",
          metadata: { ok: data.ok },
          ...this.captured({ output: data.content }),
        },
        { asType: "event" },
      ).end();
    } catch (error) {
      this.recordFailure(`event ${name}`, error);
    }
  }

  private captured(fields: { input?: unknown; output?: unknown }): {
    input?: unknown;
    output?: unknown;
  } {
    return this.config.capture === "metadata_only" ? {} : fields;
  }

  private attachTrace(run: TracedRun): void {
    const traceId = getActiveTraceId() ?? null;
    run.traceId = traceId;
    run.traceUrl = trace.getActiveSpan()?.isRecording()
      ? traceUrlFor(this.config, traceId)
      : null;
  }

  // Runs fn exactly once and returns or rethrows its outcome unchanged. Errors raised
  // by the tracing wrapper are logged and counted. If they happen before fn starts,
  // fn runs untraced. If they happen after fn settles, fn's outcome is still returned.
  private async guarded<T>(
    label: string,
    fn: () => Promise<T>,
    open: (body: (handle: Handle) => Promise<void>) => Promise<unknown>,
    recordOutput: boolean,
  ): Promise<T> {
    const state: { entered: boolean; settled?: Settled<T> } = {
      entered: false,
    };
    const body = async (handle: Handle): Promise<void> => {
      state.entered = true;
      const outcome = await settle(fn);
      state.settled = outcome;
      // Outside the settle() call on purpose: a failure here is a tracing error.
      if (outcome.ok === true && recordOutput) {
        handle.update({ output: outcome.value });
      }
    };
    try {
      await open(body);
    } catch (error) {
      this.recordFailure(label, error);
      if (!state.entered) return fn();
    }
    // R9-03: the opener resolved without calling the body, so fn has not run. Run it
    // here, once, and record the failure. Without this, the wrapper threw a
    // "closed before the call finished" error for a call that never started.
    if (!state.entered) {
      this.recordFailure(
        label,
        new Error("observation opened but its body was never called"),
      );
      return fn();
    }
    const settled = state.settled;
    if (settled === undefined) {
      throw new Error(
        `langfuse ${label}: observation closed before the call finished`,
      );
    }
    // Explicit comparison: truthiness does not narrow the union without strictNullChecks.
    if (settled.ok === true) return settled.value;
    throw settled.error;
  }

  private recordFailure(where: string, error: unknown): void {
    this.exportErrors += 1;
    this.lastErrorAt = new Date().toISOString();
    this.degraded = true;
    this.logger.warn(
      `langfuse ${where} failed: ${describeError(error)}; the agent run continues and its Langfuse data may be incomplete`,
    );
  }

  private recordExportSuccess(): void {
    if (!this.degraded) return;
    this.degraded = false;
    this.logger.info("langfuse export recovered");
  }
}

// Returns a tracer that is either live or explicitly disabled. Starts the SDK when
// tracing is on. Does not run the startup probe; startObservation does that.
export function createAgentTracer(
  config: LangfuseSettings,
  deps: TracerDeps = {},
): ObservabilityTracer {
  return new ObservabilityTracer(config, deps);
}
