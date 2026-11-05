import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import logger from "../../../shared/logger";
import { config } from "../../../shared/config";
import { activityLog } from "../../../shared/activity-log";
import { llmTracker } from "../../../shared/llm-tracker";
import { LlamaLLMAdapter } from "../../../agent/congraph-rag-llm";
import type { AdminRoutesOptions } from "./types";

// The endpoint from .env as loaded at startup, captured before any runtime
// override so the admin UI can offer a "reset to default" action.
const DEFAULT_LLM_API_URL = config.llm.apiUrl;

export function registerLlmRoutes(
  fastify: FastifyInstance,
  options: AdminRoutesOptions,
): void {
  const { agent } = options;

  // GET /admin/llm/status - Check LLM connection status
  fastify.get(
    "/admin/llm/status",
    {
      schema: {
        description: "Get LLM provider status and connectivity",
        tags: ["Admin"],
        response: {
          200: {
            type: "object",
            properties: {
              provider: { type: "string" },
              model: { type: "string" },
              apiUrl: { type: "string" },
              defaultApiUrl: { type: "string" },
              editableEndpoint: { type: "boolean" },
              status: { type: "string" },
              useLlm: { type: "boolean" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const useLlm = config.retrieval.useLlmForRetrieval;
      const provider = config.llm.provider;
      const model = config.llm.model;
      const apiUrl = (config.llm as any).apiUrl || "N/A";
      let status = "disconnected";

      if (useLlm) {
        if (provider === "template") {
          status = "connected";
        } else if (provider === "llama") {
          try {
            const checkRes = await fetch(`${apiUrl}/health`, {
              signal: AbortSignal.timeout(2000),
            });
            if (checkRes.ok) status = "connected";
          } catch {
            status = "disconnected";
          }
        } else if (["anthropic", "openai", "gemini"].includes(provider)) {
          status = config.llm.apiKey ? "connected" : "disconnected";
        }
      }

      return reply.send({
        provider,
        model,
        apiUrl,
        defaultApiUrl: DEFAULT_LLM_API_URL,
        // Only the llama/openai/gemini adapters are addressed by URL.
        editableEndpoint: ["llama", "openai", "gemini"].includes(provider),
        status,
        useLlm,
      });
    },
  );

  // PUT /admin/llm/endpoint - Update the LLM endpoint at runtime
  fastify.put(
    "/admin/llm/endpoint",
    {
      schema: {
        description:
          "Update the LLM API endpoint at runtime (not persisted to .env)",
        tags: ["Admin"],
        body: {
          type: "object",
          required: ["apiUrl"],
          properties: {
            apiUrl: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              apiUrl: { type: "string" },
              previousApiUrl: { type: "string" },
              status: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { apiUrl?: string };
      const raw = (body.apiUrl || "").trim();

      if (!raw) {
        return reply
          .status(400)
          .send({ success: false, error: "Endpoint không được để trống." });
      }

      // Validate and normalise. Trailing slashes are stripped because every
      // call site builds paths as `${apiUrl}/completion`.
      let normalized: string;
      try {
        const parsed = new URL(raw);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return reply.status(400).send({
            success: false,
            error: "Endpoint phải dùng giao thức http hoặc https.",
          });
        }
        normalized = parsed.toString().replace(/\/+$/, "");
      } catch {
        return reply.status(400).send({
          success: false,
          error: `Endpoint không hợp lệ: "${raw}". Ví dụ: http://localhost:5814`,
        });
      }

      const previousApiUrl = config.llm.apiUrl;
      config.llm.apiUrl = normalized;

      // The adapter captured apiUrl at construction, so rebind the live
      // instance too - otherwise the UI would show the new endpoint while
      // queries kept hitting the old one.
      const llm = (agent as { llm?: unknown } | undefined)?.llm;
      if (llm instanceof LlamaLLMAdapter) {
        llm.setApiUrl(normalized);
      }

      // Probe the new endpoint so the caller gets immediate feedback.
      let status = "disconnected";
      try {
        const checkRes = await fetch(`${normalized}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (checkRes.ok) status = "connected";
      } catch {
        status = "disconnected";
      }

      logger.info(
        `Admin: LLM endpoint updated ${previousApiUrl} -> ${normalized} (${status})`,
      );
      activityLog.addEntry(
        "system",
        `Cập nhật endpoint LLM: ${previousApiUrl} -> ${normalized}`,
        { previousApiUrl, apiUrl: normalized, status },
      );

      return reply.send({
        success: true,
        apiUrl: normalized,
        previousApiUrl,
        status,
        message:
          status === "connected"
            ? "Đã cập nhật endpoint và kết nối thành công."
            : "Đã cập nhật endpoint nhưng không kết nối được. Kiểm tra máy chủ LLM.",
      });
    },
  );

  // GET /admin/llm/last-prompt - Retrieve last executed prompt/response log
  fastify.get(
    "/admin/llm/last-prompt",
    {
      schema: {
        description: "Get last executed LLM prompt and response log",
        tags: ["Admin"],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const log = llmTracker.getLastLog();
      return reply.send(
        log || {
          systemPrompt: "No prompts executed yet.",
          userPrompt: "No prompts executed yet.",
          response: "No response recorded.",
          timestamp: new Date().toISOString(),
        },
      );
    },
  );

  // POST /admin/llm/test - Test LLM connection with diagnostic prompt
  fastify.post(
    "/admin/llm/test",
    {
      schema: {
        description: "Test LLM connectivity with a simple query",
        tags: ["Admin"],
        body: {
          type: "object",
          properties: {
            prompt: { type: "string" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { prompt?: string };
      const testPrompt =
        body.prompt || "Xin chào, đây là câu hỏi kiểm tra kết nối.";

      try {
        const llm = (agent as any)?.llm;
        if (!llm) {
          return reply.status(400).send({
            success: false,
            error: "No active LLM adapter configured in the server.",
          });
        }

        const start = Date.now();
        const systemPrompt = "Bạn là trợ lý ảo kiểm tra kết nối hệ thống.";
        const result = await llm.generate(testPrompt, { systemPrompt });
        const duration = Date.now() - start;

        return reply.send({
          success: true,
          response: result.content,
          duration_ms: duration,
          provider: config.llm.provider,
          model: config.llm.model,
        });
      } catch (error: any) {
        logger.error("LLM diagnostic test failed", error);
        return reply.status(500).send({
          success: false,
          error: error.message || String(error),
        });
      }
    },
  );
}
