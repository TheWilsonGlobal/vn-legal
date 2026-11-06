/**
 * Authentication and authorization, delegated to iam-platform.
 *
 * Callers send `Authorization: Bearer <Supabase access token>`. @iam/client verifies the token
 * (asymmetric JWKS only), then asks IAM what the user may do in repo "vn-legal". Permissions are never
 * read from the token. If IAM is unreachable the answer is 503: the app fails closed.
 *
 * Routes are protected by a policy table (method + route pattern -> permission) enforced in an onRequest hook.
 * When config.iam.requireLogin is false, unauthenticated callers are treated as having public/viewer access.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { createIamClient, IamError, type IamClient, type IamPrincipal } from "@iam/client";
import { config } from "../../shared/config";
import logger from "../../shared/logger";

declare module "fastify" {
  interface FastifyRequest {
    iam?: IamPrincipal;
  }
}

let client: IamClient | undefined;

export function getIam(): IamClient {
  client ??= createIamClient({
    iamUrl: config.iam.iamUrl,
    repoCode: config.iam.iamRepoCode,
    clientId: config.iam.iamClientId,
    clientSecret: config.iam.iamClientSecret,
    userTokens: {
      issuer: `${config.iam.supabaseUrl}/auth/v1`,
      jwksUrl: `${config.iam.supabaseUrl}/auth/v1/.well-known/jwks.json`,
    },
    allowInsecureLocalhost: process.env.NODE_ENV !== "production",
  });
  return client;
}

/** Tests inject a mock client wired to local keys and a fake IAM. */
export function setIamClientForTests(c: IamClient | undefined): void {
  client = c;
}

function deny(reply: FastifyReply, err: unknown): void {
  const e =
    err instanceof IamError
      ? err
      : new IamError(503, "iam_unavailable", "Authorization unavailable");
  void reply.code(e.status).send({ error: e.message, code: e.code });
}

/** Verifies the bearer token and sets request.iam. Returns false if rejected. */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const authHeader = request.headers.authorization;
  if (!authHeader) {
    if (!config.iam.requireLogin) {
      return true;
    }
    void reply.code(401).send({ error: "Missing authorization token", code: "unauthorized" });
    return false;
  }

  try {
    request.iam = await getIam().authenticate(authHeader);
    return true;
  } catch (err) {
    deny(reply, err);
    return false;
  }
}

export interface PolicyEntry {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  permission: string | string[] | "public";
}

/**
 * onRequest hook enforcing a policy table. Deny by default: an unlisted route under the hook is 403.
 */
export function policyHook(policy: PolicyEntry[]) {
  type Rule = { public: boolean; guard?: (p: IamPrincipal | undefined) => void };
  let table: Map<string, Rule> | undefined;

  const build = (): Map<string, Rule> => {
    const t = new Map<string, Rule>();
    for (const e of policy) {
      const perms =
        e.permission === "public"
          ? []
          : Array.isArray(e.permission)
            ? e.permission
            : [e.permission];
      t.set(`${e.method} ${e.url}`, {
        public: e.permission === "public",
        guard:
          e.permission === "public"
            ? undefined
            : getIam().requirePermission(...perms),
      });
    }
    return t;
  };

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const routePattern = request.routeOptions.url;
    if (!routePattern) {
      // Route was not matched by Fastify router; let 404 handler handle it
      return;
    }

    // Static assets fallback wildcard (from @fastify/static)
    if (routePattern === "/*" || routePattern === "/admin/*") {
      return;
    }

    table ??= build();
    const key = `${request.method} ${routePattern}`;
    const entry = table.get(key);
    if (!entry) {
      logger.warn(`route has no access policy: ${key}`);
      void reply.code(403).send({ error: "Forbidden", code: "no_policy" });
      return;
    }

    if (entry.public) return;

    // Check if login is relaxed in dev/config
    if (!config.iam.requireLogin && !request.headers.authorization) {
      return;
    }

    if (!(await authenticate(request, reply))) return;

    try {
      if (entry.guard) {
        entry.guard(request.iam);
      }
    } catch (err) {
      deny(reply, err);
    }
  };
}

export const POLICY_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
