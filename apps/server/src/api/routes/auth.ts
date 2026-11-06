import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { config } from "../../shared/config";
import { getIam } from "../middleware/iamAuth";

/**
 * Authentication routes for vn-legal:
 *  - GET /api/config: Public sign-in config (Supabase URL, publishable key, requireLogin)
 *  - GET /api/auth/me: Inspect current user session via Bearer token
 */
export const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get(
    "/auth/me",
    {
      schema: {
        description: "Who the bearer token belongs to and their IAM roles/permissions",
        tags: ["Auth"],
      },
    },
    async (request) => {
      const authHeader = request.headers.authorization;
      if (!authHeader) {
        return {
          authenticated: false,
          requireLogin: config.iam.requireLogin,
          user: null,
        };
      }

      try {
        const p = await getIam().authenticate(authHeader);
        const isAdmin =
          p.can("settings:manage") ||
          p.can("graph:manage") ||
          p.can("vector:manage") ||
          p.can("logs:read");
        const isAnalyst = p.can("graph:read") || p.can("community:read");

        return {
          authenticated: true,
          requireLogin: config.iam.requireLogin,
          user: {
            id: p.userId,
            email: p.profile.email ?? "",
            name: p.profile.name || p.profile.email?.split("@")[0] || "User",
            picture: p.profile.avatarUrl ?? null,
            role: isAdmin ? "admin" : isAnalyst ? "legal_analyst" : "viewer",
            roles: p.roles,
            permissions: p.permissions,
          },
        };
      } catch {
        return {
          authenticated: false,
          requireLogin: config.iam.requireLogin,
          user: null,
        };
      }
    },
  );
};
