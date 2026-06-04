// ============================================================================
// Request Validation Middleware
// ============================================================================

import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";

// ----------------------------------------------------------------------------
// Validation Error
// ----------------------------------------------------------------------------

export class ValidationError extends Error {
  constructor(
    public errors: Array<{
      path: string[];
      message: string;
      code: string;
    }>,
  ) {
    super("Validation failed");
    this.name = "ValidationError";
  }
}

// ----------------------------------------------------------------------------
// Validation Middleware Factory
// ----------------------------------------------------------------------------

export function validateRequest<T extends z.ZodType>(schema: T) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    try {
      // Validate body
      if (request.body && schema instanceof z.ZodObject) {
        const bodySchema = schema;
        request.body = bodySchema.parse(request.body);
      }

      // Validate query
      if (request.query && schema instanceof z.ZodObject) {
        const querySchema = schema;
        request.query = querySchema.parse(request.query);
      }

      // Validate params
      if (request.params && schema instanceof z.ZodObject) {
        const paramsSchema = schema;
        request.params = paramsSchema.parse(request.params);
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationError = new ValidationError(
          error.errors.map((e) => ({
            path: e.path.map(String),
            message: e.message,
            code: e.code,
          })),
        );

        reply.status(400).send({
          error: "Validation failed",
          details: validationError.errors,
        });
        return;
      }

      throw error;
    }
  };
}

// ----------------------------------------------------------------------------
// Common Validation Schemas
// ----------------------------------------------------------------------------

export const schemas = {
  // Query parameter validation
  query: {
    search: z.object({
      q: z.string().min(1),
      limit: z.number().min(1).max(100).optional().default(10),
      offset: z.number().min(0).optional().default(0),
    }),

    pagination: z.object({
      page: z.number().min(1).optional().default(1),
      limit: z.number().min(1).max(100).optional().default(20),
    }),
  },

  // Request body validation
  body: {
    consultation: z.object({
      query: z.string().min(1).max(1000),
      filters: z
        .object({
          part_id: z.string().optional(),
          chapter_id: z.string().optional(),
          section_id: z.string().optional(),
          subsection_id: z.string().optional(),
        })
        .optional(),
      stream: z.boolean().optional().default(false),
    }),
  },

  // Path parameter validation
  params: {
    articleId: z.object({
      id: z.string().regex(/^article_\d+$/, {
        message: "Invalid article ID format. Expected: article_N",
      }),
    }),

    clauseId: z.object({
      id: z.string().regex(/^article_\d+_clause_\d+$/, {
        message: "Invalid clause ID format. Expected: article_N_clause_M",
      }),
    }),
  },
};
