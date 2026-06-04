// ============================================================================
// Anthropic LLM Adapter for ConGraphRAG
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import type { LLMResponse, EmbeddingResponse } from "congraph-rag/core";
import { BaseLLM } from "congraph-rag/core";
import type { IEmbedder } from "../embeddings/embedder-factory";
import logger from "../shared/logger";

// ----------------------------------------------------------------------------
// Anthropic LLM Adapter
// ----------------------------------------------------------------------------

export class AnthropicLLMAdapter extends BaseLLM {
  private client: Anthropic;

  constructor(
    private apiKey: string,
    private model: string = "claude-3-haiku-20240307",
    private options: { temperature?: number; maxTokens?: number } = {},
  ) {
    super();
    this.client = new Anthropic({ apiKey: this.apiKey });
  }

  async generate(
    prompt: string,
    _options?: Record<string, unknown>,
  ): Promise<LLMResponse> {
    if (!this.apiKey) {
      throw new Error("Anthropic API key is not configured");
    }

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.options.maxTokens || 2000,
        temperature: this.options.temperature || 0.3,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      // Extract content from response
      let content = "";
      if (response.content[0].type === "text") {
        content = response.content[0].text;
      }

      return {
        content,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens:
            response.usage.input_tokens + response.usage.output_tokens,
        },
      };
    } catch (error) {
      logger.error("Anthropic API error", error);
      throw error;
    }
  }

  async *stream(
    prompt: string,
    _options?: Record<string, unknown>,
  ): AsyncIterable<string> {
    if (!this.apiKey) {
      throw new Error("Anthropic API key is not configured");
    }

    try {
      const stream = await this.client.messages.create({
        model: this.model,
        max_tokens: this.options.maxTokens || 2000,
        temperature: this.options.temperature || 0.3,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        stream: true,
      });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield event.delta.text;
        }
      }
    } catch (error) {
      logger.error("Anthropic streaming error", error);
      yield "Lỗi khi kết nối với dịch vụ AI.";
    }
  }

  async embed(_text: string): Promise<EmbeddingResponse> {
    throw new Error(
      "Anthropic doesn't provide embeddings. Use a separate embedder (e.g., @xenova/transformers) for embeddings.",
    );
  }
}

// ----------------------------------------------------------------------------
// Combined LLM with Embeddings
// ----------------------------------------------------------------------------

export class AnthropicLLMWithEmbeddings extends BaseLLM {
  private llm: AnthropicLLMAdapter;
  private embedder: IEmbedder;

  constructor(apiKey: string, model: string, embedder: IEmbedder) {
    super();
    this.llm = new AnthropicLLMAdapter(apiKey, model);
    this.embedder = embedder;
  }

  async generate(
    prompt: string,
    options?: Record<string, unknown>,
  ): Promise<LLMResponse> {
    return this.llm.generate(prompt, options);
  }

  async *stream(
    prompt: string,
    options?: Record<string, unknown>,
  ): AsyncIterable<string> {
    yield* this.llm.stream(prompt, options);
  }

  async embed(text: string): Promise<EmbeddingResponse> {
    const embedding = await this.embedder.embed(text);
    return { embedding };
  }
}

// ----------------------------------------------------------------------------
// Factory Function
// ----------------------------------------------------------------------------

export function createAnthropicLLM(
  apiKey: string,
  model?: string,
  options?: { temperature?: number; maxTokens?: number },
): AnthropicLLMAdapter {
  if (!apiKey) {
    throw new Error("Anthropic API key is required");
  }
  return new AnthropicLLMAdapter(apiKey, model, options);
}

export function createAnthropicLLMWithEmbeddings(
  apiKey: string,
  model: string,
  embedder: IEmbedder,
): AnthropicLLMWithEmbeddings {
  if (!apiKey) {
    throw new Error("Anthropic API key is required");
  }
  return new AnthropicLLMWithEmbeddings(apiKey, model, embedder);
}
