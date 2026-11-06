import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authRoutes } from "../../../../src/api/routes/auth";
import { configRoutes } from "../../../../src/api/routes/config";
import { policyHook, type PolicyEntry } from "../../../../src/api/middleware/iamAuth";
import {
  installFakeIam,
  VIEWER_PERMS,
  SUPER_ADMIN_PERMS,
  type TestIdentity,
} from "../support/iam";
import { config } from "../../../../src/shared/config";

describe("IAM Auth & Policy Hook Verification", () => {
  let app: FastifyInstance;
  let fakeIam: Awaited<ReturnType<typeof installFakeIam>>;
  let viewer: TestIdentity;
  let admin: TestIdentity;

  const policy: PolicyEntry[] = [
    { method: "GET", url: "/api/config", permission: "public" },
    { method: "GET", url: "/api/auth/me", permission: "public" },
    { method: "POST", url: "/api/consult", permission: "consult:create" },
    { method: "GET", url: "/api/admin/overview", permission: "graph:read" },
    { method: "POST", url: "/api/admin/rebuild-vector", permission: "vector:manage" },
  ];

  beforeAll(async () => {
    config.iam.requireLogin = true;
    fakeIam = await installFakeIam();
    viewer = await fakeIam.loginAs("viewer@example.com", "Viewer User", VIEWER_PERMS);
    admin = await fakeIam.loginAs("admin@example.com", "Admin User", SUPER_ADMIN_PERMS);

    app = Fastify();
    app.addHook("onRequest", policyHook(policy));

    // Register routes
    await app.register(authRoutes, { prefix: "/api" });
    await app.register(configRoutes, { prefix: "/api" });

    app.post("/api/consult", async () => ({ status: "consult_ok" }));
    app.get("/api/admin/overview", async () => ({ status: "overview_ok" }));
    app.post("/api/admin/rebuild-vector", async () => ({ status: "rebuild_ok" }));
    app.get("/api/unlisted-endpoint", async () => ({ status: "should_fail" }));

    await app.ready();
  });

  afterAll(async () => {
    fakeIam.cleanup();
    await app.close();
  });

  it("GET /api/config is public and returns supabase config and requireLogin flag", async () => {
    const res = await app.inject({ method: "GET", url: "/api/config" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.requireLogin).toBe(true);
    expect(body).toHaveProperty("supabaseUrl");
    expect(body).toHaveProperty("supabasePublishableKey");
  });

  it("GET /api/auth/me returns unauthenticated for anonymous callers without 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.authenticated).toBe(false);
    expect(body.user).toBeNull();
  });

  it("GET /api/auth/me identifies authenticated user with valid Bearer token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: viewer.headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.authenticated).toBe(true);
    expect(body.user.email).toBe("viewer@example.com");
    expect(body.user.role).toBe("viewer");
  });

  it("Protected route /api/consult rejects unauthenticated callers with 401 when requireLogin=true", async () => {
    const res = await app.inject({ method: "POST", url: "/api/consult" });
    expect(res.statusCode).toBe(401);
  });

  it("Protected route /api/consult succeeds for user with consult:create permission", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/consult",
      headers: viewer.headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "consult_ok" });
  });

  it("Admin route /api/admin/rebuild-vector rejects viewer with 403 Forbidden", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/rebuild-vector",
      headers: viewer.headers,
    });
    expect(res.statusCode).toBe(403);
  });

  it("Admin route /api/admin/rebuild-vector succeeds for super_admin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/rebuild-vector",
      headers: admin.headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "rebuild_ok" });
  });

  it("Unlisted route under policy hook fails closed with 403 Forbidden", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/unlisted-endpoint",
      headers: admin.headers,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("no_policy");
  });

  it("Forged or invalid token is rejected with 401", async () => {
    const forged = await fakeIam.forged();
    const res = await app.inject({
      method: "POST",
      url: "/api/consult",
      headers: forged,
    });
    expect(res.statusCode).toBe(401);
  });

  it("When IAM service is down, protected requests fail closed with 503", async () => {
    // Fresh user without cache
    const freshUser = await fakeIam.loginAs("fresh@example.com", "Fresh User", VIEWER_PERMS);
    fakeIam.setIamDown(true);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/consult",
        headers: freshUser.headers,
      });
      expect(res.statusCode).toBe(503);
    } finally {
      fakeIam.setIamDown(false);
    }
  });

  it("When requireLogin is false, unauthenticated request passes for public or relaxed mode", async () => {
    config.iam.requireLogin = false;
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/consult",
      });
      expect(res.statusCode).toBe(200);
    } finally {
      config.iam.requireLogin = true;
    }
  });
});
