import { afterEach, describe, expect, it, vi } from "vitest";
import {
  probeLangfuse,
  startObservation,
} from "../../../src/observability/langfuse";
import type { LangfuseSettings } from "../../../src/observability/tracer";
import type { AgentTracer } from "../../../src/agent/contract";
import { RecordingExporter, allLogText, makeLogger } from "./fake-exporter";

const PUBLIC_VALUE = "pk-test-PUBLIC-VALUE-0002";
const SECRET_VALUE = "sk-test-SECRET-VALUE-0002";
const HOST = "https://langfuse.invalid";

function settings(over: Partial<LangfuseSettings> = {}): LangfuseSettings {
  return {
    enabled: true,
    publicKey: PUBLIC_VALUE,
    secretKey: SECRET_VALUE,
    baseUrl: HOST,
    capture: "metadata_only",
    sampleRate: 1,
    ...over,
  };
}

let tracer: AgentTracer | undefined;

afterEach(async () => {
  if (tracer) await tracer.shutdown(2000);
  tracer = undefined;
  vi.restoreAllMocks();
});

describe("startObservation (plan §5.8 item 1 and item 5)", () => {
  it("disabled by config: no probe, no SDK, one info log", async () => {
    const logger = makeLogger();
    const probe = vi.fn(async () => {});
    tracer = await startObservation(settings({ enabled: false }), {
      logger,
      probe,
    });
    expect(probe).not.toHaveBeenCalled();
    expect(tracer.status().langfuse).toBe("disabled_by_config");
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it("enabled and probe succeeds: status enabled, no warn", async () => {
    const logger = makeLogger();
    const probe = vi.fn(async () => {});
    tracer = await startObservation(settings(), {
      logger,
      probe,
      exporter: new RecordingExporter(),
    });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(tracer.status()).toMatchObject({
      langfuse: "enabled",
      export_errors: 0,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("enabled and probe fails: warn logged, status degraded, server still starts", async () => {
    const logger = makeLogger();
    const probe = vi.fn(async () => {
      throw new Error("Langfuse API answered HTTP 401 to the startup probe");
    });
    tracer = await startObservation(settings(), {
      logger,
      probe,
      exporter: new RecordingExporter(),
    });
    expect(tracer.status()).toMatchObject({
      langfuse: "degraded_export_errors",
      export_errors: 1,
    });
    expect(tracer.status().last_error_at).not.toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(allLogText(logger)).not.toContain(SECRET_VALUE);
  });

  it("missing keys: probe is never called", async () => {
    const logger = makeLogger();
    const probe = vi.fn(async () => {});
    tracer = await startObservation(settings({ publicKey: "" }), {
      logger,
      probe,
    });
    expect(probe).not.toHaveBeenCalled();
    expect(tracer.status().langfuse).toBe("disabled_missing_keys");
  });
});

describe("probeLangfuse (A15: authenticated startup probe, injected fetch)", () => {
  it("sends Basic auth to /api/public/projects with a timeout signal and resolves on 2xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await probeLangfuse(settings(), fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${HOST}/api/public/projects`);
    const expected = `Basic ${Buffer.from(`${PUBLIC_VALUE}:${SECRET_VALUE}`).toString("base64")}`;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      expected,
    );
    expect(init.signal).toBeDefined();
  });

  it("throws on 401 with the status only, not the key", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("denied", { status: 401 }),
    );
    const failure = probeLangfuse(
      settings(),
      fetchImpl as unknown as typeof fetch,
    );
    await expect(failure).rejects.toThrow("HTTP 401");
    await expect(failure).rejects.not.toThrow(SECRET_VALUE);
  });

  it("propagates a network error (dead host)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      probeLangfuse(
        settings({ baseUrl: "http://127.0.0.1:5998" }),
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow("fetch failed");
  });
});
