import { capTokens, countTokens } from "./tokens";

/** Plan default (MAX_OBSERVATION_TOKENS, §5.5). Callers pass the configured value. */
export const MAX_OBSERVATION_TOKENS = 6000;

const TRUNCATION_MARK = "\n[truncated]";
const MIN_OBSERVATION_LIMIT = 4;

/**
 * Cuts one tool observation to at most `maxTokens` (countTokens method).
 * Text that already fits is returned unchanged. Text that is cut ends with a
 * `[truncated]` mark, and the mark counts toward the limit.
 */
export function capObservation(text: string, maxTokens: number): string {
  if (!Number.isInteger(maxTokens) || maxTokens < MIN_OBSERVATION_LIMIT) {
    throw new RangeError(
      `maxTokens must be an integer >= ${MIN_OBSERVATION_LIMIT}, got ${maxTokens}`,
    );
  }
  if (countTokens(text) <= maxTokens) return text;
  const markTokens = countTokens(TRUNCATION_MARK);
  return capTokens(text, maxTokens - markTokens) + TRUNCATION_MARK;
}
