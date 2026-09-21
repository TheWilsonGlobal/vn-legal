/**
 * Regression tests for the Llama adapter's prompt-template handling.
 *
 * ── The bug these lock down ────────────────────────────────────────────────
 *
 * `LlamaLLMAdapter` used to POST to llama.cpp's raw `/completion` endpoint.
 * That endpoint applies NO chat template — it tokenizes the string verbatim —
 * so every caller hand-built one, and the one they built was Llama-3's:
 *
 *   <|begin_of_text|><|start_header_id|>system<|end_header_id|>…<|eot_id|>…
 *
 * Those markers are real tokens only for Llama-3 models. Pointed at any other
 * model the same code produced gibberish input: LFM-2.5 on port 5814 answered a
 * 1812-character legal question with 88 characters of "please give me more
 * detail", and signed off with `</|eot id|>` — a *malformed* copy of a marker it
 * had received as plain text rather than as a control token. Llama-3.2 on 5812,
 * given the byte-identical prompt, returned 1843 characters. The models are the
 * same size (1.2B vs 1B) and LFM is the higher quant (Q8 vs Q4_K_M), so this was
 * never a capacity difference — it was a corrupted prompt.
 *
 * The fix: target `/v1/chat/completions` with a `messages` array, which makes
 * llama.cpp apply each model's own template from its GGUF metadata. After it,
 * the same prompt against the same LFM server returned 1151 tokens with no
 * mangled markers.
 *
 * These tests assert on the REQUEST the adapter builds, not on model output, so
 * they need no running server and cannot flake on sampling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LlamaLLMAdapter } from "../../../src/agent/congraph-rag-llm";

/** Markers that must never reach a model as literal text. */
const LLAMA3_MARKERS = [
  "<|begin_of_text|>",
  "<|start_header_id|>",
  "<|end_header_id|>",
  "<|eot_id|>",
];

const API_URL = "http://127.0.0.1:5814";

/** Captures the single fetch the adapter makes and returns the parsed body. */
function mockChatResponse(content = "ok") {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  });
}

function lastRequest(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[0];
  return { url: url as string, body: JSON.parse((init as any).body) };
}

describe("LlamaLLMAdapter prompt template", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let adapter: LlamaLLMAdapter;

  beforeEach(() => {
    fetchMock = mockChatResponse();
    vi.stubGlobal("fetch", fetchMock);
    adapter = new LlamaLLMAdapter(API_URL);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("endpoint selection", () => {
    it("uses /v1/chat/completions so llama.cpp applies the model's own template", async () => {
      await adapter.generate("câu hỏi");

      const { url } = lastRequest(fetchMock);
      expect(url).toBe(`${API_URL}/v1/chat/completions`);
    });

    it("never calls the raw /completion endpoint, which applies no template", async () => {
      await adapter.generate("câu hỏi");

      const { url } = lastRequest(fetchMock);
      expect(url).not.toMatch(/\/completion$/);
    });
  });

  describe("message construction", () => {
    it("sends a messages array rather than a pre-templated prompt string", async () => {
      await adapter.generate("câu hỏi");

      const { body } = lastRequest(fetchMock);
      expect(Array.isArray(body.messages)).toBe(true);
      expect(body.prompt).toBeUndefined();
    });

    it("maps a systemPrompt option onto a real system role", async () => {
      await adapter.generate("câu hỏi", { systemPrompt: "bạn là luật sư" });

      const { body } = lastRequest(fetchMock);
      expect(body.messages).toEqual([
        { role: "system", content: "bạn là luật sư" },
        { role: "user", content: "câu hỏi" },
      ]);
    });

    it("omits the system message entirely when no systemPrompt is given", async () => {
      await adapter.generate("câu hỏi");

      const { body } = lastRequest(fetchMock);
      expect(body.messages).toEqual([{ role: "user", content: "câu hỏi" }]);
    });

    it("ignores a non-string systemPrompt instead of sending a bogus system turn", async () => {
      await adapter.generate("câu hỏi", { systemPrompt: { nope: true } as any });

      const { body } = lastRequest(fetchMock);
      expect(body.messages).toEqual([{ role: "user", content: "câu hỏi" }]);
    });
  });

  describe("no hardcoded Llama-3 template (the actual regression)", () => {
    it("puts no Llama-3 control markers in the outgoing request", async () => {
      await adapter.generate("câu hỏi", { systemPrompt: "bạn là luật sư" });

      const [, init] = fetchMock.mock.calls[0];
      const raw = (init as any).body as string;
      for (const marker of LLAMA3_MARKERS) {
        expect(raw).not.toContain(marker);
      }
    });

    it("passes the user prompt through verbatim, unwrapped", async () => {
      const prompt = "Sở hữu tài sản chung được quy định thế nào?";
      await adapter.generate(prompt);

      const { body } = lastRequest(fetchMock);
      const userMessage = body.messages.find((m: any) => m.role === "user");
      expect(userMessage.content).toBe(prompt);
    });

    it("sends no hardcoded stop array — the stop token comes from GGUF metadata", async () => {
      await adapter.generate("câu hỏi");

      const { body } = lastRequest(fetchMock);
      expect(body.stop).toBeUndefined();
    });

    it("builds an identical request regardless of which model is served", async () => {
      // The adapter is never told which model is loaded, which is precisely what
      // makes it model-agnostic. Two adapters pointed at the LFM port and the
      // Llama port must produce byte-identical bodies.
      const lfm = new LlamaLLMAdapter("http://127.0.0.1:5814");
      const llama = new LlamaLLMAdapter("http://127.0.0.1:5812");

      await lfm.generate("câu hỏi", { systemPrompt: "hệ thống" });
      await llama.generate("câu hỏi", { systemPrompt: "hệ thống" });

      const [, first] = fetchMock.mock.calls[0];
      const [, second] = fetchMock.mock.calls[1];
      expect((first as any).body).toBe((second as any).body);
    });
  });

  describe("response parsing", () => {
    it("reads content from the OpenAI choices[].message shape", async () => {
      vi.stubGlobal("fetch", mockChatResponse("Điều 209 quy định..."));
      const result = await new LlamaLLMAdapter(API_URL).generate("q");

      expect(result.content).toBe("Điều 209 quy định...");
    });

    it("maps OpenAI usage fields onto the LLMResponse usage block", async () => {
      const result = await adapter.generate("q");

      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it("returns empty content rather than throwing when choices is absent", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
      );

      const result = await new LlamaLLMAdapter(API_URL).generate("q");
      expect(result.content).toBe("");
    });

    it("surfaces a non-OK response as an error carrying the server's body", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          text: async () => "context shift disabled",
        }),
      );

      await expect(new LlamaLLMAdapter(API_URL).generate("q")).rejects.toThrow(
        /500.*context shift disabled/,
      );
    });
  });

  describe("streaming", () => {
    /** Minimal SSE body reader over the given raw lines. */
    function sseResponse(lines: string[]) {
      const encoder = new TextEncoder();
      let i = 0;
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: async () =>
              i < lines.length
                ? { done: false, value: encoder.encode(lines[i++]) }
                : { done: true, value: undefined },
          }),
        },
      };
    }

    async function collect(iter: AsyncIterable<string>) {
      const out: string[] = [];
      for await (const chunk of iter) out.push(chunk);
      return out;
    }

    it("requests the chat endpoint with stream enabled", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([])));
      const a = new LlamaLLMAdapter(API_URL);
      await collect(a.stream("q", { systemPrompt: "s" }));

      const { url, body } = lastRequest(globalThis.fetch as any);
      expect(url).toBe(`${API_URL}/v1/chat/completions`);
      expect(body.stream).toBe(true);
      expect(body.messages[0]).toEqual({ role: "system", content: "s" });
    });

    it("yields tokens from the OpenAI choices[].delta.content shape", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          sseResponse([
            'data: {"choices":[{"delta":{"content":"Điều "}}]}\n',
            'data: {"choices":[{"delta":{"content":"209"}}]}\n',
            "data: [DONE]\n",
          ]),
        ),
      );

      const chunks = await collect(new LlamaLLMAdapter(API_URL).stream("q"));
      expect(chunks.join("")).toBe("Điều 209");
    });

    it("still yields from the legacy /completion chunk shape", async () => {
      // The fallback exists so a server speaking the older format degrades to
      // working output instead of silently streaming nothing.
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(sseResponse(['data: {"content":"xin chào"}\n'])),
      );

      const chunks = await collect(new LlamaLLMAdapter(API_URL).stream("q"));
      expect(chunks.join("")).toBe("xin chào");
    });
  });
});
