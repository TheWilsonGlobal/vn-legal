import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import {
  ValidationError,
  validateRequest,
  schemas,
} from "../../../../src/api/middleware/validation";

describe("Validation Middleware", () => {
  describe("ValidationError", () => {
    it("should create a ValidationError with errors array", () => {
      const errors = [
        { path: ["body", "query"], message: "Required", code: "invalid_type" },
      ];
      const err = new ValidationError(errors);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("ValidationError");
      expect(err.message).toBe("Validation failed");
      expect(err.errors).toEqual(errors);
    });
  });

  describe("validateRequest", () => {
    const testSchema = z.object({
      name: z.string().min(1),
      age: z.number().min(0),
    });

    let mockReply: any;

    beforeEach(() => {
      mockReply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };
    });

    it("should validate body successfully", async () => {
      const mockRequest = {
        body: { name: "Test", age: 25 },
        query: null,
        params: null,
      } as any;
      const middleware = validateRequest(testSchema);
      await middleware(mockRequest, mockReply);
      // Should not call reply.status since validation passed
      expect(mockReply.status).not.toHaveBeenCalled();
    });

    it("should validate body and update request.body", async () => {
      const schemaWithDefaults = z.object({
        name: z.string(),
        active: z.boolean().optional().default(true),
      });
      const mockRequest = {
        body: { name: "Test" },
        query: null,
        params: null,
      } as any;
      const middleware = validateRequest(schemaWithDefaults);
      await middleware(mockRequest, mockReply);
      expect(mockRequest.body.active).toBe(true);
    });

    it("should return 400 on body validation failure", async () => {
      const mockRequest = {
        body: { name: "", age: -1 },
        query: null,
        params: null,
      } as any;
      const middleware = validateRequest(testSchema);
      await middleware(mockRequest, mockReply);
      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Validation failed",
        }),
      );
    });

    it("should validate query params", async () => {
      const mockRequest = {
        body: null,
        query: { name: "Test", age: 30 },
        params: null,
      } as any;
      const middleware = validateRequest(testSchema);
      await middleware(mockRequest, mockReply);
      expect(mockReply.status).not.toHaveBeenCalled();
    });

    it("should validate path params", async () => {
      const mockRequest = {
        body: null,
        query: null,
        params: { name: "Test", age: 30 },
      } as any;
      const middleware = validateRequest(testSchema);
      await middleware(mockRequest, mockReply);
      expect(mockReply.status).not.toHaveBeenCalled();
    });

    it("should re-throw non-ZodError exceptions", async () => {
      // Create a schema that internally throws a non-Zod error
      const badSchema = {
        parse: () => {
          throw new Error("Internal error");
        },
        [Symbol.hasInstance]: () => true,
      };
      // Workaround: override instanceof check
      Object.setPrototypeOf(badSchema, z.ZodObject.prototype);
      const mockRequest = {
        body: { something: "value" },
        query: null,
        params: null,
      } as any;
      const middleware = validateRequest(badSchema as any);
      await expect(middleware(mockRequest, mockReply)).rejects.toThrow(
        "Internal error",
      );
    });
  });

  describe("schemas", () => {
    describe("query.search", () => {
      it("should accept valid search params", () => {
        const result = schemas.query.search.parse({
          q: "test",
          limit: 5,
          offset: 0,
        });
        expect(result.q).toBe("test");
        expect(result.limit).toBe(5);
      });

      it("should apply defaults", () => {
        const result = schemas.query.search.parse({ q: "test" });
        expect(result.limit).toBe(10);
        expect(result.offset).toBe(0);
      });

      it("should reject empty query", () => {
        expect(() => schemas.query.search.parse({ q: "" })).toThrow();
      });

      it("should reject limit > 100", () => {
        expect(() =>
          schemas.query.search.parse({ q: "test", limit: 200 }),
        ).toThrow();
      });
    });

    describe("query.pagination", () => {
      it("should accept valid pagination params", () => {
        const result = schemas.query.pagination.parse({ page: 2, limit: 50 });
        expect(result.page).toBe(2);
        expect(result.limit).toBe(50);
      });

      it("should apply defaults", () => {
        const result = schemas.query.pagination.parse({});
        expect(result.page).toBe(1);
        expect(result.limit).toBe(20);
      });
    });

    describe("body.consultation", () => {
      it("should accept valid consultation request", () => {
        const result = schemas.body.consultation.parse({
          query: "Quyền sở hữu tài sản",
        });
        expect(result.query).toBe("Quyền sở hữu tài sản");
        expect(result.stream).toBe(false);
      });

      it("should accept optional filters", () => {
        const result = schemas.body.consultation.parse({
          query: "test",
          filters: { part_id: "part_1" },
        });
        expect(result.filters!.part_id).toBe("part_1");
      });

      it("should reject empty query", () => {
        expect(() => schemas.body.consultation.parse({ query: "" })).toThrow();
      });

      it("should reject query > 1000 chars", () => {
        expect(() =>
          schemas.body.consultation.parse({ query: "a".repeat(1001) }),
        ).toThrow();
      });
    });

    describe("params.articleId", () => {
      it("should accept valid article ID", () => {
        const result = schemas.params.articleId.parse({ id: "article_123" });
        expect(result.id).toBe("article_123");
      });

      it("should reject invalid article ID format", () => {
        expect(() =>
          schemas.params.articleId.parse({ id: "invalid" }),
        ).toThrow();
      });
    });

    describe("params.clauseId", () => {
      it("should accept valid clause ID", () => {
        const result = schemas.params.clauseId.parse({
          id: "article_1_clause_2",
        });
        expect(result.id).toBe("article_1_clause_2");
      });

      it("should reject invalid clause ID format", () => {
        expect(() =>
          schemas.params.clauseId.parse({ id: "clause_1" }),
        ).toThrow();
      });
    });
  });
});
