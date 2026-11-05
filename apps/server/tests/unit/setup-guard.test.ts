/**
 * A33: the live-call guard in setup-unit.ts is reached by both SDK clients.
 *
 * Each client is built with a dummy key and makes one call. If an SDK routed
 * around global fetch, the call would hit the network instead, and the
 * assertions below would fail rather than pass.
 */

import { describe, expect, it } from "vitest";
import { ChatOpenAI } from "@langchain/openai";
import { GoogleGenAI } from "@google/genai";

const GOOGLE_COMPAT_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/";
const DUMMY_KEY = "unit-test-dummy-key";
const GUARD_MESSAGE = "live network call in a unit test";

// The OpenAI SDK wraps a fetch rejection ("Connection error.") and keeps the
// original error as `cause`, so the guard text is searched through the chain.
function messageChain(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      cur = cur.cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.join(" | ");
}

describe("live-call guard (A33)", () => {
  it("setup-unit.ts removed the keys and disabled Langfuse", () => {
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    expect(process.env.GEMINI_EMBEDDING_API_KEY).toBeUndefined();
    expect(process.env.GOOGLE_API_KEY).toBeUndefined();
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect(process.env.LANGFUSE_SECRET_KEY).toBeUndefined();
    expect(process.env.LANGFUSE_PUBLIC_KEY).toBeUndefined();
    expect(process.env.LANGFUSE_ENABLED).toBe("false");
  });

  it("ChatOpenAI at Google's compat URL reaches the guard", async () => {
    const chat = new ChatOpenAI({
      model: "gemini-3.5-flash-lite",
      apiKey: DUMMY_KEY,
      maxRetries: 0,
      configuration: { baseURL: GOOGLE_COMPAT_URL },
    });

    let caught: unknown;
    try {
      await chat.invoke("ping");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(messageChain(caught)).toContain(GUARD_MESSAGE);
    expect(messageChain(caught)).toContain("generativelanguage.googleapis.com");
  });

  it("GoogleGenAI with a dummy key reaches the guard", async () => {
    const ai = new GoogleGenAI({ apiKey: DUMMY_KEY });

    let caught: unknown;
    try {
      await ai.models.embedContent({
        model: "gemini-embedding-2",
        contents: "ping",
        config: { outputDimensionality: 768 },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(messageChain(caught)).toContain(GUARD_MESSAGE);
    expect(messageChain(caught)).toContain("generativelanguage.googleapis.com");
  });
});
