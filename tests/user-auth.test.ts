// Prepare the real HTTP graph before timed journeys, as the shared API test helper does.
import "../functions/http-router";
import { userAuthSessionResponseSchema } from "../assets/shared/schemas/user-auth";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "./helpers/app";
import { createTestRateLimiter, deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import {
  addRepresentative,
  insertIndividualMember,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { signUserSessionToken, verifyUserSessionToken } from "../functions/_lib/auth/user-session";

import { signJwt } from "../functions/_lib/utils/jwt";

const TEST_SIGNING_SECRET = "test-signing-secret";

async function call(path: string, init: RequestInit = {}, testEnv = env): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return app.fetch(
    new Request(`https://app.test${path}`, { ...init, headers }),
    testEnv as never,
    { passThroughOnException() {}, waitUntil() {} } as any,
  );
}

async function seedDualCapacityUser(): Promise<void> {
  await seedEventAndAdmin(env.DB);
  const [staff] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [
    "admin@pkic.org",
  ]);
  const organizationId = await insertOrganization(env.DB, "User auth organization");
  const memberId = await seedOrganizationAggregate(env.DB, organizationId);
  await addRepresentative(env.DB, memberId, staff.id);
}

async function requestUserToken(email: string, headers?: HeadersInit): Promise<string | null> {
  expect(
    await call("/api/v1/auth/request-link", {
      method: "POST",
      body: JSON.stringify({ email }),
      headers,
    }),
  ).toMatchObject({ status: 200 });
  const [outbox] = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox ORDER BY rowid DESC LIMIT 1",
  );
  if (!outbox) return null;
  const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, env, outbox.payload_json);
  const url = new URL(delivered.magicLinkUrl);
  return new URLSearchParams(url.hash.split("?", 2)[1]).get("token");
}

function cookiePair(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";", 1)[0];
}

describe("canonical user authentication", () => {
  beforeEach(resetDb);

  it("records first mailbox proof before creating a new attendee's organization identity", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const email = "imported@uk.ibm.example";
    const userId = await insertUser(env.DB, email);
    const organizationId = await insertOrganization(env.DB, "IBM");
    const at = "2026-10-01T00:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO identities(id,user_id,source,show_on_organization_profile,invited_at,started_at,created_at,updated_at)
        VALUES (?,?,'account',0,?,?,?,?)`).bind(crypto.randomUUID(), userId, at, at, at, at),
      env.DB.prepare(`INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at)
        VALUES (?,'ibm.example',?,?,?)`).bind(crypto.randomUUID(), organizationId, at, at),
      env.DB.prepare(`INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at)
        VALUES (?,?,?,'registered','in_person','test',?,?,?)`).bind(
        crypto.randomUUID(),
        eventId,
        userId,
        crypto.randomUUID(),
        at,
        at,
      ),
      env.DB.prepare(`INSERT INTO affiliation_reviews(id,user_id,organization_name,normalized_name,job_title,email_domain,group_key,source_type,source_id,created_at)
        VALUES (?,?,'IBM','ibm','Architect','uk.ibm.example','ibm','user_profile',?,?)`).bind(
        crypto.randomUUID(),
        userId,
        userId,
        at,
      ),
    ]);
    const token = await requestUserToken(email);
    expect(token).not.toBeNull();
    // Issuing an email is not proof: the account remains unverified and unaffiliated until redemption.
    expect(await queryAll(env.DB, "SELECT email_verified_at FROM users WHERE id = ?", [userId])).toEqual([
      { email_verified_at: null },
    ]);
    expect(
      await queryAll(env.DB, "SELECT id FROM identities WHERE user_id = ? AND organization_id IS NOT NULL", [userId]),
    ).toEqual([]);
    const response = await call("/api/v1/auth/verify-link", { method: "POST", body: JSON.stringify({ token }) });
    expect(response.status, await response.clone().text()).toBe(200);
    userAuthSessionResponseSchema.parse(await response.json());
    expect(
      await queryAll(
        env.DB,
        "SELECT email_verification_method FROM users WHERE id = ? AND email_verified_at IS NOT NULL",
        [userId],
      ),
    ).toEqual([{ email_verification_method: "magic_link" }]);
    const identities = await queryAll<{ id: string; source: string }>(
      env.DB,
      "SELECT id,source FROM identities WHERE user_id = ? AND organization_id = ? AND started_at IS NOT NULL",
      [userId, organizationId],
    );
    expect(identities).toHaveLength(1);
    expect(identities[0].source).toBe("verified_domain");
    expect(
      await queryAll(env.DB, "SELECT resolved_identity_id FROM affiliation_reviews WHERE user_id = ?", [userId]),
    ).toEqual([{ resolved_identity_id: identities[0].id }]);
  });

  it("materializes and renders a user_sign_in capability into one user session with live staff and member capacities", async () => {
    await seedDualCapacityUser();

    expect(
      await call("/api/v1/auth/request-link", {
        method: "POST",
        body: JSON.stringify({ email: "admin@pkic.org" }),
      }),
    ).toMatchObject({ status: 200 });

    const [outbox] = await queryAll<{ payload_json: string; template_key: string }>(
      env.DB,
      "SELECT payload_json, template_key FROM email_outbox ORDER BY rowid DESC LIMIT 1",
    );
    expect(outbox.template_key).toBe("user_magic_link");
    const stored = JSON.parse(outbox.payload_json) as { __authorizedCapabilityMarkers?: string[] };
    expect(stored.__authorizedCapabilityMarkers?.[0]).toContain("dXNp");
    const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, env, outbox.payload_json);
    const deliveredUrl = new URL(delivered.magicLinkUrl);
    const token = new URLSearchParams(deliveredUrl.hash.split("?", 2)[1]).get("token");
    if (!token) throw new Error("Missing user sign-in capability token");
    expect(token).toMatch(/^pkc1_/);

    const verified = await call("/api/v1/auth/verify-link", {
      method: "POST",
      body: JSON.stringify({ token }),
      headers: { "cf-connecting-ip": "203.0.113.9", "user-agent": "issuer" },
    });
    expect(verified.status).toBe(200);
    const body = userAuthSessionResponseSchema.parse(await verified.json());
    expect(body.identity.email).toBe("admin@pkic.org");
    expect(body.staff).toBeTruthy();
    expect(body.member).toBeTruthy();
    const cookie = verified.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("pkic_session=");
    expect(cookie).not.toMatch(/pkic_(?:admin|member)_session=/);

    const session = await call("/api/v1/auth/session", { headers: { cookie } });
    expect(session.status).toBe(200);
    const [persistedSession] = await queryAll<{ expires_at: string }>(env.DB, "SELECT expires_at FROM sessions");
    expect(await session.json()).toMatchObject({
      expiresAt: persistedSession.expires_at,
      idleExpiresAt: expect.any(String),
      identity: { email: "admin@pkic.org" },
      staff: expect.objectContaining({ idleExpiresAt: expect.any(String) }),
      member: expect.any(Object),
    });
    expect(await queryAll(env.DB, "SELECT id FROM sessions")).toHaveLength(1);
    expect(session.headers.get("set-cookie")).toContain("pkic_session=");
    expect(
      await queryAll(
        env.DB,
        `SELECT points,source_ref FROM user_standing_awards
      WHERE user_id=? AND reason_key='active_month'`,
        body.identity.id,
      ),
    ).toEqual([{ points: 2, source_ref: new Date().toISOString().slice(0, 7) }]);

    await env.DB.prepare("UPDATE sessions SET created_at = ?")
      .bind(new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString())
      .run();
    const expiredElevation = await call("/api/v1/auth/session", { headers: { cookie } });
    expect(expiredElevation.status).toBe(401);
    await expect(expiredElevation.json()).resolves.toMatchObject({ error: { code: "AUTH_EXPIRED" } });
    expect(expiredElevation.headers.get("x-user-token")).toBeNull();
  });

  it("expires the whole session after seven days without acknowledged activity", async () => {
    await insertOrganization(env.DB, "Idle member organization");
    const { userId } = await insertIndividualMember(env.DB, "H5", "idle-member@example.test");
    const currentToken = await createAdminSession(env.DB, userId, "idle-member-session");
    const current = await verifyUserSessionToken(TEST_SIGNING_SECRET, currentToken);
    if (!current.ok) throw new Error("Expected a valid test session");
    const staleToken = await signUserSessionToken(TEST_SIGNING_SECRET, {
      sub: current.claims.sub,
      sid: current.claims.sid,
      exp: current.claims.exp,
      lastActivityAt: Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60,
      staffLastActivityAt: Math.floor(Date.now() / 1000),
    });

    const response = await call("/api/v1/auth/session", {
      headers: { authorization: `Bearer ${staleToken}` },
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "AUTH_EXPIRED" } });
  });

  it("expires a dual-capacity session after one hour of staff inactivity and requires a new sign-in", async () => {
    await seedDualCapacityUser();
    const [staff] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [
      "admin@pkic.org",
    ]);
    const currentToken = await createAdminSession(env.DB, staff.id, "idle-staff-session");
    const current = await verifyUserSessionToken(TEST_SIGNING_SECRET, currentToken);
    if (!current.ok) throw new Error("Expected a valid test session");
    const staleStaffActivity = Math.floor(Date.now() / 1000) - 2 * 60 * 60;
    const staleStaffToken = await signUserSessionToken(TEST_SIGNING_SECRET, {
      sub: current.claims.sub,
      sid: current.claims.sid,
      exp: current.claims.exp,
      lastActivityAt: Math.floor(Date.now() / 1000),
      staffLastActivityAt: staleStaffActivity,
    });

    const response = await call("/api/v1/auth/session", {
      headers: { "x-user-token": staleStaffToken },
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "AUTH_EXPIRED" } });
    expect(response.headers.get("x-user-token")).toBeNull();
    const repeated = await call("/api/v1/auth/session", {
      headers: { "x-user-token": staleStaffToken },
    });
    expect(repeated.status).toBe(401);

    const newToken = await createAdminSession(env.DB, staff.id, "renewed-staff-session");
    const renewed = await call("/api/v1/auth/session", { headers: { "x-user-token": newToken } });
    expect(renewed.status).toBe(200);
    await expect(renewed.json()).resolves.toMatchObject({ staff: expect.any(Object), member: expect.any(Object) });
  });

  it.each([true, false])(
    "does not extend staff activity while staff eligibility is absent (activity claim: %s)",
    async (hasStaffActivity) => {
      await seedDualCapacityUser();
      const [staff] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [
        "admin@pkic.org",
      ]);
      const token = await createAdminSession(env.DB, staff.id, "staff-eligibility-session");
      const verified = await verifyUserSessionToken(TEST_SIGNING_SECRET, token);
      if (!verified.ok) throw new Error("Expected a valid test session");
      const priorStaffActivity = Math.floor(Date.now() / 1000) - 2 * 60 * 60;
      const claims: typeof verified.claims = {
        ...verified.claims,
        lastActivityAt: Math.floor(Date.now() / 1000),
        staffLastActivityAt: priorStaffActivity,
      };
      if (!hasStaffActivity) delete claims.staffLastActivityAt;
      const staleToken = await signJwt(TEST_SIGNING_SECRET, { ...claims });
      const revokedAt = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare("UPDATE user_roles SET revoked_at = ? WHERE user_id = ?").bind(revokedAt, staff.id),
        env.DB.prepare("UPDATE permission_grants SET revoked_at = ? WHERE user_id = ?").bind(revokedAt, staff.id),
      ]);

      const response = await call("/api/v1/auth/session", { headers: { "x-user-token": staleToken } });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ member: expect.any(Object) });
      expect(body).not.toHaveProperty("staff");
      const refreshedToken = response.headers.get("x-user-token");
      expect(refreshedToken).toBeTruthy();
      expect(await verifyUserSessionToken(TEST_SIGNING_SECRET, refreshedToken!)).toMatchObject({
        ok: true,
        claims: { staffLastActivityAt: hasStaffActivity ? priorStaffActivity : 0 },
      });

      await env.DB.prepare("UPDATE user_roles SET revoked_at = NULL WHERE user_id = ?").bind(staff.id).run();
      const restored = await call("/api/v1/auth/session", { headers: { "x-user-token": refreshedToken! } });
      expect(restored.status).toBe(401);
      await expect(restored.json()).resolves.toMatchObject({ error: { code: "AUTH_EXPIRED" } });
    },
  );

  it.each(["/api/v1/admin/auth/request-link", "/api/v1/auth/member/request-link", "/api/v1/auth/portal/request-link"])(
    "does not mount retired human auth route %s",
    async (path) => {
      const headers = new Headers();
      if (path.startsWith("/api/v1/admin/")) {
        await seedEventAndAdmin(env.DB);
        const [staff] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [
          "admin@pkic.org",
        ]);
        headers.set("authorization", `Bearer ${await createAdminSession(env.DB, staff.id, crypto.randomUUID())}`);
      }
      expect(
        await call(path, { method: "POST", body: JSON.stringify({ email: "admin@pkic.org" }), headers }),
      ).toMatchObject({ status: 404 });
    },
  );

  it("is enumeration-safe for unknown identities and rate-limits repeated requests", async () => {
    expect(await requestUserToken("unknown@example.test")).toBeNull();
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);

    await seedEventAndAdmin(env.DB);
    const limitedEnv = {
      ...env,
      EMAIL_RATE_LIMITER: createTestRateLimiter(2),
      IP_RATE_LIMITER: createTestRateLimiter(20),
    };
    const request = () =>
      call(
        "/api/v1/auth/request-link",
        {
          method: "POST",
          body: JSON.stringify({ email: "admin@pkic.org" }),
          headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.10" },
        },
        limitedEnv,
      );
    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(429);
  });

  it("enforces token purpose, verifier context, live eligibility, and one-time redemption", async () => {
    await seedDualCapacityUser();
    const token = await requestUserToken("admin@pkic.org", {
      "cf-connecting-ip": "203.0.113.9",
      "user-agent": "issuer",
    });
    expect(token).toMatch(/^pkc1_/);

    expect(
      await call("/api/v1/auth/verify-link", {
        method: "POST",
        body: JSON.stringify({ token: `${token}invalid` }),
      }),
    ).toMatchObject({ status: 404 });
    expect(
      await call("/api/v1/auth/verify-link", {
        method: "POST",
        body: JSON.stringify({ token }),
        headers: { "cf-connecting-ip": "203.0.113.10", "user-agent": "issuer" },
      }),
    ).toMatchObject({ status: 403 });

    const verified = await call("/api/v1/auth/verify-link", {
      method: "POST",
      body: JSON.stringify({ token }),
      headers: { "cf-connecting-ip": "203.0.113.9", "user-agent": "issuer" },
    });
    expect(verified.status).toBe(200);
    expect(
      await call("/api/v1/auth/verify-link", {
        method: "POST",
        body: JSON.stringify({ token }),
        headers: { "cf-connecting-ip": "203.0.113.9", "user-agent": "issuer" },
      }),
    ).toMatchObject({ status: 409 });
  });

  it("resolves staff-only and member-only identities, then revokes the sole canonical session", async () => {
    await seedEventAndAdmin(env.DB);
    const staffToken = await requestUserToken("admin@pkic.org");
    const staffResponse = await call("/api/v1/auth/verify-link", {
      method: "POST",
      body: JSON.stringify({ token: staffToken }),
    });
    expect(await staffResponse.clone().json()).toMatchObject({ staff: expect.any(Object) });
    expect(await staffResponse.clone().json()).not.toHaveProperty("member");

    await resetDb();
    await insertOrganization(env.DB, "Member-only organization");
    const { userId } = await insertIndividualMember(env.DB, "H5", "member-only@example.test");
    const memberToken = await requestUserToken("member-only@example.test");
    const memberResponse = await call("/api/v1/auth/verify-link", {
      method: "POST",
      body: JSON.stringify({ token: memberToken }),
    });
    expect(memberResponse.status).toBe(200);
    expect(await memberResponse.clone().json()).toMatchObject({ identity: { id: userId }, member: expect.any(Object) });
    expect(await memberResponse.clone().json()).not.toHaveProperty("staff");

    const cookie = cookiePair(memberResponse);
    expect((await call("/api/v1/auth/session", { headers: { cookie } })).status).toBe(200);
    expect((await call("/api/v1/auth/logout", { method: "POST", headers: { cookie } })).status).toBe(200);
    expect((await call("/api/v1/auth/session", { headers: { cookie } })).status).toBe(401);
    expect(await queryAll(env.DB, "SELECT id FROM sessions WHERE revoked_at IS NULL")).toHaveLength(0);
  });

  it("fails closed when a valid-shaped session loses every live capacity", async () => {
    await seedEventAndAdmin(env.DB);
    const [staff] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [
      "admin@pkic.org",
    ]);
    const token = await createAdminSession(env.DB, staff.id, "inactive-capacity-session");
    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(staff.id).run();

    const response = await call("/api/v1/auth/session", { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "AUTH_INVALID" } });
  });
});
