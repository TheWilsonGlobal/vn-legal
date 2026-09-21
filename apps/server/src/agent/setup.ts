// ============================================================================
// LangChain Agent Setup for Legal Consultation
// ============================================================================

import type { HybridRetrieval } from "../retrieval/hybrid-congraph";
import type { LegalContextBundle } from "../shared/types";
import logger from "../shared/logger";
import {
  formatMarkdownResponse,
  createErrorResponse,
  LEGAL_CONSULTANT_SYSTEM_PROMPT,
  createConsultationPrompt,
} from "./prompts";
import { llmTracker } from "../shared/llm-tracker";
import { config } from "../shared/config";
import { BaseLLM } from "congraph-rag/core";

// ----------------------------------------------------------------------------
// Legal Consultation Agent
// ----------------------------------------------------------------------------

export class LegalConsultationAgent {
  constructor(
    private retrieval: HybridRetrieval,
    public llm?: BaseLLM,
  ) {}

  getRetrieval() {
    return this.retrieval;
  }

  /**
   * Generate a legal consultation response
   */
  async consult(
    query: string,
    filters?: {
      part_id?: string;
      chapter_id?: string;
      section_id?: string;
      subsection_id?: string;
    },
    mode: "local" | "global" | "auto" = "auto",
    options: { retrievalOnly?: boolean } = {},
  ): Promise<{
    response: string;
    context: LegalContextBundle;
    llmDetails?: {
      systemPrompt: string;
      userPrompt: string;
      output: string;
    };
  }> {
    try {
      logger.info(
        `Generating consultation for query: "${query}" (requested mode: ${mode}, retrievalOnly: ${options.retrievalOnly})`,
      );

      // Step 0: Auto-classify mode if needed
      let activeMode: "local" | "global" =
        mode === "auto" ? this.classifyQuery(query) : mode;
      logger.info(`Auto-routing to: ${activeMode} search`);

      // Step 1: Retrieve legal context
      let context = await this.retrieval.retrieve(query, activeMode, filters);

      // Step 2: Fallback logic
      // If we tried global search but found nothing, fallback to local
      if (activeMode === "global" && context.community_reports.length === 0) {
        logger.info(
          `Global search found 0 reports. Falling back to local search for precision.`,
        );
        activeMode = "local";
        context = await this.retrieval.retrieve(query, "local", filters);
      }

      // Step 3: Check if we found relevant information
      if (
        context.seed_articles.length === 0 &&
        context.community_reports.length === 0
      ) {
        return {
          response: this.noResultsResponse(query),
          context,
        };
      }

      // Step 4: Generate consultation using retrieved context
      let response: string;
      let systemPrompt: string | undefined;
      let userPrompt: string | undefined;

      if (options.retrievalOnly) {
        response = this.retrievalOnlyResponse(context);
      } else {
        const gen = await this.generateResponse(context);
        response = gen.responseText;
        systemPrompt = gen.systemPrompt;
        userPrompt = gen.userPrompt;
      }

      return {
        context,
        ...(!options.retrievalOnly
          ? {
              llmDetails: {
                systemPrompt: systemPrompt || LEGAL_CONSULTANT_SYSTEM_PROMPT,
                userPrompt: userPrompt || createConsultationPrompt(context),
                output: response,
              },
            }
          : {}),
        response: formatMarkdownResponse(response),
      };
    } catch (error) {
      logger.error("Failed to generate consultation", error);
      return {
        response: createErrorResponse(
          error instanceof Error ? error.message : String(error),
        ),
        context: this.emptyContext(query),
      };
    }
  }

  /**
   * Generate consultation response from context
   */
  private async generateResponse(context: LegalContextBundle): Promise<{
    responseText: string;
    systemPrompt?: string;
    userPrompt?: string;
  }> {
    const llm = this.llm;
    if (llm) {
      logger.info(
        `Generating consultation response using LLM provider: ${config.llm.provider}`,
      );
      const systemPrompt = LEGAL_CONSULTANT_SYSTEM_PROMPT;
      const userPrompt = createConsultationPrompt(context);

      llmTracker.setLastLog(systemPrompt, userPrompt, "Thinking...");

      try {
        const result = await llm.generate(userPrompt, { systemPrompt });
        const responseText = result.content;
        llmTracker.setLastLog(systemPrompt, userPrompt, responseText);
        return { responseText, systemPrompt, userPrompt };
      } catch (err: any) {
        logger.error(
          "LLM generation failed, falling back to template response",
          err,
        );
        llmTracker.setLastLog(
          systemPrompt,
          userPrompt,
          `ERROR: ${err.message}`,
        );
        return {
          responseText: this.templateResponse(context),
          systemPrompt,
          userPrompt,
        };
      }
    }

    return { responseText: this.templateResponse(context) };
  }

  /**
   * Template-based response generation
   * (Placeholder for LLM-based generation)
   */
  private templateResponse(context: LegalContextBundle): string {
    const sections: string[] = [];

    // Title
    sections.push(`# Tư vấn pháp luật dân sự`);
    sections.push("");

    // Legal basis
    sections.push("## 1. Pháp luật áp dụng");
    sections.push("");

    for (const seed of context.seed_articles) {
      sections.push(`### ${seed.article.title}`);
      sections.push("");
      sections.push(seed.article.content);
      sections.push("");
    }

    // Referenced articles
    if (context.path_context.length > context.seed_articles.length) {
      sections.push("## 2. Các Điều khoản liên quan");
      sections.push("");
      const uniqueArticles = new Map<
        string,
        (typeof context.path_context)[0]
      >();

      for (const path of context.path_context) {
        if (!uniqueArticles.has(path.article.id)) {
          uniqueArticles.set(path.article.id, path);
        }
      }

      for (const [id, path] of uniqueArticles) {
        if (!context.seed_articles.find((s) => s.article_id === id)) {
          sections.push(`### ${path.article.title}`);
          sections.push("");
          sections.push(path.article.content.substring(0, 500) + "...");
          sections.push("");
        }
      }
    }

    // Analysis
    sections.push("## 3. Phân tích");
    sections.push("");
    sections.push(
      "Dựa trên các quy định pháp luật nêu trên, có thể rút ra các điểm sau:",
    );
    sections.push("");
    sections.push(
      "- Các quy định trên tạo thành khung pháp lý cho vấn đề của bạn",
    );
    sections.push(
      "- Cần xem xét cụ thể tình huống để áp dụng các quy định phù hợp",
    );
    sections.push("");

    // Context information
    if (context.community_context.hierarchical_context) {
      sections.push("## 4. Ngữ cảnh pháp lý");
      sections.push("");
      sections.push(
        `Vị trí trong hệ thống pháp luật: ${context.community_context.hierarchical_context.split(" > ").join(" → ")}`,
      );
      sections.push("");
    }

    // Disclaimer
    sections.push("---");
    sections.push("");
    sections.push(
      "*⚠️ Lưu ý: Thông tin trên chỉ mang tính chất tham khảo và không thay thế cho tư vấn pháp lý chuyên nghiệp. Trong các trường hợp phức tạp, bạn nên寻求 sự tư vấn của luật sư chuyên môn.*",
    );

    return sections.join("\n");
  }

  /**
   * Response when in retrieval-only mode
   */
  private retrievalOnlyResponse(context: LegalContextBundle): string {
    const sections: string[] = [];
    sections.push(`# Kết quả tra cứu (Chế độ truy xuất nhanh)`);
    sections.push("");
    sections.push(
      `*Dưới đây là các căn cứ pháp luật trực tiếp được tìm thấy cho truy vấn của bạn.*`,
    );
    sections.push("");

    if (context.seed_articles.length > 0) {
      sections.push("## Căn cứ pháp lý chính");
      for (const seed of context.seed_articles) {
        sections.push(
          `- **${seed.article.title}**: ${seed.article.content.substring(0, 300)}...`,
        );
      }
      sections.push("");
    }

    if (context.path_context.length > context.seed_articles.length) {
      sections.push("## Các quy định liên quan");
      const added = new Set(context.seed_articles.map((s) => s.article_id));
      for (const path of context.path_context) {
        if (!added.has(path.article.id)) {
          sections.push(
            `- **${path.article.title}** (Liên kết qua: ${path.relationship})`,
          );
          added.add(path.article.id);
        }
      }
      sections.push("");
    }

    if (context.community_context.hierarchical_context) {
      sections.push("## Vị trí trong hệ thống pháp luật");
      sections.push(
        `> ${context.community_context.hierarchical_context.split(" > ").join(" → ")}`,
      );
      sections.push("");
    }

    sections.push("---");
    sections.push(
      "*⚠️ Lưu ý: Đây là chế độ truy xuất dữ liệu thô. Để có phân tích chi tiết, vui lòng sử dụng chế độ Tư vấn đầy đủ.*",
    );

    return sections.join("\n");
  }

  /**
   * Response when no relevant articles found
   */
  private noResultsResponse(query: string): string {
    return `# Không tìm thấy thông tin phù hợp

Xin lỗi, không tìm thấy Điều khoản nào phù hợp với câu hỏi: "${query}"

**Gợi ý**:
- Thử đặt câu hỏi theo cách khác
- Sử dụng các từ khóa pháp lý cụ thể hơn
- Kiểm tra chính tả của các thuật ngữ pháp lý
- Cung cấp thêm chi tiết về tình huống

**Các chủ đề phổ biến** bạn có thể hỏi:
- Quyền và nghĩa vụ của cá nhân, pháp nhân
- Hợp đồng và giao dịch dân sự
- Sở hữu và quyền đối với tài sản
- Thừa kế và di chúc
- Bồi thường thiệt hại
- Gia đình và hôn nhân

Nếu cần trợ giúp, vui lòng liên hệ với chúng tôi.`;
  }

  /**
   * Create empty context
   */
  private emptyContext(query: string): LegalContextBundle {
    return {
      query,
      seed_articles: [],
      path_context: [],
      community_context: {
        part: {} as any,
        chapter: {} as any,
        section: null,
        subsection: null,
        article_count: 0,
        principles: "",
        hierarchical_context: "",
      },
      community_reports: [],
      relevant_concepts: [],
      hierarchical_filter: {},
      timestamp: new Date(),
    };
  }

  /**
   * Classify query intent to decide between Local and Global search
   */
  private classifyQuery(query: string): "local" | "global" {
    const q = query.toLowerCase();

    // Global keywords (broad/thematic)
    const globalKeywords = [
      "tóm tắt",
      "tổng quan",
      "khái quát",
      "chung",
      "phần",
      "chương",
      "mục",
      "toàn bộ",
      "tất cả",
      "quy định về",
      "nguyên tắc",
    ];

    // Specific keywords (granular)
    const localKeywords = [
      "điều",
      "khoản",
      "điểm",
      "chi tiết",
      "cụ thể",
      "thủ tục",
      "bao nhiêu",
      "là gì",
      "thế nào",
    ];

    // Special cases where "chung" is part of a specific legal term (Local)
    const specificChungTerms = [
      "sở hữu chung",
      "tài sản chung",
      "vốn chung",
      "nợ chung",
      "nghĩa vụ chung",
      "sống chung",
      "con chung",
      "sử dụng chung",
    ];
    const isSpecificChung = specificChungTerms.some((term) => q.includes(term));

    // Priority 1: If it's a specific "Chung" term, it's Local
    if (isSpecificChung) return "local";

    // Priority 2: If summary is explicitly requested, it's Global
    if (
      q.includes("tóm tắt") ||
      q.includes("tổng quan") ||
      q.includes("khái quát")
    )
      return "global";

    // Priority 3: Specific article number is mentioned
    if (/\bđiều \d+/i.test(q)) return "local";

    // Check for global/local keyword presence
    const hasGlobal = globalKeywords.some((k) => q.includes(k));
    const hasLocal = localKeywords.some((k) => q.includes(k));

    // Default heuristics
    if (hasGlobal && !hasLocal) return "global";
    return "local"; // Default to local for better precision
  }

  /**
   * Stream consultation response
   */
  async *streamConsultation(
    query: string,
    filters?: {
      part_id?: string;
      chapter_id?: string;
      section_id?: string;
      subsection_id?: string;
    },
    mode: "local" | "global" = "local",
  ): AsyncGenerator<string> {
    try {
      logger.info(`Streaming consultation for query: "${query}"`);

      // Retrieve context
      const context = await this.retrieval.retrieve(query, mode, filters);

      if (context.seed_articles.length === 0) {
        yield this.noResultsResponse(query);
        return;
      }

      const llm = this.llm;
      if (llm) {
        logger.info(
          `Streaming consultation response using LLM provider: ${config.llm.provider}`,
        );
        const systemPrompt = LEGAL_CONSULTANT_SYSTEM_PROMPT;
        const userPrompt = createConsultationPrompt(context);

        llmTracker.setLastLog(
          systemPrompt,
          userPrompt,
          "Streaming response...",
        );

        let fullResponse = "";
        try {
          for await (const chunk of llm.stream(userPrompt, { systemPrompt })) {
            fullResponse += chunk;
            yield formatMarkdownResponse(chunk);
          }
          llmTracker.setLastLog(systemPrompt, userPrompt, fullResponse);
        } catch (err: any) {
          logger.error(
            "LLM streaming failed, falling back to template response",
            err,
          );
          llmTracker.setLastLog(
            systemPrompt,
            userPrompt,
            `ERROR: ${err.message}`,
          );
          const fallback = this.templateResponse(context);
          const formatted = formatMarkdownResponse(fallback);
          const chunkSize = 100;
          for (let i = 0; i < formatted.length; i += chunkSize) {
            yield formatted.substring(i, i + chunkSize);
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
      } else {
        // Generate template response in chunks
        const response = this.templateResponse(context);
        const formatted = formatMarkdownResponse(response);

        // Stream in chunks of ~100 characters
        const chunkSize = 100;
        for (let i = 0; i < formatted.length; i += chunkSize) {
          yield formatted.substring(i, i + chunkSize);

          // Small delay to simulate streaming
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
    } catch (error) {
      logger.error("Failed to stream consultation", error);
      yield createErrorResponse(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

// ----------------------------------------------------------------------------
// Factory Function
// ----------------------------------------------------------------------------

export function createLegalConsultationAgent(
  retrieval: HybridRetrieval,
  llm?: BaseLLM,
): LegalConsultationAgent {
  return new LegalConsultationAgent(retrieval, llm);
}
