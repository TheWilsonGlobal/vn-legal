import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

// The Langfuse span processor swallows export errors after logging them (A16), so the
// tracer cannot see them. This wrapper reports every export result to a sink, which
// keeps export_errors and the degraded state honest.
export interface ExportOutcomeSink {
  onSuccess(): void;
  onFailure(error: unknown): void;
}

export class CountingSpanExporter implements SpanExporter {
  constructor(
    private readonly inner: SpanExporter,
    private readonly sink: ExportOutcomeSink,
  ) {}

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    let settled = false;
    const settle = (result: ExportResult): void => {
      if (settled) return;
      settled = true;
      if (result.code === ExportResultCode.SUCCESS) {
        this.sink.onSuccess();
      } else {
        this.sink.onFailure(result.error ?? new Error("span export failed"));
      }
      resultCallback(result);
    };
    try {
      this.inner.export(spans, settle);
    } catch (error) {
      settle({ code: ExportResultCode.FAILED, error: toError(error) });
    }
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

export interface OtlpSettings {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
}

// Same endpoint and auth headers that @langfuse/otel uses by default. Built here
// because passing our own exporter replaces the processor's default one, and the
// default is the only place a failed export would otherwise be invisible.
export function buildOtlpExporter(settings: OtlpSettings): SpanExporter {
  const base = settings.baseUrl.replace(/\/+$/, "");
  const basic = Buffer.from(
    `${settings.publicKey}:${settings.secretKey}`,
  ).toString("base64");
  return new OTLPTraceExporter({
    url: `${base}/api/public/otel/v1/traces`,
    headers: {
      Authorization: `Basic ${basic}`,
      "x-langfuse-public-key": settings.publicKey,
      "x-langfuse-ingestion-version": "4",
    },
    timeoutMillis: 5000,
  });
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
