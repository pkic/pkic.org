import { beforeEach, describe, expect, it } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import app from "../functions/router";
import type { Env } from "../functions/_lib/types";
import { resetDb } from "./helpers/reset-db";
import { createTestRateLimiter, queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertIndividualMember } from "./helpers/membership";

const env = workerEnv as unknown as Env;

interface AuthPersona {
  name: string;
  requestPath: string;
  verifyPath: string;
  logoutPath: string;
  requestBody: () => Record<string, string>;
  templateKey: string;
  linkProperty: "magicLinkUrl" | "portalUrl";
  magicLinkTable: "auth_magic_links" | "sponsor_portal_magic_links";
  sessionTable: "sessions" | "sponsor_portal_sessions";
  cookieName: string;
  cookiePath: string;
  seed: () => Promise<void>;
}

let sponsorEventId = "";
const personas: AuthPersona[] = [
  {
    name: "admin",
    requestPath: "/api/v1/admin/auth/request-link",
    verifyPath: "/api/v1/admin/auth/verify-link",
    logoutPath: "/api/v1/admin/auth/logout",
    requestBody: () => ({ email: "admin@pkic.org" }),
    templateKey: "admin_magic_link",
    linkProperty: "magicLinkUrl",
    magicLinkTable: "auth_magic_links",
    sessionTable: "sessions",
    cookieName: "pkic_admin_session",
    cookiePath: "/api/v1",
    seed: async () => {
      await seedEventAndAdmin(env.DB);
    },
  },
  {
    name: "member",
    requestPath: "/api/v1/auth/member/request-link",
    verifyPath: "/api/v1/auth/member/verify-link",
    logoutPath: "/api/v1/auth/member/logout",
    requestBody: () => ({ email: "member-parity@example.test" }),
    templateKey: "member_magic_link",
    linkProperty: "magicLinkUrl",
    magicLinkTable: "auth_magic_links",
    sessionTable: "sessions",
    cookieName: "pkic_member_session",
    cookiePath: "/api/v1",
    seed: async () => {
      await insertIndividualMember(env.DB, "H5", "member-parity@example.test");
    },
  },
  {
    name: "sponsor",
    requestPath: "/api/v1/auth/sponsor-portal/request-link",
    verifyPath: "/api/v1/auth/sponsor-portal/verify-link",
    logoutPath: "/api/v1/sponsor-portal/logout",
    requestBody: () => ({ email: "sponsor-parity@example.test", eventId: sponsorEventId }),
    templateKey: "sponsor-portal-access",
    linkProperty: "portalUrl",
    magicLinkTable: "sponsor_portal_magic_links",
    sessionTable: "sponsor_portal_sessions",
    cookieName: "pkic_sponsor_portal_session",
    cookiePath: "/api/v1/sponsor-portal",
    seed: async () => {
      ({ eventId: sponsorEventId } = await seedEventAndAdmin(env.DB));
      await env.DB.prepare(
        `INSERT INTO sponsorships
           (id, sponsor_type, non_member_name, contact_email, event_id, tier, pipeline_stage, created_at, updated_at)
         VALUES (?, 'event', 'Parity Sponsor', 'sponsor-parity@example.test', ?, 'Leader', 'active', datetime('now'), datetime('now'))`,
      )
        .bind(crypto.randomUUID(), sponsorEventId)
        .run();
    },
  },
];

function testEnv(limit = 100): Env {
  return {
    ...env,
    EMAIL_RATE_LIMITER: createTestRateLimiter(limit),
    IP_RATE_LIMITER: createTestRateLimiter(limit),
  };
}

async function call(path: string, body: unknown, runtimeEnv: Env, cookie?: string): Promise<Response> {
  const headers = new Headers({
    "content-type": "application/json",
    "cf-connecting-ip": "203.0.113.42",
    "user-agent": "auth-parity-browser",
  });
  if (cookie) headers.set("cookie", cookie);
  return app.fetch(
    new Request(`https://app.test${path}`, { method: "POST", headers, body: JSON.stringify(body) }),
    runtimeEnv,
    { passThroughOnException: () => {}, waitUntil: () => {} } as unknown as ExecutionContext,
  );
}

async function requestToken(persona: AuthPersona, runtimeEnv: Env): Promise<string> {
  const response = await call(persona.requestPath, persona.requestBody(), runtimeEnv);
  expect(response.status).toBe(200);
  const [row] = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox WHERE template_key = ? ORDER BY rowid DESC LIMIT 1",
    persona.templateKey,
  );
  const payload = JSON.parse(row.payload_json) as Record<string, string>;
  const token = new URL(payload[persona.linkProperty]).searchParams.get("token");
  expect(token).toBeTruthy();
  return token!;
}

async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ error: { code } });
}

describe.each(personas)("$name auth HTTP-flow parity", (persona) => {
  beforeEach(async () => {
    await resetDb();
    await persona.seed();
  });

  it("rejects invalid, expired, and replayed links while issuing a secure persona cookie", async () => {
    const runtimeEnv = testEnv();
    await expectError(
      await call(persona.verifyPath, { token: "invalid-token-value" }, runtimeEnv),
      404,
      "MAGIC_LINK_INVALID",
    );

    const expiredToken = await requestToken(persona, runtimeEnv);
    await env.DB.prepare(
      `UPDATE ${persona.magicLinkTable}
          SET expires_at = datetime('now', '-1 minute')
        WHERE id = (SELECT id FROM ${persona.magicLinkTable} ORDER BY rowid DESC LIMIT 1)`,
    ).run();
    await expectError(await call(persona.verifyPath, { token: expiredToken }, runtimeEnv), 410, "MAGIC_LINK_EXPIRED");

    const token = await requestToken(persona, runtimeEnv);
    const verifyResponse = await call(persona.verifyPath, { token }, runtimeEnv);
    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.headers.get("cache-control")).toBe("no-store, max-age=0");
    const setCookie = verifyResponse.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${persona.cookieName}=`);
    expect(setCookie).toContain(`Path=${persona.cookiePath}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Secure");
    expect(setCookie).not.toContain("Domain=");
    expect(setCookie).not.toContain("Max-Age=");

    await expectError(await call(persona.verifyPath, { token }, runtimeEnv), 409, "MAGIC_LINK_USED");
  });

  it("keeps request and verification rate-limit namespaces enforced", async () => {
    const requestLimitedEnv = testEnv(1);
    expect((await call(persona.requestPath, persona.requestBody(), requestLimitedEnv)).status).toBe(200);
    await expectError(await call(persona.requestPath, persona.requestBody(), requestLimitedEnv), 429, "RATE_LIMITED");

    const verifyLimitedEnv = testEnv(1);
    await expectError(
      await call(persona.verifyPath, { token: "invalid-token-one" }, verifyLimitedEnv),
      404,
      "MAGIC_LINK_INVALID",
    );
    await expectError(
      await call(persona.verifyPath, { token: "invalid-token-two" }, verifyLimitedEnv),
      429,
      "RATE_LIMITED",
    );
  });

  it("revokes a valid session and always returns the persona's expired cookie policy", async () => {
    const runtimeEnv = testEnv();
    const token = await requestToken(persona, runtimeEnv);
    const verifyResponse = await call(persona.verifyPath, { token }, runtimeEnv);
    const cookiePair = (verifyResponse.headers.get("set-cookie") ?? "").split(";", 1)[0];

    const logoutResponse = await call(persona.logoutPath, {}, runtimeEnv, cookiePair);
    expect(logoutResponse.status).toBe(200);
    const expiredCookie = logoutResponse.headers.get("set-cookie") ?? "";
    expect(expiredCookie).toContain(`${persona.cookieName}=`);
    expect(expiredCookie).toContain(`Path=${persona.cookiePath}`);
    expect(expiredCookie).toContain("HttpOnly");
    expect(expiredCookie).toContain("SameSite=Strict");
    expect(expiredCookie).toContain("Secure");
    expect(expiredCookie).toContain("Max-Age=0");
    expect(expiredCookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    const [session] = await queryAll<{ revoked_at: string | null }>(
      env.DB,
      `SELECT revoked_at FROM ${persona.sessionTable} ORDER BY rowid DESC LIMIT 1`,
    );
    expect(session.revoked_at).not.toBeNull();
  });
});
