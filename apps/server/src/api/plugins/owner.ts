// ============================================================================
// vl_owner owner cookie (plan §5.5, decision Q4)
//
// An anonymous per-browser id, not authentication. The value is a random
// 128-bit id in hex. The cookie is unsigned, so no cookie secret is needed.
// Anyone holding the value is that owner.
// ============================================================================

import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";

export const OWNER_COOKIE = "vl_owner";
const OWNER_VALUE_RE = /^[a-f0-9]{32}$/;
const OWNER_MAX_AGE_S = 60 * 60 * 24 * 365; // 1 year; judgement call, see report

declare module "fastify" {
  interface FastifyRequest {
    /** Owner id from the vl_owner cookie (set by applyOwnerCookie). */
    owner: string;
  }
}

/**
 * Adds the owner hook to `fastify` itself. It is deliberately NOT registered as
 * a child plugin: a child's onRequest hook would never reach the routes that
 * are declared on the parent. Call it inside the agent routes' own plugin
 * function, so the scope stays inside that encapsulation context.
 *
 * `@fastify/cookie` is still registered by the caller and parses the request
 * cookies. The Set-Cookie header is written here directly, not through
 * `reply.setCookie`: that helper queues the cookie until the onSend hook, and a
 * hijacked SSE reply (C1) never reaches onSend, so the cookie would be lost.
 *
 * A cookie that is missing or malformed is replaced with a new one. A
 * malformed value is never trusted.
 */
export function applyOwnerCookie(
  fastify: FastifyInstance,
  options: { secure: boolean },
): void {
  fastify.decorateRequest("owner", "");

  fastify.addHook("onRequest", async (request, reply) => {
    // If request has been authenticated by IAM, use iam.userId as the authoritative owner
    if (request.iam?.userId) {
      request.owner = request.iam.userId;
      return;
    }
    const raw = request.cookies[OWNER_COOKIE];
    if (raw !== undefined && OWNER_VALUE_RE.test(raw)) {
      request.owner = raw;
      return;
    }
    const owner = randomBytes(16).toString("hex");
    reply.header("Set-Cookie", ownerSetCookie(owner, options.secure));
    request.owner = owner;
  });
}

/** The value is hex generated here, so it needs no quoting or encoding. */
function ownerSetCookie(value: string, secure: boolean): string {
  const parts = [
    `${OWNER_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${OWNER_MAX_AGE_S}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
