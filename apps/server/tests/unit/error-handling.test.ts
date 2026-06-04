// ============================================================================
// Unit Tests - Error Handling Utilities
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  validateArticleId,
  validateQuery,
  validateLevel,
  generateErrorMessage,
  getFallbackResponse,
  recordMetric,
  getMetrics,
  getAverageOperationTime,
  clearMetrics,
} from "../../src/shared/error-handling";

describe("Error Handling - Validation", () => {
  describe("validateArticleId", () => {
    it("should accept valid article IDs", () => {
      expect(validateArticleId("article_1")).toBe(true);
      expect(validateArticleId("article_123")).toBe(true);
      expect(validateArticleId("article_999")).toBe(true);
    });

    it("should reject invalid article IDs", () => {
      expect(validateArticleId("article_abc")).toBe(false);
      expect(validateArticleId("article_-1")).toBe(false);
      expect(validateArticleId("art_123")).toBe(false);
      expect(validateArticleId("article123")).toBe(false);
      expect(validateArticleId("")).toBe(false);
    });
  });

  describe("validateQuery", () => {
    it("should accept valid queries", () => {
      expect(validateQuery("What is contract law?")).toBe(true);
      expect(validateQuery("Điều kiện hợp đồng")).toBe(true);
      expect(validateQuery("a".repeat(1000))).toBe(true);
    });

    it("should reject invalid queries", () => {
      expect(validateQuery("")).toBe(false);
      expect(validateQuery("   ")).toBe(false);
      expect(validateQuery("a".repeat(1001))).toBe(false);
    });
  });

  describe("validateLevel", () => {
    it("should accept valid levels", () => {
      expect(validateLevel(0)).toBe(true);
      expect(validateLevel(1)).toBe(true);
      expect(validateLevel(2)).toBe(true);
      expect(validateLevel(3)).toBe(true);
    });

    it("should reject invalid levels", () => {
      expect(validateLevel(-1)).toBe(false);
      expect(validateLevel(4)).toBe(false);
      expect(validateLevel(1.5)).toBe(false);
      expect(validateLevel(NaN)).toBe(false);
    });
  });
});

describe("Error Handling - Message Generators", () => {
  describe("generateErrorMessage", () => {
    it("should format error messages correctly", () => {
      const error = new Error("Something went wrong");
      expect(generateErrorMessage(error, "TestOperation")).toBe(
        "[TestOperation] Something went wrong",
      );
    });

    it("should handle unknown errors", () => {
      expect(generateErrorMessage("string error", "TestOperation")).toBe(
        "[TestOperation] string error",
      );
    });
  });

  describe("getFallbackResponse", () => {
    it("should return Vietnamese fallback messages", () => {
      expect(getFallbackResponse("retrieval")).toContain(
        "truy xuất thông tin pháp luật",
      );
      expect(getFallbackResponse("llm")).toContain("AI");
      expect(getFallbackResponse("graph")).toContain("đồ thị");
    });

    it("should return default fallback for unknown context", () => {
      expect(getFallbackResponse("unknown")).toContain("Đã có lỗi xảy ra");
    });
  });
});

describe("Error Handling - Metrics", () => {
  beforeEach(() => {
    clearMetrics();
  });

  afterEach(() => {
    clearMetrics();
  });

  describe("recordMetric", () => {
    it("should record metrics with timestamp", () => {
      recordMetric({
        operation: "testOp",
        duration: 100,
        success: true,
      });

      const metrics = getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].operation).toBe("testOp");
      expect(metrics[0].duration).toBe(100);
      expect(metrics[0].success).toBe(true);
      expect(metrics[0].timestamp).toBeDefined();
    });

    it("should record failed operations", () => {
      recordMetric({
        operation: "testOp",
        duration: 50,
        success: false,
        error: "Test error",
      });

      const metrics = getMetrics();
      expect(metrics[0].success).toBe(false);
      expect(metrics[0].error).toBe("Test error");
    });
  });

  describe("getMetrics", () => {
    it("should return a copy of metrics", () => {
      recordMetric({
        operation: "testOp",
        duration: 100,
        success: true,
      });

      const metrics1 = getMetrics();
      const metrics2 = getMetrics();

      expect(metrics1).not.toBe(metrics2);
      expect(metrics1).toHaveLength(metrics2.length);
    });
  });

  describe("getAverageOperationTime", () => {
    it("should calculate average for successful operations", () => {
      recordMetric({ operation: "testOp", duration: 100, success: true });
      recordMetric({ operation: "testOp", duration: 200, success: true });
      recordMetric({ operation: "testOp", duration: 300, success: false });

      const avg = getAverageOperationTime("testOp");
      expect(avg).toBe(150); // Average of successful only
    });

    it("should return 0 for unknown operations", () => {
      const avg = getAverageOperationTime("unknownOp");
      expect(avg).toBe(0);
    });

    it("should return 0 when no successful operations exist", () => {
      recordMetric({ operation: "testOp", duration: 100, success: false });

      const avg = getAverageOperationTime("testOp");
      expect(avg).toBe(0);
    });
  });

  describe("clearMetrics", () => {
    it("should clear all metrics", () => {
      recordMetric({ operation: "testOp", duration: 100, success: true });
      expect(getMetrics()).toHaveLength(1);

      clearMetrics();
      expect(getMetrics()).toHaveLength(0);
    });
  });

  describe("recordMetric - limits", () => {
    it("should limit metrics to 1000 items", () => {
      for (let i = 0; i < 1050; i++) {
        recordMetric({ operation: "testOp", duration: i, success: true });
      }
      expect(getMetrics()).toHaveLength(1000);
    });
  });
});

import {
  withFallback,
  safeGraphOperation,
  safeLLMOperation,
  withRetry,
  logRetrievalContext,
  logPerformance,
} from "../../src/shared/error-handling";
import logger from "../../src/shared/logger";
import { vi } from "vitest";

describe("Error Handling - Execution Wrappers", () => {
  describe("withFallback", () => {
    it("should return primary data on success", async () => {
      const primary = async () => "primary";
      const fallback = async () => "fallback";
      const result = await withFallback(primary, fallback, "test");
      expect(result.success).toBe(true);
      expect(result.data).toBe("primary");
      expect(result.usedFallback).toBe(false);
    });

    it("should use fallback when primary fails", async () => {
      const primary = async () => {
        throw new Error("primary failed");
      };
      const fallback = async () => "fallback";
      const result = await withFallback(primary, fallback, "test");
      expect(result.success).toBe(true);
      expect(result.data).toBe("fallback");
      expect(result.usedFallback).toBe(true);
      expect(result.error?.message).toBe("primary failed");
    });

    it("should return success: false when both fail", async () => {
      const primary = async () => {
        throw new Error("primary failed");
      };
      const fallback = async () => {
        throw new Error("fallback failed");
      };
      const result = await withFallback(primary, fallback, "test");
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe("fallback failed");
    });
  });

  describe("safeGraphOperation", () => {
    it("should return operation result on success", async () => {
      const result = await safeGraphOperation(
        "test",
        async () => "ok",
        "default",
      );
      expect(result).toBe("ok");
    });

    it("should return default value on failure", async () => {
      const result = await safeGraphOperation(
        "test",
        async () => {
          throw new Error("fail");
        },
        "default",
      );
      expect(result).toBe("default");
    });
  });

  describe("safeLLMOperation", () => {
    it("should return operation result on success", async () => {
      const result = await safeLLMOperation(
        "test",
        async () => "ok",
        "default",
      );
      expect(result).toBe("ok");
    });

    it("should return fallback value on failure", async () => {
      const result = await safeLLMOperation(
        "test",
        async () => {
          throw new Error("fail");
        },
        "default",
      );
      expect(result).toBe("default");
    });
  });

  describe("withRetry", () => {
    it("should return result on first success", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      const result = await withRetry(fn, 3, 0);
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry and succeed", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail1"))
        .mockResolvedValueOnce("ok");
      const result = await withRetry(fn, 3, 0);
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should throw after max retries", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("fail"));
      await expect(withRetry(fn, 2, 0)).rejects.toThrow(
        "Operation failed after 2 attempts",
      );
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});

describe("Error Handling - Logging Helpers", () => {
  it("should log retrieval context", () => {
    const debugSpy = vi.spyOn(logger, "debug");
    logRetrievalContext({ query: "test", mode: "local" });
    expect(debugSpy).toHaveBeenCalled();
    debugSpy.mockRestore();
  });

  it("should log performance", () => {
    const debugSpy = vi.spyOn(logger, "debug");
    logPerformance("op", 100);
    expect(debugSpy).toHaveBeenCalledWith("Performance: op completed in 100ms");

    logPerformance("op", 100, { key: "val" });
    expect(debugSpy).toHaveBeenCalledWith(
      "Performance: op completed in 100ms",
      { key: "val" },
    );
    debugSpy.mockRestore();
  });
});
