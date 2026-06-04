import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { consultationRoutes } from "../../../../src/api/routes/consultation";

describe("Consultation Routes", () => {
  let fastify: any;
  let mockAgent: any;

  beforeEach(async () => {
    fastify = Fastify();
    mockAgent = {
      consult: vi.fn(),
      streamConsultation: vi.fn(),
    };
    await fastify.register(consultationRoutes, { agent: mockAgent });
  });

  describe("POST /consult", () => {
    it("should return consultation result", async () => {
      mockAgent.consult.mockResolvedValue({
        response: "AI response",
        context: {
          query: "test",
          seed_articles: [
            { article_id: "a1", article: { article_number: 1, title: "T1" } },
          ],
          path_context: [],
          community_context: { hierarchical_context: "P > C" },
          relevant_concepts: [{ name: "C1", category: "other" }],
          community_reports: [],
        },
      });

      const response = await fastify.inject({
        method: "POST",
        url: "/consult",
        payload: { query: "test query" },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.response).toBe("AI response");
      expect(body.context.seed_articles).toHaveLength(1);
    });

    it("should handle streaming request", async () => {
      mockAgent.streamConsultation.mockImplementation(async function* () {
        yield "chunk1";
      });

      const response = await fastify.inject({
        method: "POST",
        url: "/consult",
        payload: { query: "test", stream: true },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/event-stream");
      expect(response.payload).toContain("chunk1");
      expect(response.payload).toContain("[DONE]");
    });

    it("should return 400 for invalid request body", async () => {
      const response = await fastify.inject({
        method: "POST",
        url: "/consult",
        payload: {}, // Missing query
      });

      expect(response.statusCode).toBe(400);
    });

    it("should return 500 on agent error", async () => {
      mockAgent.consult.mockRejectedValue(new Error("Agent crash"));

      const response = await fastify.inject({
        method: "POST",
        url: "/consult",
        payload: { query: "test" },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe("GET /consult/suggestions", () => {
    it("should return suggestions", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: "/consult/suggestions",
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload).suggestions).toBeDefined();
    });

    it("should filter suggestions", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: "/consult/suggestions",
        query: { q: "Quyền" },
      });

      const body = JSON.parse(response.payload);
      expect(body.suggestions.every((s: string) => s.includes("Quyền"))).toBe(
        true,
      );
    });
  });
});
