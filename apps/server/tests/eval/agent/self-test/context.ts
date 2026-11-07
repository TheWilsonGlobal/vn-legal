/**
 * Shared test context and assertion helpers for self-test.
 */
export class TestContext {
  failures = 0;
  total = 0;

  check(name: string, ok: boolean, detail = ""): void {
    this.total += 1;
    if (!ok) this.failures += 1;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : detail ? `  -> ${detail}` : ""}`,
    );
  }
}

export const approx = (a: number | null, b: number, eps = 1e-6) =>
  a !== null && Math.abs(a - b) <= eps;

export const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
