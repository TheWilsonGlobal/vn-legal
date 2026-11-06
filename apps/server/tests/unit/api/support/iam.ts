import { randomUUID } from "node:crypto";
import type { KeyObject } from "node:crypto";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import { createIamClient } from "@iam/client";
import { setIamClientForTests } from "../../../../src/api/middleware/iamAuth";

const ISS = "https://test.supabase.co/auth/v1";

export const VIEWER_PERMS = [
  "consult:create",
  "articles:read",
  "session:read_own",
  "session:manage_own",
];

export const ANALYST_PERMS = [
  ...VIEWER_PERMS,
  "graph:read",
  "community:read",
];

export const SUPER_ADMIN_PERMS = [
  ...ANALYST_PERMS,
  "articles:write",
  "graph:manage",
  "vector:manage",
  "settings:manage",
  "logs:read",
];

export interface TestIdentity {
  id: string;
  email: string;
  headers: { authorization: string };
}

/**
 * Installs an @iam/client wired to local signing keys and an in-memory stand-in for the IAM API,
 * enabling full asymmetric JWT verification and RBAC checks without external dependencies.
 */
export async function installFakeIam() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256" }],
  });
  const perms = new Map<string, string[]>();
  let down = false;

  const fakeFetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (down) throw new Error("connect ECONNREFUSED");
    if (url.pathname === "/api/v1/m2m/token") {
      return Response.json({ access_token: "m2m", expires_in: 600 });
    }
    const user = url.searchParams.get("user")!;
    const p = perms.get(user);
    if (!p) return new Response("{}", { status: 404 });
    return Response.json({
      user: { id: user, status: "active", tokensValidAfter: null },
      roles: [{ name: "test-role" }],
      permissions: p.map((x) => `vn-legal:${x}`),
    });
  };

  setIamClientForTests(
    createIamClient({
      iamUrl: "http://127.0.0.1:5490",
      repoCode: "vn-legal",
      clientId: "test-client",
      clientSecret: "iamsk_test",
      userTokens: { issuer: ISS, keys },
      allowInsecureLocalhost: true,
      cacheTtlSeconds: 0,
      fetch: fakeFetch,
    }),
  );

  const sign = async (
    sub: string,
    email: string,
    name: string,
    key: CryptoKey | KeyObject = privateKey,
    ttl = 900,
  ) => {
    const iat = Math.floor(Date.now() / 1000);
    return new SignJWT({
      role: "authenticated",
      email,
      user_metadata: { full_name: name },
    })
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .setIssuer(ISS)
      .setAudience("authenticated")
      .setSubject(sub)
      .setIssuedAt(iat)
      .setExpirationTime(iat + ttl)
      .sign(key);
  };

  return {
    async loginAs(
      email: string,
      name = "Test User",
      permissions: string[] = VIEWER_PERMS,
    ): Promise<TestIdentity> {
      const id = randomUUID();
      perms.set(id, permissions);
      return {
        id,
        email,
        headers: { authorization: `Bearer ${await sign(id, email, name)}` },
      };
    },
    async forged(email = "bad@test.example") {
      const other = (await generateKeyPair("ES256")).privateKey;
      const id = randomUUID();
      perms.set(id, SUPER_ADMIN_PERMS);
      return { authorization: `Bearer ${await sign(id, email, "Forged", other)}` };
    },
    setIamDown(v: boolean) {
      down = v;
    },
    cleanup() {
      setIamClientForTests(undefined);
    },
  };
}
