import { createHash } from "node:crypto";

/** prev_hash of the first record of every session log. */
export const GENESIS_HASH = "0".repeat(64);

/**
 * Canonical JSON used as the hashed string: object keys sorted by code unit,
 * no insignificant whitespace, `undefined` members dropped. The stored line is
 * exactly this string, so a re-serialised line can be detected byte for byte.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const members = Object.keys(obj)
      .filter((key) => obj[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`);
    return `{${members.join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("non-finite number cannot be canonicalised");
  }
  return JSON.stringify(value);
}

/** row_hash = sha256(prev_hash + canonical JSON of the record without row_hash), hex. */
export function rowHash(prevHash: string, canonicalBody: string): string {
  return createHash("sha256")
    .update(prevHash + canonicalBody, "utf8")
    .digest("hex");
}
