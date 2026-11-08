// Regression: Gemini's function-declaration schema rejects JSON Schema keywords such as
// exclusiveMinimum (HTTP 400 "Cannot find field"). Every agent tool schema must convert
// to a JSON Schema that uses only keywords Gemini accepts.
import { describe, it, expect } from "vitest";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { createAgentTools } from "../../../../src/agent/graph/tools";

const FORBIDDEN = ["exclusiveMinimum", "exclusiveMaximum"];

function keysDeep(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => keysDeep(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
}

describe("agent tool schemas are Gemini-compatible", () => {
  const tools = createAgentTools({
    retrieval: { retrieve: async () => ({}) },
    memory: { recall: async () => ({ fresh_session: true, items: [] }) } as any,
    sessionId: "s",
    runId: "r",
  });

  it.each(tools.map((t) => [t.name, t] as const))(
    "%s has no exclusive bounds in its JSON schema",
    (_name, tool) => {
      const json = toJsonSchema(tool.schema as any);
      const keys = keysDeep(json);
      for (const bad of FORBIDDEN) expect(keys).not.toContain(bad);
    },
  );
});
