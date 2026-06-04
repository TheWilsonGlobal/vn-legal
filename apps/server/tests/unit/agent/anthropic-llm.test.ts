import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AnthropicLLMAdapter,
  createAnthropicLLM,
  createAnthropicLLMWithEmbeddings,
  AnthropicLLMWithEmbeddings,
} from "../../../src/agent/anthropic-llm";

// Mock Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn(),
      },
    })),
  };
});

describe("AnthropicLLMAdapter", () => {
  const apiKey = "test-api-key";
  let adapter: AnthropicLLMAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new AnthropicLLMAdapter(apiKey);
  });

  describe("generate", () => {
    it("should throw error if apiKey is missing", async () => {
      const badAdapter = new AnthropicLLMAdapter("");
      await expect(badAdapter.generate("prompt")).rejects.toThrow(
        "Anthropic API key is not configured",
      );
    });

    it("should call Anthropic client with correct parameters", async () => {
      const mockResponse = {
        content: [{ type: "text", text: "response content" }],
        usage: { input_tokens: 10, output_tokens: 20 },
      };

      const client = (adapter as any).client;
      client.messages.create.mockResolvedValue(mockResponse);

      const result = await adapter.generate("test prompt");

      expect(client.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "claude-3-haiku-20240307",
          messages: [{ role: "user", content: "test prompt" }],
        }),
      );
      expect(result.content).toBe("response content");
      expect(result.usage?.totalTokens).toBe(30);
    });

    it("should handle API errors", async () => {
      const client = (adapter as any).client;
      client.messages.create.mockRejectedValue(new Error("API Error"));

      await expect(adapter.generate("prompt")).rejects.toThrow("API Error");
    });
  });

  describe("stream", () => {
    it("should throw error if apiKey is missing", async () => {
      const badAdapter = new AnthropicLLMAdapter("");
      const stream = badAdapter.stream("prompt");
      await expect(stream.next()).rejects.toThrow(
        "Anthropic API key is not configured",
      );
    });

    it("should yield text chunks from stream", async () => {
      const mockEvents = [
        {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hello" },
        },
        {
          type: "content_block_delta",
          delta: { type: "text_delta", text: " World" },
        },
      ];

      const client = (adapter as any).client;
      client.messages.create.mockResolvedValue(
        (async function* () {
          for (const event of mockEvents) yield event;
        })(),
      );

      const chunks: string[] = [];
      for await (const chunk of adapter.stream("test prompt")) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["Hello", " World"]);
    });

    it("should handle streaming errors", async () => {
      const client = (adapter as any).client;
      client.messages.create.mockRejectedValue(new Error("Stream Error"));

      const it = adapter.stream("prompt");
      const result = await it.next();
      expect(result.value).toBe("Lỗi khi kết nối với dịch vụ AI.");
    });
  });

  describe("embed", () => {
    it("should throw error as Anthropic doesn't support embeddings", async () => {
      await expect(adapter.embed("text")).rejects.toThrow(
        "Anthropic doesn't provide embeddings",
      );
    });
  });
});

describe("AnthropicLLMWithEmbeddings", () => {
  it("should use provided embedder", async () => {
    const mockEmbedder = {
      embed: vi.fn().mockResolvedValue([0.1, 0.2]),
    };
    const combined = new AnthropicLLMWithEmbeddings(
      "key",
      "model",
      mockEmbedder as any,
    );

    const result = await combined.embed("test");
    expect(result.embedding).toEqual([0.1, 0.2]);
    expect(mockEmbedder.embed).toHaveBeenCalledWith("test");
  });

  it("should delegate generate and stream to internal adapter", async () => {
    const mockEmbedder = { embed: vi.fn() };
    const combined = new AnthropicLLMWithEmbeddings(
      "key",
      "model",
      mockEmbedder as any,
    );
    const adapter = (combined as any).llm;

    vi.spyOn(adapter, "generate").mockResolvedValue({ content: "ok" });
    const result = await combined.generate("prompt");
    expect(result.content).toBe("ok");

    vi.spyOn(adapter, "stream").mockImplementation(async function* () {
      yield "ok";
    });
    const stream = combined.stream("prompt");
    const first = await stream.next();
    expect(first.value).toBe("ok");
  });
});

describe("Factory Functions", () => {
  it("should create AnthropicLLMAdapter", () => {
    const adapter = createAnthropicLLM("key");
    expect(adapter).toBeInstanceOf(AnthropicLLMAdapter);
  });

  it("should throw if apiKey is missing in createAnthropicLLM", () => {
    expect(() => createAnthropicLLM("")).toThrow(
      "Anthropic API key is required",
    );
  });

  it("should create AnthropicLLMWithEmbeddings", () => {
    const mockEmbedder = { embed: vi.fn() };
    const combined = createAnthropicLLMWithEmbeddings(
      "key",
      "model",
      mockEmbedder as any,
    );
    expect(combined).toBeInstanceOf(AnthropicLLMWithEmbeddings);
  });

  it("should throw if apiKey is missing in createAnthropicLLMWithEmbeddings", () => {
    expect(() =>
      createAnthropicLLMWithEmbeddings("", "model", {} as any),
    ).toThrow("Anthropic API key is required");
  });
});
