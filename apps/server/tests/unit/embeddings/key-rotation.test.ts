// Key rotation: a quota error moves the call to the next key; any other error does not.
import { describe, it, expect, vi } from "vitest";
import { withKeyRotation, isQuotaError } from "../../../src/embeddings/key-rotation";

vi.mock("../../../src/shared/logger", () => ({
  default: { warn: () => {}, info: () => {}, error: () => {} },
}));

function fake(name: string, behaviour: "ok" | "quota" | "auth") {
  return {
    name,
    calls: 0,
    async embed(text: string) {
      this.calls += 1;
      if (behaviour === "quota") {
        throw Object.assign(new Error("HTTP 429: RESOURCE_EXHAUSTED"), { httpStatus: 429 });
      }
      if (behaviour === "auth") throw new Error("HTTP 400: API key not valid");
      return [text.length, 1];
    },
    async embedBatch(texts: string[]) {
      return texts.map((t) => [t.length]);
    },
    label() {
      return name;
    },
  };
}

describe("withKeyRotation", () => {
  it("uses the primary when it works", async () => {
    const p = fake("p", "ok");
    const f = fake("f", "ok");
    const e = withKeyRotation(p, [f]);
    expect(await e.embed("abc")).toEqual([3, 1]);
    expect(f.calls).toBe(0);
  });

  it("moves to the next key on a quota error", async () => {
    const p = fake("p", "quota");
    const f = fake("f", "ok");
    const e = withKeyRotation(p, [f]);
    expect(await e.embed("abcd")).toEqual([4, 1]);
    expect(p.calls).toBe(1);
    expect(f.calls).toBe(1);
  });

  it("moves past a rejected (invalid) key to the next working key", async () => {
    const p = fake("p", "auth");
    const f = fake("f", "ok");
    const e = withKeyRotation(p, [f]);
    expect(await e.embed("abc")).toEqual([3, 1]);
    expect(p.calls).toBe(1);
    expect(f.calls).toBe(1);
  });

  it("does not rotate on a non-key, non-quota error", async () => {
    const p = {
      calls: 0,
      async embed() {
        this.calls += 1;
        throw new Error("fetch failed: socket hang up");
      },
    };
    const f = fake("f", "ok");
    const e = withKeyRotation(p, [f]);
    await expect(e.embed("x")).rejects.toThrow(/socket hang up/);
    expect(f.calls).toBe(0);
  });

  it("throws the last error when every key is rejected", async () => {
    const p = fake("p", "auth");
    const f = fake("f", "auth");
    const e = withKeyRotation(p, [f]);
    await expect(e.embed("x")).rejects.toThrow(/API key not valid/);
    expect(p.calls).toBe(1);
    expect(f.calls).toBe(1);
  });

  it("throws the quota error when every key is over quota", async () => {
    const p = fake("p", "quota");
    const f = fake("f", "quota");
    const e = withKeyRotation(p, [f]);
    await expect(e.embed("x")).rejects.toThrow(/RESOURCE_EXHAUSTED/);
  });

  it("returns the primary unchanged when there are no fallbacks", () => {
    const p = fake("p", "ok");
    expect(withKeyRotation(p, [])).toBe(p);
  });

  it("recognises quota errors by status or message", () => {
    expect(isQuotaError({ httpStatus: 429 })).toBe(true);
    expect(isQuotaError(new Error("failed after 2 retries (HTTP 429: RESOURCE_EXHAUSTED)"))).toBe(true);
    expect(isQuotaError(new Error("HTTP 400: API key not valid"))).toBe(false);
  });
});
