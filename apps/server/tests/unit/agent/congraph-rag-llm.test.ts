import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createLLMAdapter,
  TemplateLLMAdapter,
} from "../../../src/agent/congraph-rag-llm";
import type { IEmbedder } from "../../../src/embeddings/embedder-factory";

// Mock the anthropic-llm module so we can test the anthropic branch
vi.mock("../../../src/agent/anthropic-llm", () => ({
  createAnthropicLLMWithEmbeddings: vi.fn(),
}));

import { createAnthropicLLMWithEmbeddings } from "../../../src/agent/anthropic-llm";
const mockCreateAnthropicLLM = vi.mocked(createAnthropicLLMWithEmbeddings);

describe("congraph-rag-llm", () => {
  let mockEmbedder: any;

  beforeEach(() => {
    mockEmbedder = {
      embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    };
    vi.clearAllMocks();
  });

  describe("TemplateLLMAdapter", () => {
    it("should generate a path response when prompt contains 'Path'", async () => {
      const adapter = new TemplateLLMAdapter(
        mockEmbedder as unknown as IEmbedder,
      );
      const response = await adapter.generate(
        "Path analysis for Query: How to register a company?\nContext: Article 1, Article 2",
      );

      expect(response.content).toContain("Dựa trên các đường dẫn tham chiếu");
      expect(response.content).toContain("How to register a company?");
      expect(response.content).toContain("Article 1, Article 2");
    });

    it("should generate a LightRAG response when prompt contains 'LightRAG'", async () => {
      const adapter = new TemplateLLMAdapter(
        mockEmbedder as unknown as IEmbedder,
      );
      const response = await adapter.generate(
        "LightRAG analysis for Query: What is property ownership?\nContext: Chapter 5",
      );

      expect(response.content).toContain("Dựa trên phân tích LightRAG");
      expect(response.content).toContain("What is property ownership?");
    });

    it("should generate a community response when prompt contains 'Community'", async () => {
      const adapter = new TemplateLLMAdapter(
        mockEmbedder as unknown as IEmbedder,
      );
      const response = await adapter.generate(
        "Community analysis for Query: Land law\nContext: Section 3",
      );

      expect(response.content).toContain(
        "Dựa trên phân tích cộng đồng pháp lý",
      );
    });

    it("should generate a default response otherwise", async () => {
      const adapter = new TemplateLLMAdapter(
        mockEmbedder as unknown as IEmbedder,
      );
      const response = await adapter.generate(
        "General Query: Contract law\nContext: Article 10",
      );

      expect(response.content).toContain("Phân tích câu hỏi pháp lý");
    });

    it("should generate JSON extraction response", async () => {
      const adapter = new TemplateLLMAdapter(
        mockEmbedder as unknown as IEmbedder,
      );
      const response = await adapter.generate(
        "Extract high-level and low-level keywords. Format as JSON.\nQuery: quyền sở hữu",
      );
      const parsed = JSON.parse(response.content);
      expect(parsed).toHaveProperty("highLevel");
      expect(parsed).toHaveProperty("lowLevel");
    });

    it("should handle prompt without Query match", async () => {
      const adapter = new TemplateLLMAdapter(
        mockEmbedder as unknown as IEmbedder,
      );
      const response = await adapter.generate("No query pattern here");
      expect(response.content).toBeDefined();
      expect(response.usage).toBeDefined();
    });

    it("should handle prompt without Context match", async () => {
      const adapter = new TemplateLLMAdapter(
        mockEmbedder as unknown as IEmbedder,
      );
      const response = await adapter.generate("Path analysis for Query: test");
      expect(response.content).toContain("Không tìm thấy đường dẫn");
    });

    it("should include token usage estimates", async () => {
      const adapter = new TemplateLLMAdapter(
        mockEmbedder as unknown as IEmbedder,
      );
      const response = await adapter.generate("Test Query: test");
      expect(response.usage.promptTokens).toBeGreaterThan(0);
      expect(response.usage.completionTokens).toBeGreaterThan(0);
      expect(response.usage.totalTokens).toBe(
        response.usage.promptTokens + response.usage.completionTokens,
      );
    });

    it("should stream response", async () => {
      const adapter = new TemplateLLMAdapter(
        mockEmbedder as unknown as IEmbedder,
      );
      const stream = adapter.stream("Path analysis for Query: test");

      let fullText = "";
      for await (const chunk of stream) {
        fullText += chunk;
      }

      expect(fullText).toContain("Dựa trên các đường dẫn tham chiếu");
    });

    it("should embed text", async () => {
      const adapter = new TemplateLLMAdapter(
        mockEmbedder as unknown as IEmbedder,
      );
      const response = await adapter.embed("test text");

      expect(mockEmbedder.embed).toHaveBeenCalledWith("test text");
      expect(response.embedding).toEqual([0.1, 0.2, 0.3]);
    });
  });

  describe("createLLMAdapter", () => {
    it("should create a template adapter by default", () => {
      const adapter = createLLMAdapter(mockEmbedder as unknown as IEmbedder);
      expect(adapter).toBeInstanceOf(TemplateLLMAdapter);
    });

    it("should create a template adapter when provider is 'template'", () => {
      const adapter = createLLMAdapter(mockEmbedder as unknown as IEmbedder, {
        provider: "template",
      });
      expect(adapter).toBeInstanceOf(TemplateLLMAdapter);
    });

    it("should fallback to template if anthropic apiKey is missing", () => {
      const adapter = createLLMAdapter(mockEmbedder as unknown as IEmbedder, {
        provider: "anthropic",
      });
      expect(adapter).toBeInstanceOf(TemplateLLMAdapter);
    });

    it("should create Anthropic LLM when apiKey is provided", () => {
      const mockAnthropicLLM = {
        generate: vi.fn(),
        stream: vi.fn(),
        embed: vi.fn(),
      };
      mockCreateAnthropicLLM.mockReturnValue(mockAnthropicLLM as any);

      const adapter = createLLMAdapter(mockEmbedder as unknown as IEmbedder, {
        provider: "anthropic",
        apiKey: "sk-test-key",
        model: "claude-3-opus-20240229",
      });

      expect(mockCreateAnthropicLLM).toHaveBeenCalledWith(
        "sk-test-key",
        "claude-3-opus-20240229",
        mockEmbedder,
      );
      expect(adapter).toBe(mockAnthropicLLM);
    });

    it("should use default model when not specified", () => {
      const mockAnthropicLLM = { generate: vi.fn() };
      mockCreateAnthropicLLM.mockReturnValue(mockAnthropicLLM as any);

      createLLMAdapter(mockEmbedder as unknown as IEmbedder, {
        provider: "anthropic",
        apiKey: "sk-test-key",
      });

      expect(mockCreateAnthropicLLM).toHaveBeenCalledWith(
        "sk-test-key",
        "claude-3-haiku-20240307",
        mockEmbedder,
      );
    });

    it("should fallback to template if anthropic creation throws", () => {
      mockCreateAnthropicLLM.mockImplementation(() => {
        throw new Error("Failed to initialize");
      });

      const adapter = createLLMAdapter(mockEmbedder as unknown as IEmbedder, {
        provider: "anthropic",
        apiKey: "sk-test-key",
      });

      expect(adapter).toBeInstanceOf(TemplateLLMAdapter);
    });
  });
});
