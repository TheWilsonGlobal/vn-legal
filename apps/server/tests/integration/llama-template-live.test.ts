/**
 * Live integration test for the Llama adapter against a real llama.cpp server.
 *
 * The unit tests in `tests/unit/agent/llama-chat-template.test.ts` assert on the
 * SHAPE of the outgoing request. They cannot prove the thing that actually
 * mattered: that a model with a non-Llama template now produces a usable answer.
 * Only a real server can show that, so this file talks to one.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 *
 * With the old `/completion` + hand-built Llama-3 template, the same 1812-char
 * legal prompt produced:
 *
 *   LFM-2.5-1.2B Q8  (port 5814):   88 chars, ending in `</|eot id|>`
 *   Llama-3.2-1B Q4  (port 5812): 1843 chars, correct
 *
 * LFM is the LARGER model at the HIGHER quant, so capacity never explained the
 * gap — the Llama-3 markers simply are not tokens in LFM's vocabulary, and it
 * echoed malformed copies of them back instead of treating them as control
 * tokens. After the fix, LFM returns 1100+ tokens on the same prompt.
 *
 * ── Skipping ─────────────────────────────────────────────────────────────────
 *
 * These require a llama.cpp server that infra-hub may not have running, so they
 * skip rather than fail when the port is closed. A skipped run proves nothing;
 * to actually exercise this, start a model and re-run. Set LLAMA_TEST_URL to
 * point at a different server.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { LlamaLLMAdapter } from "../../src/agent/congraph-rag-llm.js";

const API_URL = process.env.LLAMA_TEST_URL || "http://127.0.0.1:5814";

/**
 * Fragments of Llama-3 markers as a confused tokenizer re-emits them.
 *
 * Deliberately matched loosely: the model does not reproduce them exactly (we
 * have observed `</|eot id|>` with a space and `</|efin|` truncated), so an
 * exact-match assertion would pass while the bug was live. Any `<|e…` or `</|e…`
 * in the output means control tokens arrived as text.
 */
const MANGLED_MARKER = /<\/?\|\s*e(ot|fin|nd)/i;

/** A realistic Vietnamese legal prompt — the shape that exposed the bug. */
const SYSTEM_PROMPT =
  "Bạn là một chuyên gia tư vấn pháp luật Việt Nam chuyên về Bộ luật Dân sự. " +
  "Nhiệm vụ của bạn là cung cấp lời khuyên pháp lý rõ ràng, chính xác và có căn cứ.";

const USER_PROMPT =
  "# Thông tin tư vấn\n**Câu hỏi**: Sở hữu tài sản chung\n\n" +
  "# Căn cứ pháp lý\n- **Điều 209. Sở hữu chung theo phần**\n" +
  "- **Điều 210. Sở hữu chung hợp nhất**\n\n" +
  "# Yêu cầu\nDựa trên các thông tin pháp lý trên, hãy phân tích tình huống " +
  "và đưa ra lời khuyên theo cấu trúc: Pháp luật áp dụng → Phân tích → Khuyến nghị.";

async function serverIsUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

describe("LlamaLLMAdapter against a live llama.cpp server", () => {
  let available = false;
  let loadedModel = "unknown";

  beforeAll(async () => {
    available = await serverIsUp(API_URL);
    if (!available) {
      console.warn(
        `\n  [skip] No llama.cpp server on ${API_URL} — start one to run these.\n`,
      );
      return;
    }
    try {
      const res = await fetch(`${API_URL}/v1/models`);
      const json: any = await res.json();
      loadedModel = json?.data?.[0]?.id ?? "unknown";
      console.info(`  [live] ${API_URL} is serving: ${loadedModel}`);
    } catch {
      // Non-fatal: the model name is only used for diagnostics below.
    }
  });

  it("returns a substantial answer to a real legal prompt", async () => {
    if (!available) return;

    const adapter = new LlamaLLMAdapter(API_URL, { maxTokens: 2000 });
    const result = await adapter.generate(USER_PROMPT, {
      systemPrompt: SYSTEM_PROMPT,
    });

    // The broken path returned 88 characters. Any healthy model given this
    // prompt produces several hundred; 300 is a floor that catches a regression
    // to gibberish without being sensitive to sampling or model choice.
    expect(result.content.length).toBeGreaterThan(300);
  });

  it("emits no mangled control-token artefacts", async () => {
    if (!available) return;

    const adapter = new LlamaLLMAdapter(API_URL, { maxTokens: 2000 });
    const result = await adapter.generate(USER_PROMPT, {
      systemPrompt: SYSTEM_PROMPT,
    });

    // This is the single most diagnostic assertion in the file. A model echoing
    // `</|eot id|>` is telling you it received control tokens as plain text.
    expect(result.content).not.toMatch(MANGLED_MARKER);
  });

  it("honours the system prompt by answering in Vietnamese", async () => {
    if (!available) return;

    const adapter = new LlamaLLMAdapter(API_URL, { maxTokens: 500 });
    const result = await adapter.generate(USER_PROMPT, {
      systemPrompt: SYSTEM_PROMPT,
    });

    // Vietnamese diacritics are the cheapest language check that does not
    // depend on the model picking any particular word.
    expect(result.content).toMatch(/[àáâãèéêìíòóôõùúýăđĩũơưạảấầẩậắằặẽếềệỉịọ]/i);
  });

  it("reports non-zero token usage", async () => {
    if (!available) return;

    const adapter = new LlamaLLMAdapter(API_URL, { maxTokens: 200 });
    const result = await adapter.generate("Xin chào", {
      systemPrompt: "Trả lời ngắn gọn.",
    });

    // Guards the usage remap: /completion used tokens_evaluated/tokens_predicted,
    // the chat endpoint uses usage.prompt_tokens/completion_tokens. Reading the
    // old field names off the new response silently yields zeros.
    expect(result.usage?.promptTokens).toBeGreaterThan(0);
    expect(result.usage?.completionTokens).toBeGreaterThan(0);
  });

  it("streams tokens incrementally", async () => {
    if (!available) return;

    const adapter = new LlamaLLMAdapter(API_URL, { maxTokens: 200 });
    const chunks: string[] = [];
    for await (const chunk of adapter.stream("Xin chào", {
      systemPrompt: "Trả lời ngắn gọn.",
    })) {
      chunks.push(chunk);
    }

    // More than one chunk proves the SSE delta path is being parsed; a single
    // chunk would suggest we fell back to buffering the whole response.
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).not.toMatch(MANGLED_MARKER);
    // The adapter yields this literal string on a caught streaming error rather
    // than throwing, so a "successful" stream can consist entirely of it.
    expect(chunks.join("")).not.toContain("Lỗi khi kết nối");
  });

  it("works without a system prompt at all", async () => {
    if (!available) return;

    const adapter = new LlamaLLMAdapter(API_URL, { maxTokens: 200 });
    const result = await adapter.generate("Thủ đô của Việt Nam là gì?");

    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content).not.toMatch(MANGLED_MARKER);
  });
});
