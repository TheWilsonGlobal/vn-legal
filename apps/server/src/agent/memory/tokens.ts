// ============================================================================
// Token approximation for the working-memory window (B5).
//
// Method (deterministic, no tokenizer dependency):
//   countTokens(text) = max(W, ceil(C / 4))
//   W = number of whitespace-separated words in the NFC-normalised text
//   C = number of UTF-16 code units in the NFC-normalised text
//
// Words catch Vietnamese text, where each syllable is space-separated. The
// character term catches long unspaced runs (URLs, identifiers), which a word
// count alone would undercount. Every window, history and observation limit
// uses this one function, so window() and stats() agree.
// ============================================================================

function normalise(text: string): string {
  return text.normalize("NFC");
}

export function countTokens(text: string): number {
  const s = normalise(text);
  const words = s.split(/\s+/).filter((w) => w.length > 0).length;
  return Math.max(words, Math.ceil(s.length / 4));
}

/**
 * Longest prefix of `text` (by code point) whose countTokens() is <= max.
 * Returns the text unchanged when it already fits. Binary search: countTokens
 * is monotone in prefix length, so the search is exact.
 */
export function capTokens(text: string, max: number): string {
  if (max <= 0) return "";
  if (countTokens(text) <= max) return text;
  const cps = Array.from(normalise(text));
  let lo = 0;
  let hi = cps.length; // invariant: prefix(lo) fits, prefix(hi) does not
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (countTokens(cps.slice(0, mid).join("")) <= max) lo = mid;
    else hi = mid;
  }
  return cps.slice(0, lo).join("");
}
