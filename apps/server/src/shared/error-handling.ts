// ============================================================================
// Error Handling Utilities for ConGraphRAG Integration
// ============================================================================

import logger from "../shared/logger";

// ----------------------------------------------------------------------------
// Error Types
// ----------------------------------------------------------------------------

export class ConGraphRAGError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause?: Error,
  ) {
    super(message);
    this.name = "ConGraphRAGError";
  }
}

export class GraphBuildError extends ConGraphRAGError {
  constructor(message: string, cause?: Error) {
    super(message, "GRAPH_BUILD_ERROR", cause);
    this.name = "GraphBuildError";
  }
}

export class RetrievalError extends ConGraphRAGError {
  constructor(message: string, cause?: Error) {
    super(message, "RETRIEVAL_ERROR", cause);
    this.name = "RetrievalError";
  }
}

export class LLMError extends ConGraphRAGError {
  constructor(message: string, cause?: Error) {
    super(message, "LLM_ERROR", cause);
    this.name = "LLMError";
  }
}

// ----------------------------------------------------------------------------
// Error Handler with Fallback
// ----------------------------------------------------------------------------

export interface FallbackResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  usedFallback: boolean;
}

export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
  context: string,
): Promise<FallbackResult<T>> {
  try {
    logger.debug(`Attempting primary operation: ${context}`);
    const data = await primary();
    return {
      success: true,
      data,
      usedFallback: false,
    };
  } catch (primaryError) {
    logger.warn(
      `Primary operation failed for ${context}, using fallback`,
      primaryError,
    );

    try {
      const data = await fallback();
      return {
        success: true,
        data,
        usedFallback: true,
        error: primaryError,
      };
    } catch (fallbackError) {
      logger.error(`Both primary and fallback failed for ${context}`, {
        primary: primaryError,
        fallback: fallbackError,
      });
      return {
        success: false,
        error: fallbackError,
        usedFallback: false,
      };
    }
  }
}

// ----------------------------------------------------------------------------
// Safe Execution Wrappers
// ----------------------------------------------------------------------------

/**
 * Safely execute graph operations with error handling
 */
export async function safeGraphOperation<T>(
  operation: string,
  fn: () => Promise<T>,
  defaultValue: T,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.error(`Graph operation failed: ${operation}`, error);
    // Could send to monitoring service here
    return defaultValue;
  }
}

/**
 * Safely execute LLM operations with error handling
 */
export async function safeLLMOperation<T>(
  operation: string,
  fn: () => Promise<T>,
  fallbackResponse: T,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.error(`LLM operation failed: ${operation}`, error);
    // Could track failed operations for monitoring
    return fallbackResponse;
  }
}

/**
 * Retry logic for transient failures
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries) {
        logger.debug(`Attempt ${attempt} failed, retrying in ${delayMs}ms...`, {
          error: error.message,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new RetrievalError(
    `Operation failed after ${maxRetries} attempts`,
    lastError,
  );
}

// ----------------------------------------------------------------------------
// Validation Helpers
// ----------------------------------------------------------------------------

export function validateArticleId(id: string): boolean {
  // Article IDs should be in format "article_NUMBER"
  return /^article_\d+$/.test(id);
}

export function validateQuery(query: string): boolean {
  // Basic validation for queries
  return Boolean(query) && query.trim().length > 0 && query.length <= 1000;
}

export function validateLevel(level: number): boolean {
  // Community levels should be 0-3
  return Number.isInteger(level) && level >= 0 && level <= 3;
}

// ----------------------------------------------------------------------------
// Error Message Generators
// ----------------------------------------------------------------------------

export function generateErrorMessage(
  error: Error | unknown,
  context: string,
): string {
  if (error instanceof Error) {
    return `[${context}] ${error.message}`;
  }
  return `[${context}] ${String(error)}`;
}

export function getFallbackResponse(context: string): string {
  const fallbacks: Record<string, string> = {
    retrieval:
      "Xin lỗi, không thể truy xuất thông tin pháp luật lúc này. Vui lòng thử lại sau.",
    llm: "Hệ thống AI đang gặp sự cố. Vui lòng thử lại sau.",
    graph: "Cơ sở dữ liệu đồ thị đang được khởi tạo. Vui lòng thử lại sau.",
    default: "Đã có lỗi xảy ra. Vui lòng thử lại.",
  };

  return fallbacks[context] || fallbacks.default;
}

// ----------------------------------------------------------------------------
// Logging Helpers
// ----------------------------------------------------------------------------

export function logRetrievalContext(context: {
  query: string;
  mode?: string;
  level?: number;
  filters?: Record<string, unknown>;
}): void {
  logger.debug("Retrieval context:", {
    query: context.query.substring(0, 100),
    mode: context.mode,
    level: context.level,
    filters: context.filters,
  });
}

export function logPerformance(
  operation: string,
  duration: number,
  metadata?: Record<string, unknown>,
): void {
  if (metadata) {
    logger.debug(
      `Performance: ${operation} completed in ${duration}ms`,
      metadata,
    );
  } else {
    logger.debug(`Performance: ${operation} completed in ${duration}ms`);
  }
}

// ----------------------------------------------------------------------------
// Monitoring Hooks
// ----------------------------------------------------------------------------

export interface MetricData {
  operation: string;
  duration: number;
  success: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
  timestamp?: number;
}

const metrics: MetricData[] = [];

export function recordMetric(metric: MetricData): void {
  metrics.push({
    ...metric,
    timestamp: Date.now(),
  });

  // Keep only last 1000 metrics
  if (metrics.length > 1000) {
    metrics.splice(0, metrics.length - 1000);
  }
}

export function getMetrics(): MetricData[] {
  return [...metrics];
}

export function clearMetrics(): void {
  metrics.length = 0;
}

export function getAverageOperationTime(operation: string): number {
  const opMetrics = metrics.filter(
    (m) => m.operation === operation && m.success,
  );
  if (opMetrics.length === 0) return 0;

  const total = opMetrics.reduce((sum, m) => sum + m.duration, 0);
  return total / opMetrics.length;
}
