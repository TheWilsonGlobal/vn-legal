import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ErrorCode,
  AppError,
  errorHandler,
  notFoundHandler,
  ErrorFactory,
} from "../../../../src/api/middleware/errorHandler";

// Mock logger
vi.mock("../../../../src/shared/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("ErrorHandler Middleware", () => {
  describe("ErrorCode", () => {
    it("should define all error codes", () => {
      expect(ErrorCode.VALIDATION_ERROR).toBe("VALIDATION_ERROR");
      expect(ErrorCode.NOT_FOUND).toBe("NOT_FOUND");
      expect(ErrorCode.INTERNAL_ERROR).toBe("INTERNAL_ERROR");
      expect(ErrorCode.SERVICE_UNAVAILABLE).toBe("SERVICE_UNAVAILABLE");
      expect(ErrorCode.BAD_REQUEST).toBe("BAD_REQUEST");
      expect(ErrorCode.UNAUTHORIZED).toBe("UNAUTHORIZED");
      expect(ErrorCode.FORBIDDEN).toBe("FORBIDDEN");
    });
  });

  describe("AppError", () => {
    it("should create an AppError with all properties", () => {
      const err = new AppError(ErrorCode.NOT_FOUND, "Not found", 404, {
        id: "123",
      });
      expect(err.code).toBe(ErrorCode.NOT_FOUND);
      expect(err.message).toBe("Not found");
      expect(err.statusCode).toBe(404);
      expect(err.details).toEqual({ id: "123" });
      expect(err.name).toBe("AppError");
    });

    it("should default statusCode to 500", () => {
      const err = new AppError(ErrorCode.INTERNAL_ERROR, "Server error");
      expect(err.statusCode).toBe(500);
    });

    it("should be an instance of Error", () => {
      const err = new AppError(ErrorCode.BAD_REQUEST, "Bad");
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe("errorHandler", () => {
    let mockRequest: any;
    let mockReply: any;

    beforeEach(() => {
      mockRequest = {
        method: "POST",
        url: "/api/test",
        body: { data: "test" },
        query: {},
        params: {},
      };
      mockReply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };
    });

    it("should handle AppError correctly", () => {
      const appError = new AppError(
        ErrorCode.NOT_FOUND,
        "Article not found",
        404,
        { articleId: "123" },
      );
      errorHandler(appError, mockRequest, mockReply);
      expect(mockReply.status).toHaveBeenCalledWith(404);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: ErrorCode.NOT_FOUND,
            message: "Article not found",
            details: { articleId: "123" },
          }),
        }),
      );
    });

    it("should handle Fastify validation errors", () => {
      const validationError = {
        message: "Validation failed",
        code: "FST_ERR_VALIDATION",
        statusCode: 400,
        validation: [{ message: "field required", schemaPath: "#/required" }],
      } as any;
      errorHandler(validationError, mockRequest, mockReply);
      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: ErrorCode.VALIDATION_ERROR,
          }),
        }),
      );
    });

    it("should handle generic errors with 500 status", () => {
      const error = { message: "Something broke", statusCode: 500 } as any;
      errorHandler(error, mockRequest, mockReply);
      expect(mockReply.status).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: ErrorCode.INTERNAL_ERROR,
          }),
        }),
      );
    });

    it("should handle generic errors with 4xx status", () => {
      const error = { message: "Bad request", statusCode: 400 } as any;
      errorHandler(error, mockRequest, mockReply);
      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: ErrorCode.BAD_REQUEST,
          }),
        }),
      );
    });

    it("should default to 500 when no statusCode", () => {
      const error = { message: "Unknown error" } as any;
      errorHandler(error, mockRequest, mockReply);
      expect(mockReply.status).toHaveBeenCalledWith(500);
    });

    it("should handle missing error message", () => {
      const error = {} as any;
      errorHandler(error, mockRequest, mockReply);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: "An unexpected error occurred",
          }),
        }),
      );
    });
  });

  describe("notFoundHandler", () => {
    it("should return 404 with route info", () => {
      const mockRequest = { method: "GET", url: "/api/nonexistent" } as any;
      const mockReply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };
      notFoundHandler(mockRequest, mockReply);
      expect(mockReply.status).toHaveBeenCalledWith(404);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: ErrorCode.NOT_FOUND,
            message: "Route GET /api/nonexistent not found",
          }),
        }),
      );
    });
  });

  describe("ErrorFactory", () => {
    it("should create validation error", () => {
      const err = ErrorFactory.validationError("Invalid input", {
        field: "name",
      });
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(err.statusCode).toBe(400);
      expect(err.details).toEqual({ field: "name" });
    });

    it("should create not found error", () => {
      const err = ErrorFactory.notFound("Article");
      expect(err.code).toBe(ErrorCode.NOT_FOUND);
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe("Article not found");
    });

    it("should create bad request error", () => {
      const err = ErrorFactory.badRequest("Missing query");
      expect(err.code).toBe(ErrorCode.BAD_REQUEST);
      expect(err.statusCode).toBe(400);
    });

    it("should create unauthorized error with default message", () => {
      const err = ErrorFactory.unauthorized();
      expect(err.code).toBe(ErrorCode.UNAUTHORIZED);
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe("Unauthorized");
    });

    it("should create unauthorized error with custom message", () => {
      const err = ErrorFactory.unauthorized("Token expired");
      expect(err.message).toBe("Token expired");
    });

    it("should create forbidden error with default message", () => {
      const err = ErrorFactory.forbidden();
      expect(err.code).toBe(ErrorCode.FORBIDDEN);
      expect(err.statusCode).toBe(403);
      expect(err.message).toBe("Forbidden");
    });

    it("should create internal error with default message", () => {
      const err = ErrorFactory.internalError();
      expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(err.statusCode).toBe(500);
      expect(err.message).toBe("Internal server error");
    });

    it("should create service unavailable error", () => {
      const err = ErrorFactory.serviceUnavailable();
      expect(err.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(err.statusCode).toBe(503);
    });

    it("should create service unavailable with custom message", () => {
      const err = ErrorFactory.serviceUnavailable("DB down");
      expect(err.message).toBe("DB down");
    });
  });
});
