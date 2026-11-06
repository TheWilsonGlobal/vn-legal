// Small statistics helpers. Pure.

export interface Rate {
  k: number;
  n: number;
  /** null when n = 0 (nothing was measured). */
  value: number | null;
  /** Wilson 95% interval, null when n = 0. */
  ci: [number, number] | null;
}

export function wilson(
  k: number,
  n: number,
  z = 1.96,
): [number, number] | null {
  if (n <= 0) return null;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function rate(k: number, n: number): Rate {
  return { k, n, value: n > 0 ? k / n : null, ci: wilson(k, n) };
}

export function mean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Nearest-rank percentile: the value at rank ceil(p/100 * n) of the sorted list. */
export function percentile(xs: readonly number[], p: number): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/** Upper 95% bound on a true failure rate after 0 failures in n trials ("rule of three"). */
export function zeroFailureUpperBound(n: number): number | null {
  return n > 0 ? 3 / n : null;
}

export function fmtRate(r: Rate): string {
  if (r.value === null || r.ci === null) return "n/a (n=0)";
  return `${(r.value * 100).toFixed(1)}% (${r.k}/${r.n}, Wilson95 ${(r.ci[0] * 100).toFixed(1)}-${(r.ci[1] * 100).toFixed(1)}%)`;
}
