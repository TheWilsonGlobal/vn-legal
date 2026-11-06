// BL1 helpers: the legacy /api/consult precondition and result parsing. Pure.

import type { RunError } from "./types";

/** Value of NAME from the process env, else from the text of a .env file; null when unset or empty. */
export function effectiveEnv(
  name: string,
  env: Record<string, string | undefined>,
  dotenvText: string | null,
): string | null {
  const fromProcess = env[name];
  if (fromProcess !== undefined && fromProcess.trim() !== "")
    return fromProcess.trim();
  if (dotenvText === null) return null;
  for (const line of dotenvText.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line,
    );
    if (!m || m[1] !== name) continue;
    const v = m[2]
      .replace(/\s+#.*$/, "")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (v !== "") return v;
  }
  return null;
}

export interface LegacyPrecondition {
  llm_provider: string | null;
  llm_api_url_host: string | null; // host only, never the full URL
}

/**
 * Plan BL1: before calling /api/consult, assert LLM_API_URL is unset or points at Google
 * (A26) and the legacy provider is gemini. Otherwise legacy would call a dead :5814 and
 * score as errors. Throws with the named cause.
 */
export function assertLegacyPrecondition(
  env: Record<string, string | undefined>,
  dotenvText: string | null,
): LegacyPrecondition {
  const provider = effectiveEnv("LLM_PROVIDER", env, dotenvText);
  if (provider !== "gemini")
    throw new Error(
      `BL1 precondition failed: LLM_PROVIDER must be "gemini" for the legacy pipeline to use the same chat model, got ${JSON.stringify(provider)}`,
    );
  const url = effectiveEnv("LLM_API_URL", env, dotenvText);
  if (url === null) return { llm_provider: provider, llm_api_url_host: null };
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(
      "BL1 precondition failed: LLM_API_URL is set but is not a URL",
    );
  }
  if (host !== "googleapis.com" && !host.endsWith(".googleapis.com"))
    throw new Error(
      `BL1 precondition failed: LLM_API_URL points at ${host}, not Google; legacy calls would not reach the same model. Unset LLM_API_URL.`,
    );
  return { llm_provider: provider, llm_api_url_host: host };
}

/** The legacy template answer starts with these headings (setup.ts templateResponse). */
export function isTemplateFallback(answer: string): boolean {
  return (
    answer.includes("# Tư vấn pháp luật dân sự") &&
    answer.includes("## 1. Pháp luật áp dụng")
  );
}

export type LegacyParse =
  | { ok: true; cited_articles: number[] }
  | { ok: false; error: RunError };

/** Parse a 200 /api/consult body. A template-fallback answer or a missing LLM trace is an error. */
export function parseLegacyBody(body: unknown): LegacyParse {
  const b = body as {
    context?: {
      seed_articles?: { article_number?: number }[];
      path_context?: { article_number?: number }[];
    };
    response?: unknown;
    llmDetails?: { output?: unknown };
  } | null;
  if (
    !b ||
    typeof b !== "object" ||
    !b.context ||
    typeof b.response !== "string"
  )
    return {
      ok: false,
      error: {
        kind: "bad_response",
        detail: "legacy body lacks context/response",
      },
    };
  if (
    !b.llmDetails ||
    isTemplateFallback(b.response) ||
    (typeof b.llmDetails.output === "string" &&
      isTemplateFallback(b.llmDetails.output))
  )
    return {
      ok: false,
      error: {
        kind: "legacy_template_fallback",
        detail: "legacy answer is the template fallback (LLM did not answer)",
      },
    };
  const nums = new Set<number>();
  for (const a of [
    ...(b.context.seed_articles ?? []),
    ...(b.context.path_context ?? []),
  ])
    if (typeof a.article_number === "number") nums.add(a.article_number);
  return { ok: true, cited_articles: [...nums] };
}
