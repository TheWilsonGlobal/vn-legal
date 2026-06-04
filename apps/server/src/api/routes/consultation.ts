// ============================================================================
// Consultation Routes
// ============================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { LegalConsultationAgent } from "../../agent/setup";
import type { ConsultationRequest } from "../../shared/types";
import { ZodError } from "zod";
import { z } from "zod";
import { activityLog } from "../../shared/activity-log";

// ----------------------------------------------------------------------------
// Request Schemas
// ----------------------------------------------------------------------------

const ConsultationQuerySchema = z.object({
  query: z.string().min(1).max(1000),
  filters: z
    .object({
      part_id: z.string().optional(),
      chapter_id: z.string().optional(),
      section_id: z.string().optional(),
      subsection_id: z.string().optional(),
    })
    .optional(),
  mode: z.enum(["local", "global", "auto"]).optional().default("auto"),
  stream: z.boolean().optional().default(false),
  retrievalOnly: z.boolean().optional().default(false),
});

// ----------------------------------------------------------------------------
// Consultation Routes
// ----------------------------------------------------------------------------

export async function consultationRoutes(
  fastify: FastifyInstance,
  options: { agent: LegalConsultationAgent },
) {
  const { agent } = options;

  // POST /consult - Get legal consultation
  fastify.post(
    "/consult",
    {
      schema: {
        description: "Get legal consultation based on natural language query",
        tags: ["Consultation"],
        body: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", minLength: 1, maxLength: 1000 },
            filters: {
              type: "object",
              properties: {
                part_id: { type: "string" },
                chapter_id: { type: "string" },
                section_id: { type: "string" },
                subsection_id: { type: "string" },
              },
            },
            mode: {
              type: "string",
              enum: ["local", "global", "auto"],
              default: "auto",
            },
            stream: { type: "boolean", default: false },
            retrievalOnly: { type: "boolean", default: false },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              context: { type: "object", additionalProperties: true },
              llmDetails: {
                type: "object",
                properties: {
                  systemPrompt: { type: "string" },
                  userPrompt: { type: "string" },
                  output: { type: "string" },
                },
              },
              response: { type: "string" },
              timestamp: { type: "string" },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: ConsultationRequest;
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const { query, filters, mode, stream, retrievalOnly } =
          ConsultationQuerySchema.parse(request.body);

        if (stream) {
          // Streaming response with proper headers
          reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });

          try {
            // Convert "auto" mode to "local" for the streamConsultation function
            const searchMode = mode === "auto" ? "local" : mode;
            for await (const chunk of agent.streamConsultation(
              query,
              filters,
              searchMode,
            )) {
              // Send SSE format
              reply.raw.write(`data: ${JSON.stringify({ chunk })}\n\n`);
            }
          } finally {
            reply.raw.write("data: [DONE]\n\n");
            reply.raw.end();
          }
          return reply;
        }

        // Non-streaming response
        const result = await agent.consult(query, filters, mode, {
          retrievalOnly,
        });
        if (!retrievalOnly) {
          activityLog.addEntry(
            "query",
            `Truy vấn: "${query.length > 40 ? query.substring(0, 37) + "..." : query}"`,
            result,
          );
        }

        return reply.send({
          context: {
            query: result.context.query,
            seed_articles: (result.context.seed_articles || []).map((s) => ({
              id: s.article_id,
              article_id: s.article_id,
              score: s.score,
              article_number: s.article?.article_number,
              title: s.article?.title,
              content: s.article?.content,
              part: s.article?.metadata?.part,
              chapter: s.article?.metadata?.chapter,
              matched_entity_id: s.matched_entity_id,
              clauses: s.article?.clauses || [],
            })),
            path_context: (result.context.path_context || []).map((p) => ({
              id: p.article?.id,
              article_id: p.article?.id,
              article_number: p.article?.article_number,
              title: p.article?.title,
              content: p.article?.content,
              part: p.article?.metadata?.part,
              chapter: p.article?.metadata?.chapter,
              depth: p.depth,
              matched_entity_id: p.matched_entity_id,
              clauses: p.article?.clauses || [],
              path: p.path,
            })),
            community_context: {
              hierarchical_context:
                result.context.community_context?.hierarchical_context || "",
              part: result.context.community_context?.part,
              chapter: result.context.community_context?.chapter,
              section: result.context.community_context?.section,
              subsection: result.context.community_context?.subsection,
            },
            relevant_concepts: (result.context.relevant_concepts || []).map(
              (c) => ({
                name: c.name,
                category: c.category,
              }),
            ),
            community_reports: (result.context.community_reports || []).map(
              (r) => ({
                id: r.id,
                level: r.level,
                title: r.title,
                summary: r.summary,
                findings: r.findings,
                rating: r.rating,
              }),
            ),
          },
          ...(result.llmDetails ? { llmDetails: result.llmDetails } : {}),
          response: result.response,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.status(400).send({
            error: "Invalid request body",
            details: error.errors,
          });
        }

        fastify.log.error(error);
        return reply.status(500).send({
          error: "Internal server error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // GET /consult/suggestions - Get query suggestions
  fastify.get(
    "/consult/suggestions",
    {
      schema: {
        description: "Get query suggestions for legal consultation",
        tags: ["Consultation"],
        querystring: {
          type: "object",
          properties: {
            q: { type: "string" },
            limit: { type: "integer", default: 5 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              suggestions: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Querystring: { q?: string; limit?: number };
      }>,
      reply: FastifyReply,
    ) => {
      const { q, limit = 5 } = request.query;

      // Sample suggestions (in production, would be based on actual data)
      const suggestions = [
        "Quyền của người chưa thành niên",
        "Điều kiện kết hợp đồng",
        "Sở hữu tài sản chung",
        "Thừa kế theo pháp luật",
        "Bồi thường thiệt hại",
        "Hủy giao dịch dân sự",
        "Giám hộ cho người có khó khăn",
        "Thời hiệu khởi kiện",
      ];

      let filtered = suggestions;

      if (q) {
        filtered = suggestions.filter((s) =>
          s.toLowerCase().includes(q.toLowerCase()),
        );
      }

      return reply.send({
        suggestions: filtered.slice(0, limit),
      });
    },
  );
}
