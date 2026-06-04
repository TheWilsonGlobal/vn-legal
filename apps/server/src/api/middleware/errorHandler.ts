// ============================================================================
// Error Handler Middleware
// ============================================================================

import type { FastifyError, FastifyRequest, FastifyReply } from "fastify";
import logger from "../../shared/logger";

// ----------------------------------------------------------------------------
// Error Types
// ----------------------------------------------------------------------------

export enum ErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  NOT_FOUND = "NOT_FOUND",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  BAD_REQUEST = "BAD_REQUEST",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 500,
    public details?: any,
  ) {
    super(message);
    this.name = "AppError";
  }
}

// ----------------------------------------------------------------------------
// Error Handler
// ----------------------------------------------------------------------------

export function errorHandler(
  error: FastifyError | AppError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Log error safely
  try {
    logger.error({
      error: {
        message: error.message,
        code: (error as any).code,
        statusCode: (error as any).statusCode,
      },
      request: {
        method: request.method,
        url: request.url,
        body: request.body,
        query: request.query,
        params: request.params,
      },
    });
  } catch (logError) {
    console.error("Critical: Error during error logging", logError);
  }

  // Handle AppError
  if (error instanceof AppError) {
    reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  // Handle Fastify validation errors
  if (error.validation) {
    reply.status(400).send({
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: "Request validation failed",
        details: error.validation,
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  // Handle other errors
  const statusCode = error.statusCode || 500;

  reply.status(statusCode).send({
    error: {
      code:
        statusCode >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST,
      message: error.message || "An unexpected error occurred",
      timestamp: new Date().toISOString(),
    },
  });
}

// ----------------------------------------------------------------------------
// Not Found Handler
// ----------------------------------------------------------------------------

export function notFoundHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  reply.status(404).send({
    error: {
      code: ErrorCode.NOT_FOUND,
      message: `Route ${request.method} ${request.url} not found`,
      timestamp: new Date().toISOString(),
    },
  });
}

// ----------------------------------------------------------------------------
// Error Factory Functions
// ----------------------------------------------------------------------------

export const ErrorFactory = {
  validationError: (message: string, details?: any) =>
    new AppError(ErrorCode.VALIDATION_ERROR, message, 400, details),

  notFound: (resource: string) =>
    new AppError(ErrorCode.NOT_FOUND, `${resource} not found`, 404),

  badRequest: (message: string) =>
    new AppError(ErrorCode.BAD_REQUEST, message, 400),

  unauthorized: (message: string = "Unauthorized") =>
    new AppError(ErrorCode.UNAUTHORIZED, message, 401),

  forbidden: (message: string = "Forbidden") =>
    new AppError(ErrorCode.FORBIDDEN, message, 403),

  internalError: (message: string = "Internal server error") =>
    new AppError(ErrorCode.INTERNAL_ERROR, message, 500),

  serviceUnavailable: (message: string = "Service temporarily unavailable") =>
    new AppError(ErrorCode.SERVICE_UNAVAILABLE, message, 503),
};
