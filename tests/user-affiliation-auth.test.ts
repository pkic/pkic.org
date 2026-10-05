import { grantAdministrator } from "./helpers/administrator";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { userAuthSessionResponseSchema } from "../assets/shared/schemas/user-auth";
import { queueUserSignInCapability, redeemUserSignInCapability } from "../functions/_lib/auth/user-session";
import { findEligibleMemberById, resolveIdentityCapacities } from "../functions/_lib/auth/identity-capacities";
import { ACTIVE_USER_CAPACITIES_CTE } from "../functions/_lib/services/membership/capacity-query";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { nowIso } from "../functions/_lib/utils/time";
import { grantIndividualMembership } from "../functions/_lib/services/membership/capacities";
import { createUserBackedAuthAdmin } from "../functions/_lib/auth/admin-identity";
import { createTestRateLimiter, deliveredEmailPayload, queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import {
  insertIndividualMember,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const SIGNING_SECRET = "test-signing-secret";
let emailRateLimiter: ReturnType<typeof createTestRateLimiter>;
let ipRateLimiter: ReturnType<typeof createTestRateLimiter>;

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  return app.fetch(
    new Request(`https://app.test${path}`, { ...init, headers }),
    { ...env, EMAIL_RATE_LIMITER: emailRateLimiter, IP_RATE_LIMITER: ipRateLimiter } as never,
    {
      passThroughOnException() {},
      waitUntil() {},
    } as never,
  );
}

async function affiliation(userId?: string) {
  const personId = userId ?? (await insertUser(env.DB, "affiliated@example.test"));
  const organizationId = await insertOrganization(env.DB, `Recorded employer ${crypto.randomUUID()}`);
  const prepared = await buildCreateIdentityStatement(env.DB, {
    userId: personId,
    organizationId,
    source: "staff",
    startImmediately: true,
    now: nowIso(),
  });
  await env.DB.batch([prepared.statement]);
  return { userId: personId, organizationId, identityId: prepared.identityId };
}

async function requestSignInToken(email = "affiliated@example.test") {
  const response = await call("/api/v1/auth/request-link", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  expect(response.status).toBe(200);
  const [outbox] = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox WHERE template_key='user_magic_link' ORDER BY rowid DESC LIMIT 1",
  );
  if (!outbox) throw new Error("Expected an affiliation sign-in email");
  const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, env, outbox.payload_json);
  const token = new URLSearchParams(new URL(delivered.magicLinkUrl).hash.split("?", 2)[1]).get("token");
  if (!token) throw new Error("Expected a sign-in token");
  return token;
}

async function signIn(email = "affiliated@example.test") {
  const token = await requestSignInToken(email);
  const verified = await call("/api/v1/auth/verify-link", { method: "POST", body: JSON.stringify({ token }) });
  expect(verified.status).toBe(200);
  return {
    session: userAuthSessionResponseSchema.parse(await verified.json()),
    cookie: (verified.headers.get("set-cookie") ?? "").split(";", 1)[0],
    token,
  };
}

async function endAffiliation(identityId: string, block = false) {
  const at = nowIso();
  await env.DB.prepare("UPDATE identities SET ended_at=?,blocked_at=?,updated_at=? WHERE id=?")
    .bind(at, block ? at : null, at, identityId)
    .run();
}

async function membershipActor() {
  const email = "affiliation-membership-admin@example.test";
  const id = await insertUser(env.DB, email);
  const grants = await grantAdministrator(env.DB, id);
  return createUserBackedAuthAdmin({ id, email, grants });
}

describe("affiliation-only account access", () => {
  beforeEach(async () => {
    await resetDb();
    emailRateLimiter = createTestRateLimiter(20);
    ipRateLimiter = createTestRateLimiter(20);
  });

  it("establishes and refreshes own-account access without creating a membership or workspace authority", async () => {
    const f = await affiliation();
    const signedIn = await signIn();
    expect(signedIn.session).toMatchObject({ hasActiveAffiliation: true, sponsors: [], pendingIdentityCount: 0 });
    expect(signedIn.session.member).toBeUndefined();
    expect(signedIn.session.staff).toBeUndefined();
    expect(await queryAll(env.DB, "SELECT id FROM members WHERE organization_id=?", [f.organizationId])).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM group_memberships WHERE user_id=?", [f.userId])).toEqual([]);
    const headers = { cookie: signedIn.cookie };
    const refreshed = await call("/api/v1/auth/session", { headers });
    expect(refreshed.status).toBe(200);
    expect(userAuthSessionResponseSchema.parse(await refreshed.json()).hasActiveAffiliation).toBe(true);
    expect((await call(`/api/v1/users/${f.userId}`, { headers })).status).toBe(200);
    const otherUser = await insertUser(env.DB, "unrelated@example.test");
    expect((await call(`/api/v1/users/${otherUser}`, { headers })).status).toBe(403);
    expect((await call("/api/v1/users/current", { headers })).status).toBe(403);
    expect((await call("/api/v1/users", { headers })).status).toBe(403);
    expect((await call(`/api/v1/organizations/${f.organizationId}`, { headers })).status).toBe(403);
  });

  it("allows a previously verified alias to authenticate the same canonical affiliated person", async () => {
    const f = await affiliation();
    await env.DB.prepare(
      "INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,created_at) VALUES (?,?,?,?,?,?)",
    )
      .bind(crypto.randomUUID(), f.userId, "work@employer.example", "work@employer.example", nowIso(), nowIso())
      .run();
    const signedIn = await signIn("work@employer.example");
    expect(signedIn.session).toMatchObject({ identity: { id: f.userId }, hasActiveAffiliation: true });
    expect(signedIn.session.member).toBeUndefined();
  });

  it("does not issue affiliation access for an unverified alias or a person without an active affiliation", async () => {
    const f = await affiliation();
    await env.DB.prepare("INSERT INTO user_emails(id,user_id,email,normalized_email,created_at) VALUES (?,?,?,?,?)")
      .bind(crypto.randomUUID(), f.userId, "pending@employer.example", "pending@employer.example", nowIso())
      .run();
    expect(
      await queueUserSignInCapability({
        db: env.DB,
        email: "pending@employer.example",
        ttlMinutes: 10,
        signingSecret: SIGNING_SECRET,
      }),
    ).toBeNull();
    await endAffiliation(f.identityId);
    expect(
      await queueUserSignInCapability({
        db: env.DB,
        email: "affiliated@example.test",
        ttlMinutes: 10,
        signingSecret: SIGNING_SECRET,
      }),
    ).toBeNull();
  });

  it.each(["ended", "blocked", "disabled"] as const)(
    "removes sole affiliation access after %s changes",
    async (change) => {
      const f = await affiliation();
      const signedIn = await signIn();
      if (change === "disabled") await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(f.userId).run();
      else await endAffiliation(f.identityId, change === "blocked");
      expect((await call("/api/v1/auth/session", { headers: { cookie: signedIn.cookie } })).status).toBe(401);
    },
  );

  it.each(["ended", "blocked", "disabled"] as const)(
    "rolls back session creation if affiliation authority becomes %s before commit",
    async (change) => {
      const f = await affiliation();
      const token = await requestSignInToken();
      const sessionsBefore = await queryAll(env.DB, "SELECT id FROM sessions WHERE user_id=?", [f.userId]);
      const raced = mutateBeforeNextBatch(env.DB, async () => {
        if (change === "disabled") await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(f.userId).run();
        else await endAffiliation(f.identityId, change === "blocked");
      });
      await expect(
        redeemUserSignInCapability(raced, {
          token,
          signingSecret: SIGNING_SECRET,
          sessionTtlHours: 24,
        }),
      ).rejects.toThrow();
      expect(await queryAll(env.DB, "SELECT id FROM sessions WHERE user_id=?", [f.userId])).toEqual(sessionsBefore);
      expect(
        await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='user_magic_link_verified' AND actor_id=?", [
          f.userId,
        ]),
      ).toEqual([]);
      expect(
        (
          await env.DB.prepare("SELECT email_verified_at FROM users WHERE id=?")
            .bind(f.userId)
            .first<{ email_verified_at: string | null }>()
        )?.email_verified_at,
      ).toBeNull();
    },
  );

  it("retains individual membership alongside a nonmember affiliation, and suppresses it only for an active member organization", async () => {
    const person = await insertIndividualMember(env.DB, "H5", "affiliated@example.test");
    const f = await affiliation(person.userId);
    expect((await findEligibleMemberById(env.DB, person.userId))?.memberId).toBe(person.memberId);
    expect(
      await queryAll(env.DB, `${ACTIVE_USER_CAPACITIES_CTE} SELECT member_id FROM active_user_capacities`, [
        person.userId,
      ]),
    ).toEqual([{ member_id: person.memberId }]);
    const signedIn = await signIn();
    expect(signedIn.session.member?.memberId).toBe(person.memberId);
    await endAffiliation(f.identityId);
    const retained = await call("/api/v1/auth/session", { headers: { cookie: signedIn.cookie } });
    expect(retained.status).toBe(200);
    expect(userAuthSessionResponseSchema.parse(await retained.json())).toMatchObject({
      hasActiveAffiliation: false,
      member: { memberId: person.memberId },
    });

    const nextAffiliation = await affiliation(person.userId);
    const organizationMember = await seedOrganizationAggregate(env.DB, nextAffiliation.organizationId, "A");
    expect((await findEligibleMemberById(env.DB, person.userId))?.activeIdentities.map((row) => row.memberId)).toEqual([
      organizationMember,
    ]);
    expect(
      await queryAll(env.DB, `${ACTIVE_USER_CAPACITIES_CTE} SELECT member_id FROM active_user_capacities`, [
        person.userId,
      ]),
    ).toEqual([{ member_id: organizationMember }]);
    await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(organizationMember).run();
    expect((await findEligibleMemberById(env.DB, person.userId))?.memberId).toBe(person.memberId);
    expect((await resolveIdentityCapacities(env.DB, person.userId))?.hasActiveAffiliation).toBe(true);
  });

  it("permits an explicitly authorized individual membership grant while retaining an unrelated nonmember affiliation", async () => {
    const f = await affiliation();
    const actor = await membershipActor();
    const granted = await grantIndividualMembership(env.DB, actor, {
      userId: f.userId,
      membershipCategory: "H5",
      activationReason: "Reviewed individual membership independent of nonmember employer",
    });
    expect((await findEligibleMemberById(env.DB, f.userId))?.identityId).toBe(granted.id);
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE id=? AND ended_at IS NULL", [f.identityId])).toEqual(
      [{ id: f.identityId }],
    );
    expect(await queryAll(env.DB, "SELECT id FROM members WHERE organization_id=?", [f.organizationId])).toEqual([]);
  });

  it("rolls back an individual membership grant when the existing affiliation acquires organization membership before commit", async () => {
    const f = await affiliation();
    const actor = await membershipActor();
    const raced = mutateBeforeNextBatch(env.DB, () => seedOrganizationAggregate(env.DB, f.organizationId, "A"));
    await expect(
      grantIndividualMembership(raced, actor, {
        userId: f.userId,
        membershipCategory: "H5",
        activationReason: "Reviewed individual membership before organization membership changed",
      }),
    ).rejects.toMatchObject({ code: "MEMBERSHIP_TARGET_CHANGED" });
    expect(await queryAll(env.DB, "SELECT id FROM members WHERE user_id=?", [f.userId])).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=? AND organization_id IS NULL", [f.userId]),
    ).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='individual_identity_activated' AND actor_id=?", [
        actor.id,
      ]),
    ).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM group_memberships WHERE user_id=?", [f.userId])).toEqual([]);
  });
});
