import type { AgentTracer } from "../agent/contract";
import {
  ObservabilityTracer,
  type LangfuseSettings,
  type TracerDeps,
} from "./tracer";

export const PROBE_TIMEOUT_MS = 3000;

export interface StartDeps extends TracerDeps {
  // Replaces the startup probe. Tests inject one; production uses probeLangfuse.
  probe?: (settings: LangfuseSettings) => Promise<void>;
}

// Call first in server.ts, before Fastify and the runner are built (plan §5.8 item 1).
// Resolves after the startup probe. The probe is warn-only: a failure is counted and
// logged, and the server still starts.
export async function startObservation(
  config: LangfuseSettings,
  deps: StartDeps = {},
): Promise<AgentTracer> {
  const tracer = new ObservabilityTracer(config, deps);
  await tracer.runStartupProbe(() => (deps.probe ?? probeLangfuse)(config));
  return tracer;
}

// One authenticated GET to the Langfuse public API, with a 3 s timeout. A non-2xx
// status (401 for a wrong key) or a network error throws.
export async function probeLangfuse(
  settings: LangfuseSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const publicKey = settings.publicKey?.trim();
  const secretKey = settings.secretKey?.trim();
  if (!publicKey || !secretKey) {
    throw new Error("probe needs LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY");
  }
  const base = settings.baseUrl.replace(/\/+$/, "");
  const basic = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  const response = await fetchImpl(`${base}/api/public/projects`, {
    headers: { Authorization: `Basic ${basic}` },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  // The body is not used. Cancel it so the socket is released.
  await response.body?.cancel();
  if (!response.ok) {
    throw new Error(
      `Langfuse API answered HTTP ${response.status} to the startup probe`,
    );
  }
}
