import { beforeEach, describe, expect, it } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import app from "../functions/router";
import type { Env } from "../functions/_lib/types";
import { buildCreateIndividualMemberStatements } from "../functions/_lib/services/membership/memberships";
import {
  portalSessionEstablishedResponseSchema,
  portalSessionResponseSchema,
} from "../assets/shared/schemas/portal-auth";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { createTestRateLimiter, deliveredEmailPayload, queryAll } from "./helpers/context";
import { insertIndividualMember } from "./helpers/membership";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { redeemPortalSignInCapability } from "../functions/_lib/auth/portal";
import { hashOptional } from "../functions/_lib/request";

const env = workerEnv as unknown as Env;

function testEnv(): Env {
  return {
    ...env,
    EMAIL_RATE_LIMITER: createTestRateLimiter(100),
    IP_RATE_LIMITER: createTestRateLimiter(100),
  };
}

async function call(path: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", "203.0.113.71");
  headers.set("user-agent", "portal-auth-test-browser");
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  return app.fetch(new Request(`https://app.test${path}`, { ...init, headers }), testEnv(), {
    passThroughOnException: () => {},
    waitUntil: () => {},
  } as unknown as ExecutionContext);
}

async function insertStaffUser(email: string): Promise<string> {
  const userId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', 1, datetime('now'), datetime('now'))`,
  )
    .bind(userId, email, email)
    .run();
  return userId;
}

async function addIndividualMembership(userId: string): Promise<void> {
  const { statements } = buildCreateIndividualMemberStatements(env.DB, userId, "H5", new Date().toISOString());
  await env.DB.batch(statements);
}

async function requestPortalToken(email: string): Promise<string> {
  const response = await call("/api/v1/auth/portal/request-link", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  expect(response.status).toBe(200);
  const rows = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox WHERE template_key = 'portal_magic_link' ORDER BY rowid DESC LIMIT 1",
  );
  expect(rows).toHaveLength(1);
  const storedPayload = JSON.parse(rows[0].payload_json) as {
    magicLinkUrl: string;
    __authorizedCapabilityMarkers?: unknown[];
  };
  expect(storedPayload.magicLinkUrl).toMatch(/pkcq1_/);
  expect(storedPayload.__authorizedCapabilityMarkers).toHaveLength(1);
  const payload = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, env, rows[0].payload_json);
  const link = new URL(payload.magicLinkUrl);
  expect(link.search).toBe("");
  const token = new URL(link.hash.slice(1), link.origin).searchParams.get("token");
  expect(token).toBeTruthy();
  return token!;
}

function cookieHeader(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  return ["pkic_admin_session", "pkic_member_session"]
    .map((name) => setCookie.match(new RegExp(`${name}=([^;,\\s]+)`))?.[0] ?? null)
    .filter((value): value is string => Boolean(value))
    .join("; ");
}

describe("identity-based portal authentication", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("is enumeration-safe for identities without staff or member capacity", async () => {
    const response = await call("/api/v1/auth/portal/request-link", {
      method: "POST",
      body: JSON.stringify({ email: "unknown@example.test" }),
    });
    expect(response.status).toBe(200);
    await expect(
      queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'portal_magic_link'"),
    ).resolves.toHaveLength(0);
  });

  it("admits a staff-only identity without granting member-only access", async () => {
    const userId = await insertStaffUser("staff-portal@example.test");
    const token = await requestPortalToken("staff-portal@example.test");
    const verified = await call("/api/v1/auth/portal/verify-link", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    expect(verified.status).toBe(200);
    const body = portalSessionEstablishedResponseSchema.parse(await verified.json());
    expect(body.identity.id).toBe(userId);
    expect(body.admin?.id).toBe(userId);
    expect(body.member).toBeUndefined();
    const cookie = cookieHeader(verified);
    expect(cookie).toContain("pkic_admin_session=");
    expect(cookie).not.toContain("pkic_member_session=");

    const session = await call("/api/v1/auth/portal/session", {}, cookie);
    expect(session.status).toBe(200);
    expect(portalSessionResponseSchema.parse(await session.json()).member).toBeUndefined();
    expect((await call("/api/v1/me", {}, cookie)).status).toBe(401);
  });

  it("admits a member-only identity through the same routes", async () => {
    const { userId } = await insertIndividualMember(env.DB, "H5", "member-portal@example.test");
    const token = await requestPortalToken("member-portal@example.test");
    const verified = await call("/api/v1/auth/portal/verify-link", {
      method: "POST",
      body: JSON.stringify({ token }),
    });

    expect(verified.status).toBe(200);
    const body = portalSessionEstablishedResponseSchema.parse(await verified.json());
    expect(body.identity.id).toBe(userId);
    expect(body.admin).toBeUndefined();
    expect(body.member?.userId).toBe(userId);
    const cookie = cookieHeader(verified);
    expect(cookie).not.toContain("pkic_admin_session=");
    expect(cookie).toContain("pkic_member_session=");
    expect((await call("/api/v1/me", {}, cookie)).status).toBe(200);
  });

  it("binds a neutral portal link to the portal verifier only", async () => {
    await insertIndividualMember(env.DB, "H5", "purpose-portal@example.test");
    const token = await requestPortalToken("purpose-portal@example.test");
    const body = JSON.stringify({ token });

    expect((await call("/api/v1/auth/member/verify-link", { method: "POST", body })).status).toBe(404);
    expect((await call("/api/v1/admin/auth/verify-link", { method: "POST", body })).status).toBe(404);
    expect((await call("/api/v1/auth/portal/verify-link", { method: "POST", body })).status).toBe(200);
  });

  it("atomically issues, resolves, and revokes both capacities for one identity", async () => {
    const userId = await insertStaffUser("dual-portal@example.test");
    await addIndividualMembership(userId);
    const token = await requestPortalToken("dual-portal@example.test");
    const complete = () =>
      call("/api/v1/auth/portal/verify-link", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
    const responses = await Promise.all([complete(), complete()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const verified = responses.find((response) => response.status === 200)!;
    const cookie = cookieHeader(verified);
    expect(cookie).toContain("pkic_admin_session=");
    expect(cookie).toContain("pkic_member_session=");

    const sessionResponse = await call("/api/v1/auth/portal/session", {}, cookie);
    expect(sessionResponse.status).toBe(200);
    const session = portalSessionResponseSchema.parse(await sessionResponse.json());
    expect(session.identity.id).toBe(userId);
    expect(session.admin?.id).toBe(userId);
    expect(session.member?.userId).toBe(userId);
    await expect(
      queryAll<{ total: number }>(env.DB, "SELECT COUNT(*) AS total FROM sessions WHERE user_id = ?", userId),
    ).resolves.toEqual([{ total: 2 }]);

    const logout = await call("/api/v1/auth/portal/logout", { method: "POST", body: "{}" }, cookie);
    expect(logout.status).toBe(200);
    const expiredCookies = logout.headers.get("set-cookie") ?? "";
    expect(expiredCookies).toContain("pkic_admin_session=");
    expect(expiredCookies).toContain("pkic_member_session=");
    expect((await call("/api/v1/auth/portal/session", {}, cookie)).status).toBe(401);
  });

  it("rejects portal redemption when the primary email changes after reads", async () => {
    const userId = await insertStaffUser("portal-redemption-race@example.test");
    const token = await requestPortalToken("portal-redemption-race@example.test");
    const signingSecret = env.INTERNAL_SIGNING_SECRET!;
    const [ipHash, userAgentHash] = await Promise.all([
      hashOptional("203.0.113.71", signingSecret),
      hashOptional("portal-auth-test-browser", signingSecret),
    ]);

    const gate = gateNextBatch(env.DB);
    const staleRedemption = redeemPortalSignInCapability(gate.db, env, {
      token,
      signingSecret,
      ipHash,
      userAgentHash,
    });
    await gate.reached;

    await env.DB.prepare("UPDATE users SET email = ?, normalized_email = ? WHERE id = ?")
      .bind("portal-redemption-changed@example.test", "portal-redemption-changed@example.test", userId)
      .run();
    gate.release();

    await expect(staleRedemption).rejects.toMatchObject({ code: "MAGIC_LINK_INVALID" });
    expect(await queryAll(env.DB, "SELECT id FROM sessions WHERE user_id = ?", userId)).toHaveLength(0);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action = 'portal_magic_link_verified' AND actor_id = ?",
        userId,
      ),
    ).toHaveLength(0);
    await expect(queryAll<{ email: string }>(env.DB, "SELECT email FROM users WHERE id = ?", userId)).resolves.toEqual([
      { email: "portal-redemption-changed@example.test" },
    ]);
  });

  it("revokes bearer-only portal sessions for either capacity", async () => {
    const adminUserId = await insertStaffUser("bearer-admin-portal@example.test");
    const { userId: memberUserId } = await insertIndividualMember(env.DB, "H5", "bearer-member-portal@example.test");
    const sessions = [
      {
        userId: adminUserId,
        token: await createAdminSession(env.DB, adminUserId, "bearer-admin-portal-session"),
      },
      {
        userId: memberUserId,
        token: await createMemberSession(env.DB, memberUserId, "bearer-member-portal-session"),
      },
    ];

    for (const session of sessions) {
      const headers = { authorization: `Bearer ${session.token}` };
      expect((await call("/api/v1/auth/portal/session", { headers })).status).toBe(200);
      expect((await call("/api/v1/auth/portal/logout", { method: "POST", headers })).status).toBe(200);
      expect((await call("/api/v1/auth/portal/session", { headers })).status).toBe(401);
      await expect(
        queryAll<{ revoked_at: string | null }>(
          env.DB,
          "SELECT revoked_at FROM sessions WHERE user_id = ?",
          session.userId,
        ),
      ).resolves.toEqual([{ revoked_at: expect.any(String) }]);
    }
  });

  it("rolls back every revocation when one capacity cannot be revoked", async () => {
    const userId = await insertStaffUser("atomic-logout-portal@example.test");
    await addIndividualMembership(userId);
    const adminToken = await createAdminSession(env.DB, userId, "atomic-logout-admin-session");
    const memberToken = await createMemberSession(env.DB, userId, "atomic-logout-member-session");
    const sessions = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM sessions WHERE user_id = ? ORDER BY rowid ASC",
      userId,
    );
    expect(sessions).toHaveLength(2);
    await env.DB.prepare(
      `CREATE TRIGGER reject_second_portal_logout
       BEFORE UPDATE OF revoked_at ON sessions
       WHEN OLD.id = '${sessions[1].id}'
       BEGIN
         SELECT RAISE(ABORT, 'simulated portal logout failure');
       END`,
    ).run();

    try {
      const cookie = `pkic_admin_session=${encodeURIComponent(adminToken)}; pkic_member_session=${encodeURIComponent(memberToken)}`;
      expect((await call("/api/v1/auth/portal/logout", { method: "POST", body: "{}" }, cookie)).status).toBe(500);
      await expect(
        queryAll<{ active: number }>(
          env.DB,
          "SELECT COUNT(*) AS active FROM sessions WHERE user_id = ? AND revoked_at IS NULL",
          userId,
        ),
      ).resolves.toEqual([{ active: 2 }]);
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_second_portal_logout").run();
    }
  });

  it("rejects valid cookies that belong to different identities", async () => {
    const adminUserId = await insertStaffUser("mismatch-admin@example.test");
    const { userId: memberUserId } = await insertIndividualMember(env.DB, "H5", "mismatch-member@example.test");
    const [adminToken, memberToken] = await Promise.all([
      createAdminSession(env.DB, adminUserId, "mismatch-admin-session"),
      createMemberSession(env.DB, memberUserId, "mismatch-member-session"),
    ]);
    const cookie = `pkic_admin_session=${encodeURIComponent(adminToken)}; pkic_member_session=${encodeURIComponent(memberToken)}`;

    const response = await call("/api/v1/auth/portal/session", {}, cookie);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PORTAL_IDENTITY_MISMATCH" } });
    const expiredCookies = response.headers.get("set-cookie") ?? "";
    expect(expiredCookies).toContain("pkic_admin_session=");
    expect(expiredCookies).toContain("pkic_member_session=");
  });

  it("drops a revoked member capacity without locking an eligible staff identity out", async () => {
    const userId = await insertStaffUser("revoked-member-portal@example.test");
    await addIndividualMembership(userId);
    const token = await requestPortalToken("revoked-member-portal@example.test");
    const verified = await call("/api/v1/auth/portal/verify-link", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    const cookie = cookieHeader(verified);
    await env.DB.prepare("UPDATE members SET status = 'lapsed' WHERE user_id = ?").bind(userId).run();

    const response = await call("/api/v1/auth/portal/session", {}, cookie);
    expect(response.status).toBe(200);
    const session = portalSessionResponseSchema.parse(await response.json());
    expect(session.admin?.id).toBe(userId);
    expect(session.member).toBeUndefined();
  });
});
