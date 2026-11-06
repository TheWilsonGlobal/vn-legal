import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { vi } from "vitest";

// Injected in place of the OTLP exporter. It never opens a connection. Spans are kept
// in memory so tests can inspect what Langfuse would have received. Failure is a
// simulated 401 or dead host: the export callback reports FAILED, as OTLP does.
export class RecordingExporter implements SpanExporter {
  readonly spans: ReadableSpan[] = [];
  exportCalls = 0;
  failing = false;
  hangOnShutdown = false;

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    this.exportCalls += 1;
    if (this.failing) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: new Error("simulated export failure (HTTP 401 Unauthorized)"),
      });
      return;
    }
    this.spans.push(...spans);
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  shutdown(): Promise<void> {
    return this.hangOnShutdown
      ? new Promise<void>(() => {})
      : Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

export function makeLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

export function allLogText(logger: ReturnType<typeof makeLogger>): string {
  return [...logger.info.mock.calls, ...logger.warn.mock.calls]
    .map((args) => args.map(String).join(" "))
    .join("\n");
}
