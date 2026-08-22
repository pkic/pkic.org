import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { ADMIN_SESSION_COOKIE_NAME } from "../functions/_lib/auth/admin";
import { onRequestPost as logout } from "../functions/api/v1/admin/auth/logout";
import { onRequestPost as requestLink } from "../functions/api/v1/admin/auth/request-link";
import { onRequestGet as session } from "../functions/api/v1/admin/auth/session";
import { onRequestPost as verifyLink } from "../functions/api/v1/admin/auth/verify-link";
import { createContext, createTestRateLimiter, seedEventAndAdmin, queryAll } from "./helpers/context";
import {
  adminAuthSessionResponseSchema,
  adminSessionEstablishedResponseSchema,
} from "../assets/shared/schemas/admin-auth";

function extractTokenFromMagicLinkPayload(payloadJson: string): string {
  const payload = JSON.parse(payloadJson) as { magicLinkUrl: string };
  const url = new URL(payload.magicLinkUrl);
  return url.searchParams.get("token") as string;
}

function extractCookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0];
}

describe("admin magic-link auth", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("allows allowlisted admin and blocks replay", async () => {
    await seedEventAndAdmin(env.DB);

    await requestLink(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/auth/request-link", {
          method: "POST",
          body: JSON.stringify({ email: "admin@pkic.org" }),
          headers: { "content-type": "application/json" },
        }),
        {},
      ),
    );

    const outboxRows = await queryAll<{ payload_json: string }>(env.DB, "SELECT payload_json FROM email_outbox");
    expect(outboxRows).toHaveLength(1);

    const token = extractTokenFromMagicLinkPayload(outboxRows[0].payload_json);

    const verifyResponse = await verifyLink(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/auth/verify-link", {
          method: "POST",
          body: JSON.stringify({ token }),
          headers: { "content-type": "application/json" },
        }),
        {},
      ),
    );

    const established = adminSessionEstablishedResponseSchema.parse(await verifyResponse.clone().json());
    expect(established.admin).toMatchObject({
      email: "admin@pkic.org",
      scopes: expect.any(Array),
      grants: [],
      expiresAt: null,
    });
    expect(established.admin).not.toHaveProperty("identityType");
    expect(established.admin).not.toHaveProperty("sessionId");
    expect(established.admin).not.toHaveProperty("state");

    expect(verifyResponse.status).toBe(200);
    const setCookie = verifyResponse.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${ADMIN_SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Secure");
    expect(setCookie).not.toContain("Domain=");
    expect(setCookie).not.toContain("Max-Age=");
    expect(setCookie).not.toContain("Expires=");

    await expect(
      verifyLink(
        createContext(
          env,
          new Request("https://app.test/api/v1/admin/auth/verify-link", {
            method: "POST",
            body: JSON.stringify({ token }),
            headers: { "content-type": "application/json" },
          }),
          {},
        ),
      ),
    ).rejects.toMatchObject({ code: "MAGIC_LINK_USED" });
  });

  it("returns success for non-allowlisted email without creating token", async () => {
    await seedEventAndAdmin(env.DB);

    const response = await requestLink(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/auth/request-link", {
          method: "POST",
          body: JSON.stringify({ email: "unknown@pkic.org" }),
          headers: { "content-type": "application/json" },
        }),
        {},
      ),
    );

    expect(response.status).toBe(200);

    const rows = await queryAll<{ total: number }>(env.DB, "SELECT COUNT(*) AS total FROM auth_magic_links");
    expect(Number(rows[0].total)).toBe(0);
  });

  it("rolls back the magic link and email when its audit record cannot be written", async () => {
    await seedEventAndAdmin(env.DB);
    const isolatedEnv = {
      ...env,
      EMAIL_RATE_LIMITER: createTestRateLimiter(100),
      IP_RATE_LIMITER: createTestRateLimiter(100),
    };
    await env.DB.prepare(
      `CREATE TRIGGER reject_admin_auth_request_audit BEFORE INSERT ON audit_log
       WHEN NEW.action = 'admin_magic_link_requested'
       BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`,
    ).run();

    await expect(
      requestLink(
        createContext(
          isolatedEnv,
          new Request("https://app.test/api/v1/admin/auth/request-link", {
            method: "POST",
            body: JSON.stringify({ email: "admin@pkic.org" }),
            headers: { "content-type": "application/json" },
          }),
          {},
        ),
      ),
    ).rejects.toThrow();

    expect(await queryAll(env.DB, "SELECT id FROM auth_magic_links")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
    await env.DB.prepare("DROP TRIGGER reject_admin_auth_request_audit").run();
  });

  it("does not consume a magic link or create a session when verification audit fails", async () => {
    await seedEventAndAdmin(env.DB);
    const isolatedEnv = {
      ...env,
      EMAIL_RATE_LIMITER: createTestRateLimiter(100),
      IP_RATE_LIMITER: createTestRateLimiter(100),
    };
    await requestLink(
      createContext(
        isolatedEnv,
        new Request("https://app.test/api/v1/admin/auth/request-link", {
          method: "POST",
          body: JSON.stringify({ email: "admin@pkic.org" }),
          headers: { "content-type": "application/json" },
        }),
        {},
      ),
    );
    const [outbox] = await queryAll<{ payload_json: string }>(env.DB, "SELECT payload_json FROM email_outbox");
    const token = extractTokenFromMagicLinkPayload(outbox.payload_json);
    await env.DB.prepare(
      `CREATE TRIGGER reject_admin_auth_verify_audit BEFORE INSERT ON audit_log
       WHEN NEW.action = 'admin_magic_link_verified'
       BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`,
    ).run();

    const makeVerification = () =>
      verifyLink(
        createContext(
          isolatedEnv,
          new Request("https://app.test/api/v1/admin/auth/verify-link", {
            method: "POST",
            body: JSON.stringify({ token }),
            headers: { "content-type": "application/json" },
          }),
          {},
        ),
      );
    await expect(makeVerification()).rejects.toThrow();
    expect(
      (await queryAll<{ used_at: string | null }>(env.DB, "SELECT used_at FROM auth_magic_links"))[0].used_at,
    ).toBeNull();
    expect(await queryAll(env.DB, "SELECT id FROM sessions")).toHaveLength(0);

    await env.DB.prepare("DROP TRIGGER reject_admin_auth_verify_audit").run();
    expect((await makeVerification()).status).toBe(200);
  });

  it("rate-limits repeated magic-link requests for the same email", async () => {
    await seedEventAndAdmin(env.DB);
    const limitedEnv = {
      ...env,
      EMAIL_RATE_LIMITER: createTestRateLimiter(3),
      IP_RATE_LIMITER: createTestRateLimiter(20),
    };
    const email = `rate-limit-${crypto.randomUUID()}@example.test`;

    const makeRequest = () =>
      requestLink(
        createContext(
          limitedEnv,
          new Request("https://app.test/api/v1/admin/auth/request-link", {
            method: "POST",
            body: JSON.stringify({ email }),
            headers: {
              "content-type": "application/json",
              "cf-connecting-ip": "203.0.113.10",
              "user-agent": "test-browser",
            },
          }),
          {},
        ),
      );

    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(200);
    await expect(makeRequest()).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
  });

  it("rejects magic-link verification from a different request context", async () => {
    await seedEventAndAdmin(env.DB);

    await requestLink(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/auth/request-link", {
          method: "POST",
          body: JSON.stringify({ email: "admin@pkic.org" }),
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": "203.0.113.50",
            "user-agent": "issuing-browser",
          },
        }),
        {},
      ),
    );

    const outboxRows = await queryAll<{ payload_json: string }>(env.DB, "SELECT payload_json FROM email_outbox");
    const token = extractTokenFromMagicLinkPayload(outboxRows[0].payload_json);

    await expect(
      verifyLink(
        createContext(
          env,
          new Request("https://app.test/api/v1/admin/auth/verify-link", {
            method: "POST",
            body: JSON.stringify({ token }),
            headers: {
              "content-type": "application/json",
              "cf-connecting-ip": "203.0.113.51",
              "user-agent": "issuing-browser",
            },
          }),
          {},
        ),
      ),
    ).rejects.toMatchObject({ code: "MAGIC_LINK_CONTEXT_MISMATCH", status: 403 });

    const verifyResponse = await verifyLink(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/auth/verify-link", {
          method: "POST",
          body: JSON.stringify({ token }),
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": "203.0.113.50",
            "user-agent": "issuing-browser",
          },
        }),
        {},
      ),
    );
    expect(verifyResponse.status).toBe(200);
  });

  it("authenticates, exposes session details, and clears the session cookie on logout", async () => {
    await seedEventAndAdmin(env.DB);

    await requestLink(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/auth/request-link", {
          method: "POST",
          body: JSON.stringify({ email: "admin@pkic.org" }),
          headers: { "content-type": "application/json" },
        }),
        {},
      ),
    );

    const outboxRows = await queryAll<{ payload_json: string }>(env.DB, "SELECT payload_json FROM email_outbox");
    const token = extractTokenFromMagicLinkPayload(outboxRows[0].payload_json);

    const verifyResponse = await verifyLink(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/auth/verify-link", {
          method: "POST",
          body: JSON.stringify({ token }),
          headers: { "content-type": "application/json" },
        }),
        {},
      ),
    );

    const cookiePair = extractCookiePair(verifyResponse.headers.get("set-cookie") ?? "");
    expect(cookiePair).toMatch(new RegExp(`^${ADMIN_SESSION_COOKIE_NAME}=`));

    const sessionResponse = await session(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/auth/session", {
          method: "GET",
          headers: { cookie: cookiePair },
        }),
        {},
      ),
    );
    expect(sessionResponse.status).toBe(200);
    const sessionBody = adminAuthSessionResponseSchema.parse(await sessionResponse.json());
    expect(sessionBody.admin).toMatchObject({ email: "admin@pkic.org", scopes: expect.any(Array), grants: [] });
    expect(sessionBody.admin).not.toHaveProperty("identityType");
    expect(sessionBody.admin).not.toHaveProperty("sessionId");
    expect(sessionBody.admin).not.toHaveProperty("state");

    const logoutResponse = await logout(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/auth/logout", {
          method: "POST",
          headers: { cookie: cookiePair },
        }),
        {},
      ),
    );

    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers.get("set-cookie")).toContain(`${ADMIN_SESSION_COOKIE_NAME}=`);
    expect(logoutResponse.headers.get("set-cookie")).toContain("Max-Age=0");

    const sessions = await queryAll<{ revoked_at: string | null }>(env.DB, "SELECT revoked_at FROM sessions");
    expect(sessions.some((row) => row.revoked_at)).toBe(true);
  });
});
