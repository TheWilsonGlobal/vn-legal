// ============================================================================
// Embedding key rotation (server path). When the primary Gemini embedding key is
// over quota (HTTP 429 RESOURCE_EXHAUSTED), the same call is retried on the next
// configured key instead of failing the user's question. Only quota errors rotate:
// an invalid or unbilled key still fails, so a bad key is not hidden.
// ============================================================================

import logger from "../shared/logger";

/** Methods of IEmbedder that call the Gemini API and so may hit the quota. */
const RATED_METHODS = new Set([
  "embed",
  "embedBatch",
  "embedArticle",
  "embedClause",
  "embedArticleClauses",
  "embedDocuments",
]);

export function isQuotaError(err: unknown): boolean {
  const status = (err as { httpStatus?: unknown } | null)?.httpStatus;
  if (status === 429) return true;
  const text = err instanceof Error ? `${err.message}` : String(err);
  return /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(text);
}

/** A key Google refuses outright (invalid, revoked, or without access such as billing). */
export function isKeyRejected(err: unknown): boolean {
  const status = (err as { httpStatus?: unknown } | null)?.httpStatus;
  if (status === 401 || status === 403) return true;
  const text = err instanceof Error ? `${err.message}` : String(err);
  return /API key not valid|API_KEY_INVALID|PERMISSION_DENIED|HTTP 40[13]\b/i.test(text);
}

/** Errors that move the call to the next key. Anything else fails at once. */
function shouldRotate(err: unknown): boolean {
  return isQuotaError(err) || isKeyRejected(err);
}

/**
 * Wraps the primary embedder. `fallbacks` are embedders built with other API keys,
 * tried in order when the primary (and each earlier fallback) reports a quota error.
 */
export function withKeyRotation<T extends object>(
  primary: T,
  fallbacks: object[],
): T {
  if (fallbacks.length === 0) return primary;
  const chain = [primary, ...fallbacks] as Array<Record<string, any>>;

  async function callWithRotation(method: string, args: unknown[]) {
    let lastError: unknown;
    for (let i = 0; i < chain.length; i += 1) {
      const target = chain[i];
      try {
        return await target[method](...args);
      } catch (err) {
        lastError = err;
        if (!shouldRotate(err) || i === chain.length - 1) throw err;
        logger.warn(
          `Gemini embedding key ${i + 1} ${isQuotaError(err) ? "is over quota" : "was rejected"}; trying key ${i + 2} (${method})`,
        );
      }
    }
    throw lastError;
  }

  return new Proxy(primary, {
    get(target, prop) {
      const name = String(prop);
      if (RATED_METHODS.has(name)) {
        return (...args: unknown[]) => callWithRotation(name, args);
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
