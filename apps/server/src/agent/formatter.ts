// ============================================================================
// Response Formatter
// ============================================================================

import type { LegalContextBundle } from "../shared/types";
import { generateFollowUpQuestions } from "./prompts";

// ----------------------------------------------------------------------------
// Formatted Response
// ----------------------------------------------------------------------------

export interface FormattedConsultationResponse {
  markdown: string;
  html: string;
  text: string;
  metadata: ConsultationMetadata;
}

export interface ConsultationMetadata {
  query: string;
  timestamp: Date;
  articlesCited: number;
  conceptsFound: number;
  hierarchicalContext: string;
  followUpQuestions: string[];
}

// ----------------------------------------------------------------------------
// Formatter Class
// ----------------------------------------------------------------------------

export class ResponseFormatter {
  /**
   * Format consultation response for different output formats
   */
  formatResponse(
    response: string,
    context: LegalContextBundle,
  ): FormattedConsultationResponse {
    return {
      markdown: response,
      html: this.markdownToHtml(response),
      text: this.markdownToText(response),
      metadata: {
        query: context.query,
        timestamp: context.timestamp,
        articlesCited:
          context.seed_articles.length + context.path_context.length,
        conceptsFound: context.relevant_concepts.length,
        hierarchicalContext: context.community_context.hierarchical_context,
        followUpQuestions: generateFollowUpQuestions(context),
      },
    };
  }

  /**
   * Convert markdown to HTML (simplified)
   */
  private markdownToHtml(markdown: string): string {
    return markdown
      .replace(/^### (.*$)/gim, "<h3>$1</h3>")
      .replace(/^## (.*$)/gim, "<h2>$1</h2>")
      .replace(/^# (.*$)/gim, "<h1>$1</h1>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/\n\n/g, "</p><p>")
      .replace(/\n/g, "<br>")
      .replace(/^/, "<p>")
      .replace(/$/, "</p>");
  }

  /**
   * Convert markdown to plain text
   */
  private markdownToText(markdown: string): string {
    return markdown
      .replace(/^### (.*$)/gim, "$1")
      .replace(/^## (.*$)/gim, "$1")
      .replace(/^# (.*$)/gim, "$1")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\n+/g, "\n\n")
      .trim();
  }

  /**
   * Format article citation
   */
  formatArticleCitation(
    articleId: string,
    articleNumber: number,
    title: string,
  ): string {
    return `**Điều ${articleNumber}**: ${title}`;
  }

  /**
   * Format clause citation
   */
  formatClauseCitation(
    articleNumber: number,
    clauseNumber: number,
    text: string,
  ): string {
    const truncatedText =
      text.length > 100 ? text.substring(0, 100) + "..." : text;
    return `**Khoản ${clauseNumber}, Điều ${articleNumber}**: ${truncatedText}`;
  }

  /**
   * Format hierarchical path for display
   */
  formatHierarchicalPath(context: LegalContextBundle): string {
    if (!context.community_context.hierarchical_context) {
      return "";
    }

    return context.community_context.hierarchical_context
      .split(" > ")
      .join(" → ");
  }

  /**
   * Format legal concepts as tags
   */
  formatConceptTags(
    concepts: Array<{ name: string; category?: string }>,
  ): string[] {
    return concepts.map((c) => {
      if (c.category) {
        return `${c.name} (${c.category})`;
      }
      return c.name;
    });
  }
}

// ----------------------------------------------------------------------------
// Factory Function
// ----------------------------------------------------------------------------

export function createResponseFormatter(): ResponseFormatter {
  return new ResponseFormatter();
}
