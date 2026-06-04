import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config } from "../../shared/config";

export async function configRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/config",
    {
      schema: {
        description: "Get public system configuration for the client",
        tags: ["Config"],
        response: {
          200: {
            type: "object",
            properties: {
              clientGraphMode: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({
        clientGraphMode: config.clientGraphMode,
      });
    },
  );
}
