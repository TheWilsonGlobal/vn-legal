// ============================================================================
// Legal Consultant Prompt Templates
// ============================================================================

import type { LegalContextBundle } from "../shared/types";

// ----------------------------------------------------------------------------
// System Prompt
// ----------------------------------------------------------------------------

export const LEGAL_CONSULTANT_SYSTEM_PROMPT = `Bạn là một chuyên gia tư vấn pháp luật Việt Nam chuyên về Bộ luật Dân sự. Nhiệm vụ của bạn là cung cấp lời khuyên pháp lý rõ ràng, chính xác và có căn cứ.

# Nguyên tắc tư vấn

1. **Chính xác**: Luôn trích dẫn các điều luật cụ thể có liên quan
2. **Rõ ràng**: Giải thích bằng ngôn ngữ dễ hiểu, tránh thuật ngữ pháp lý quá phức tạp
3. **Có căn cứ**: Mọi lời khuyên phải dựa trên các quy định của pháp luật
4. **Toàn diện**: Xem xét các khía cạnh liên quan của vấn đề
5. **Thực tế**: Đưa ra các khuyến nghị khả thi và áp dụng được

# Cách trình bày

- Sử dụng **in đậm** cho số Điều khoản (ví dụ: **Điều 21**)
- Sử dụng _in nghiêng_ cho tên Chương, Mục
- Trình bày theo cấu trúc: Pháp luật áp dụng → Phân tích → Khuyến nghị
- Luôn ghi rõ nguồn các quy định được trích dẫn

# Lưu ý quan trọng

- Đây là thông tin tham khảo, không thay thế cho tư vấn pháp lý chuyên nghiệp
- Trong các trường hợp phức tạp, khuyến nghị người dùng寻求 luật sư chuyên môn
- Luôn kiểm tra các điều kiện, ngoại lệ và trường hợp đặc biệt nếu có`;

// ----------------------------------------------------------------------------
// Consultation Prompt Template
// ----------------------------------------------------------------------------

export function createConsultationPrompt(context: LegalContextBundle): string {
  const sections = [
    "# Thông tin tư vấn",
    `**Câu hỏi**: ${context.query}`,
    "",
    "# Căn cứ pháp lý",
    formatLegalBasis(context),
    "",
    "# Yêu cầu",
    `Dựa trên các thông tin pháp lý trên, hãy phân tích tình huống và đưa ra lời khuyên.`,
    "",
    "## Cấu trúc trả lời",
    context.community_reports.length > 0
      ? "1. **Tổng quan pháp lý (Global Synthesis)**: Tóm tắt các chủ đề pháp lý lớn liên quan đến câu hỏi"
      : "1. **Pháp luật áp dụng**: Liệt kê các Điều khoản có liên quan",
    "2. **Phân tích pháp lý**: Giải thích cách các quy định áp dụng cho tình huống",
    "3. **Lời khuyên**: Đưa ra các khuyến nghị cụ thể",
    "4. **Lưu ý**: Các điều kiện, ngoại lệ cần lưu ý",
  ];

  return sections.join("\n");
}

// ----------------------------------------------------------------------------
// Helper Functions
// ----------------------------------------------------------------------------

function formatLegalBasis(context: LegalContextBundle): string {
  const sections: string[] = [];

  // Seed articles
  if (context.seed_articles.length > 0) {
    sections.push("### Các Điều khoản chính");
    for (const seed of context.seed_articles) {
      sections.push(`- **${seed.article.title}**`);
      sections.push(`  (Độ phù hợp: ${(seed.score * 100).toFixed(1)}%)`);
    }
  }

  // Path context (referenced articles)
  if (context.path_context.length > 0) {
    sections.push("");
    sections.push("### Các Điều khoản liên quan");
    const uniqueArticles = new Set<string>();
    for (const path of context.path_context) {
      if (!uniqueArticles.has(path.article.id)) {
        sections.push(`- **${path.article.title}**`);
        if (path.relationship !== "seed") {
          sections.push(`  (${path.relationship})`);
        }
        uniqueArticles.add(path.article.id);
      }
    }
  }

  // Community context
  if (context.community_context.hierarchical_context) {
    sections.push("");
    sections.push("### Ngữ cảnh pháp lý");
    sections.push(
      `- ${context.community_context.hierarchical_context.split(" > ").join(" → ")}`,
    );
    if (context.community_context.principles) {
      sections.push(
        `- Nguyên tắc chung: ${context.community_context.principles}`,
      );
    }
  }

  // Community reports (Global search)
  if (context.community_reports && context.community_reports.length > 0) {
    sections.push("### Tóm tắt các Chương/Phần liên quan");
    for (const report of context.community_reports) {
      sections.push(
        `- **${report.title}** (Cấp độ: ${report.level === 0 ? "Phần" : "Chương"})`,
      );
      sections.push(`  *Tóm tắt*: ${report.summary}`);
      if (report.findings.length > 0) {
        sections.push(`  *Các điểm chính*:`);
        for (const finding of report.findings) {
          sections.push(`    + ${finding}`);
        }
      }
      sections.push("");
    }
  }

  // Relevant concepts
  if (context.relevant_concepts.length > 0) {
    sections.push("");
    sections.push("### Các khái niệm pháp lý liên quan");
    for (const concept of context.relevant_concepts.slice(0, 5)) {
      sections.push(`- ${concept.name}`);
    }
  }

  return sections.join("\n");
}

// ----------------------------------------------------------------------------
// Streaming Response Formatter
// ----------------------------------------------------------------------------

export function formatMarkdownResponse(text: string): string {
  return text
    .replace(/điều (\d+)/gi, "**Điều $1**")
    .replace(/khoản (\d+)/gi, "**khoản $1**")
    .replace(/điểm ([a-zđ])\b/gi, "**điểm $1**")
    .replace(/chương ([ivx]+)/gi, "_Chương $1_")
    .replace(/(tiểu mục|mục) (\d+)/gi, (match, type, num) => {
      const formattedType =
        type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
      return `_${formattedType} ${num}_`;
    });
}

// ----------------------------------------------------------------------------
// Follow-up Questions Generator
// ----------------------------------------------------------------------------

export function generateFollowUpQuestions(
  context: LegalContextBundle,
): string[] {
  const questions: string[] = [];

  // Based on community context
  if (context.community_context.section) {
    questions.push(
      `Bạn có muốn biết thêm về các quy định trong ${context.community_context.section.name_short} không?`,
    );
  }

  // Based on referenced articles
  if (context.path_context.length > 1) {
    questions.push(
      "Bạn có muốn giải thích thêm về mối quan hệ giữa các Điều khoản trên không?",
    );
  }

  // Based on concepts
  if (context.relevant_concepts.length > 0) {
    const topConcept = context.relevant_concepts[0];
    questions.push(
      `Bạn có muốn tìm hiểu thêm về khái niệm "${topConcept.name}" không?`,
    );
  }

  // General follow-up
  questions.push("Tình huống cụ thể của bạn là gì?");
  questions.push("Có thêm chi tiết nào bạn muốn chia sẻ không?");

  return questions.slice(0, 3);
}

// ----------------------------------------------------------------------------
// Error Response
// ----------------------------------------------------------------------------

export function createErrorResponse(error: string): string {
  return `# Xin lỗi, đã xảy ra lỗi

Không thể xử lý yêu cầu của bạn lúc này. Vui lòng thử lại sau.

**Chi tiết lỗi**: ${error}

Nếu vấn đề tiếp diễn ra, vui lòng:
- Kiểm tra lại câu hỏi của bạn
- Thử đặt câu hỏi theo cách khác
- Liên hệ với chúng tôi để được hỗ trợ`;
}
