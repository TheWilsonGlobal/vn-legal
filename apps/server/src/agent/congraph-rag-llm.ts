// ============================================================================
// LLM Adapter for ConGraphRAG Integration
// ============================================================================
// This adapter implements BaseLLM for use with ConGraphRAG engines

import type { LLMResponse, EmbeddingResponse } from "congraph-rag/core";
import { BaseLLM } from "congraph-rag/core";
import type { IEmbedder } from "../embeddings/embedder-factory";
import { createAnthropicLLMWithEmbeddings } from "./anthropic-llm";
import logger from "../shared/logger";

// ----------------------------------------------------------------------------
// LLM Adapter Options
// ----------------------------------------------------------------------------

export interface LLMAdapterOptions {
  provider?: "template" | "anthropic" | "openai" | "llama";
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  apiUrl?: string;
}

// ----------------------------------------------------------------------------
// Template-based LLM Adapter (Fallback)
// ----------------------------------------------------------------------------

/**
 * Template-based LLM adapter for ConGraphRAG
 *
 * This implementation uses template responses rather than actual LLM calls.
 * For production use, you should integrate with Anthropic or OpenAI APIs.
 */
export class TemplateLLMAdapter extends BaseLLM {
  constructor(
    private embedder: IEmbedder,
    _options: LLMAdapterOptions = {},
  ) {
    super();
  }

  async generate(
    prompt: string,
    _options?: Record<string, unknown>,
  ): Promise<LLMResponse> {
    // For template-based responses, we extract key information from the prompt
    // and return a structured response

    const response = this.generateTemplateResponse(prompt);

    return {
      content: response,
      usage: {
        promptTokens: prompt.length / 4, // Rough estimate
        completionTokens: response.length / 4,
        totalTokens: (prompt.length + response.length) / 4,
      },
    };
  }

  async *stream(
    prompt: string,
    options?: Record<string, unknown>,
  ): AsyncIterable<string> {
    const response = await this.generate(prompt, options);
    const words = response.content.split(" ");

    for (const word of words) {
      yield word + " ";
      // Simulate streaming delay
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async embed(text: string): Promise<EmbeddingResponse> {
    const embedding = await this.embedder.embed(text);
    return { embedding };
  }

  /**
   * Generate a template-based response from the prompt
   */
  private generateTemplateResponse(prompt: string): string {
    // Extract query from prompt
    const queryMatch = prompt.match(/Query:\s*(.+?)(?:\n|$)/i);
    const query = queryMatch ? queryMatch[1].trim() : "";

    // Extract context from prompt
    const contextMatch = prompt.match(
      /(?:Context|Paths|Relevant Context):?\s*([\s\S]+?)(?:Query:|$)/i,
    );
    const context = contextMatch ? contextMatch[1].trim() : "";

    // Generate response based on prompt structure
    if (
      prompt.includes("Extract high-level") ||
      prompt.includes("Format as JSON")
    ) {
      return JSON.stringify({
        highLevel: [],
        lowLevel: [query || "quyền"],
      });
    } else if (prompt.includes("Path")) {
      return this.generatePathResponse(query, context);
    } else if (prompt.includes("LightRAG")) {
      return this.generateLightRAGResponse(query, context);
    } else if (prompt.includes("Community")) {
      return this.generateCommunityResponse(query, context);
    }

    // Default response
    return this.generateDefaultResponse(query, context);
  }

  private generatePathResponse(query: string, context: string): string {
    return `
Dựa trên các đường dẫn tham chiếu được tìm thấy, đây là phân tích cho câu hỏi của bạn:

## Câu hỏi: ${query}

## Các đường dẫn pháp lý liên quan:
${context || "Không tìm thấy đường dẫn tham chiếu trực tiếp."}

## Phân tích:
1. Các điều khoản liên quan đã được truy xuất qua đồ thị tham chiếu
2. Mối quan hệ giữa các điều khoản được phân tích dựa trên cấu trúc pháp lý
3. Các đường dẫn này cho thấy sự liên kết giữa các quy định pháp luật

## Lưu ý:
- Đây là phản hồi dựa trên mẫu. Để có phản hồi chính xác hơn, cần tích hợp LLM thực tế.
- Nên tham khảo văn bản pháp luật gốc để có thông tin chính xác.
`;
  }

  private generateLightRAGResponse(query: string, context: string): string {
    return `
Dựa trên phân tích LightRAG (cộng đồng pháp lý), đây là kết quả:

## Câu hỏi: ${query}

## Ngữ cảnh pháp lý:
${context || "Không tìm thấy ngữ cảnh pháp lý phù hợp."}

## Phân tích:
1. Phương pháp LightRAG tập trung vào các cộng đồng pháp lý liên quan
2. Các nguyên tắc pháp lý được truy xuất từ các nhóm điều khoản liên quan
3. Cách tiếp cận này giúp hiểu được bối cảnh rộng lớn của quy định pháp luật

## Lưu ý:
- Đây là phản hồi dựa trên mẫu. Nên tích hợp LLM thực tế cho kết quả tốt hơn.
`;
  }

  private generateCommunityResponse(query: string, context: string): string {
    return `
Dựa trên phân tích cộng đồng pháp lý:

## Câu hỏi: ${query}

## Bối cảnh cộng đồng:
${context || "Không tìm thấy thông tin cộng đồng."}

## Phân tích:
1. Các điều khoản trong cùng một cộng đồng thường liên quan đến cùng một chủ đề
2. Cấu trúc phân cấp (Phần > Chương > Mục > Tiểu mục) giúp hiểu ngữ cảnh
3. Các nguyên tắc chung của cộng đồng được áp dụng cho các điều khoản cụ thể

## Lưu ý:
- Để có kết quả tốt hơn, nên sử dụng LLM thực tế.
`;
  }

  private generateDefaultResponse(query: string, context: string): string {
    return `
## Phân tích câu hỏi pháp lý

**Câu hỏi:** ${query}

**Ngữ cảnh:**
${context || "Không có ngữ cảnh bổ sung."}

**Phân tích:**
Đây là phản hồi dựa trên mẫu. Hệ thống đã truy xuất các điều khoản pháp luật liên quan thông qua cơ chế:
- Vector Search: Tìm kiếm điều khoản tương đồng theo ngữ nghĩa
- Path Traversal: Theo dõi các tham chiếu giữa các điều khoản
- Community Awareness: Hiểu bối cảnh phân cấp của điều khoản

**Lưu ý quan trọng:**
- Đây là thông tin tham khảo, không thay thế cho tư vấn pháp lý chuyên nghiệp.
- Nên tham khảo văn bản pháp luật gốc để có thông tin chính xác.
- Để cải thiện chất lượng phản hồi, cần tích hợp LLM thực tế (Anthropic/OpenAI).
`;
  }
}

// ----------------------------------------------------------------------------
// Local Llama Server Adapter
// ----------------------------------------------------------------------------

export class LlamaLLMAdapter extends BaseLLM {
  constructor(
    private apiUrl: string = "http://localhost:8080",
    private options: { temperature?: number; maxTokens?: number } = {},
  ) {
    super();
  }

  async generate(
    prompt: string,
    _options?: Record<string, unknown>,
  ): Promise<LLMResponse> {
    try {
      const response = await fetch(`${this.apiUrl}/completion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          n_predict: this.options.maxTokens || 2000,
          temperature: this.options.temperature ?? 0.3,
          stop: ["</s>", "<|eot_id|>", "<|end|>"],
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Llama server error ${response.status}: ${text}`);
      }

      const result = (await response.json()) as any;
      const content = result.content || result.response || "";

      return {
        content,
        usage: {
          promptTokens: result.tokens_evaluated || 0,
          completionTokens: result.tokens_predicted || 0,
          totalTokens:
            (result.tokens_evaluated || 0) + (result.tokens_predicted || 0),
        },
      };
    } catch (error) {
      logger.error("Llama server API error", error);
      throw error;
    }
  }

  async *stream(
    prompt: string,
    _options?: Record<string, unknown>,
  ): AsyncIterable<string> {
    try {
      const response = await fetch(`${this.apiUrl}/completion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          n_predict: this.options.maxTokens || 2000,
          temperature: this.options.temperature ?? 0.3,
          stop: ["</s>", "<|eot_id|>", "<|end|>"],
          stream: true,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Llama server error ${response.status}: ${text}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body to stream");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine.startsWith("data:")) continue;
          const jsonStr = cleanLine.substring(5).trim();
          if (jsonStr === "[DONE]") continue;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.content;
            if (content) {
              yield content;
            }
          } catch {
            // Ignore parse errors for incomplete lines
          }
        }
      }
    } catch (error) {
      logger.error("Llama server streaming error", error);
      yield "Lỗi khi kết nối với dịch vụ AI cục bộ.";
    }
  }

  async embed(_text: string): Promise<EmbeddingResponse> {
    throw new Error(
      "Llama adapter doesn't provide embeddings. Use Xenova transformers.",
    );
  }
}

// ----------------------------------------------------------------------------
// OpenAI LLM Adapter
// ----------------------------------------------------------------------------

export class OpenAILLMAdapter extends BaseLLM {
  constructor(
    private apiKey: string,
    private model: string = "gpt-3.5-turbo",
    private apiUrl: string = "https://api.openai.com/v1",
    private options: { temperature?: number; maxTokens?: number } = {},
  ) {
    super();
  }

  async generate(
    prompt: string,
    _options?: Record<string, unknown>,
  ): Promise<LLMResponse> {
    try {
      const response = await fetch(`${this.apiUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          temperature: this.options.temperature ?? 0.3,
          max_tokens: this.options.maxTokens || 2000,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${text}`);
      }

      const result = (await response.json()) as any;
      const content = result.choices[0]?.message?.content || "";

      return {
        content,
        usage: {
          promptTokens: result.usage?.prompt_tokens || 0,
          completionTokens: result.usage?.completion_tokens || 0,
          totalTokens: result.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      logger.error("OpenAI API error", error);
      throw error;
    }
  }

  async *stream(
    prompt: string,
    _options?: Record<string, unknown>,
  ): AsyncIterable<string> {
    try {
      const response = await fetch(`${this.apiUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          temperature: this.options.temperature ?? 0.3,
          max_tokens: this.options.maxTokens || 2000,
          stream: true,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${text}`);
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine.startsWith("data:")) continue;
          const jsonStr = cleanLine.substring(5).trim();
          if (jsonStr === "[DONE]") continue;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices[0]?.delta?.content;
            if (content) {
              yield content;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    } catch (error) {
      logger.error("OpenAI streaming error", error);
      yield "Lỗi khi kết nối với dịch vụ AI.";
    }
  }

  async embed(_text: string): Promise<EmbeddingResponse> {
    throw new Error(
      "OpenAI adapter doesn't provide embeddings. Use Xenova transformers.",
    );
  }
}

// ----------------------------------------------------------------------------
// Factory Functions
// ----------------------------------------------------------------------------

export function createLLMAdapter(
  embedder: IEmbedder,
  options: LLMAdapterOptions = {},
): BaseLLM {
  const { provider = "template", apiKey, model, apiUrl } = options;

  switch (provider) {
    case "anthropic":
      if (!apiKey) {
        logger.warn("No Anthropic API key provided, falling back to template");
        return new TemplateLLMAdapter(embedder, options);
      }
      try {
        return createAnthropicLLMWithEmbeddings(
          apiKey,
          model || "claude-3-haiku-20240307",
          embedder,
        );
      } catch (error) {
        logger.error(
          "Failed to create Anthropic LLM, falling back to template",
          error,
        );
        return new TemplateLLMAdapter(embedder, options);
      }
    case "openai":
      return new OpenAILLMAdapter(
        apiKey || "",
        model || "gpt-3.5-turbo",
        apiUrl || "https://api.openai.com/v1",
        options,
      );
    case "llama":
      return new LlamaLLMAdapter(apiUrl || "http://localhost:8080", options);
    case "template":
    default:
      return new TemplateLLMAdapter(embedder, options);
  }
}
