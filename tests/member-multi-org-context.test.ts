/**
 * Phase 1 §1.4 required test (post-review-remediation): a user who
 * concurrently represents two organizations must never be resolved into an
 * arbitrary one. functions/_lib/auth/member.ts previously used first() over
 * an unordered UNION, silently picking whichever row D1 returned. This
 * exercises login (deterministic default), an authorized explicit switch,
 * and rejection of switching to a membership the caller doesn't hold.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { insertUser, insertOrganization, seedOrganizationAggregate, addRepresentative } from "./helpers/membership";
import { findEligibleMemberById, switchActiveMembership } from "../functions/_lib/auth/member";
import { getMyProfile } from "../functions/_lib/services/member-self-service";
import { createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return app.fetch(
    new Request(`https://app.test${path}`, { ...init, headers }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

beforeEach(async () => {
  await resetDb();
});

describe("member auth — multi-organization membership context", () => {
  it("enumerates every eligible membership and defaults deterministically, not arbitrarily", async () => {
    const userId = await insertUser(env.DB);
    const orgAId = await insertOrganization(env.DB, "Org Alpha");
    const orgBId = await insertOrganization(env.DB, "Org Beta");
    const memberAId = await seedOrganizationAggregate(env.DB, orgAId, "A");
    const memberBId = await seedOrganizationAggregate(env.DB, orgBId, "B");
    await addRepresentative(env.DB, memberAId, userId);
    await addRepresentative(env.DB, memberBId, userId);

    const member = await findEligibleMemberById(env.DB, userId);
    expect(member).not.toBeNull();
    const byMemberId = new Map(member!.activeMemberships.map((m) => [m.memberId, m]));
    expect(byMemberId.get(memberAId)?.organizationName).toBe("Org Alpha");
    expect(byMemberId.get(memberBId)?.organizationName).toBe("Org Beta");
    expect(member!.activeMemberships).toHaveLength(2);
    expect(new Set(member!.activeMemberships.map((m) => m.memberId))).toEqual(new Set([memberAId, memberBId]));

    // Deterministic: re-resolving must always select the same default.
    const again = await findEligibleMemberById(env.DB, userId);
    expect(again!.memberId).toBe(member!.memberId);
  });

  it("lets a caller act through their organization-scoped profile for each membership they actually hold", async () => {
    const userId = await insertUser(env.DB);
    const orgAId = await insertOrganization(env.DB);
    const orgBId = await insertOrganization(env.DB);
    const memberAId = await seedOrganizationAggregate(env.DB, orgAId, "A");
    const memberBId = await seedOrganizationAggregate(env.DB, orgBId, "B");
    await addRepresentative(env.DB, memberAId, userId);
    await addRepresentative(env.DB, memberBId, userId);

    const asA = await findEligibleMemberById(env.DB, userId, memberAId);
    expect(asA!.memberId).toBe(memberAId);
    expect(asA!.organizationId).toBe(orgAId);
    const profileA = await getMyProfile(env.DB, asA!);
    expect(profileA.organizationId).toBe(orgAId);

    const asB = await findEligibleMemberById(env.DB, userId, memberBId);
    expect(asB!.memberId).toBe(memberBId);
    expect(asB!.organizationId).toBe(orgBId);
    const profileB = await getMyProfile(env.DB, asB!);
    expect(profileB.organizationId).toBe(orgBId);
  });

  it("keeps email, job title, biography, and links separate for each represented organization", async () => {
    const userId = await insertUser(env.DB);
    const orgAId = await insertOrganization(env.DB, "Org Alpha");
    const orgBId = await insertOrganization(env.DB, "Org Beta");
    const memberAId = await seedOrganizationAggregate(env.DB, orgAId, "A");
    const memberBId = await seedOrganizationAggregate(env.DB, orgBId, "B");
    await addRepresentative(env.DB, memberAId, userId);
    await addRepresentative(env.DB, memberBId, userId);
    const emailAId = crypto.randomUUID();
    const emailBId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user_emails
             (id, user_id, email, normalized_email, verified_at, verification_method, created_at)
           VALUES (?, ?, ?, ?, datetime('now'), 'magic_link', datetime('now'))`,
      ).bind(emailAId, userId, "person@alpha.example", "person@alpha.example"),
      env.DB.prepare(
        `INSERT INTO user_emails
             (id, user_id, email, normalized_email, verified_at, verification_method, created_at)
           VALUES (?, ?, ?, ?, datetime('now'), 'magic_link', datetime('now'))`,
      ).bind(emailBId, userId, "person@beta.example", "person@beta.example"),
      env.DB.prepare(
        `UPDATE organization_representatives
              SET email_id = ?, job_title = 'Alpha standards lead', biography = 'Alpha biography',
                  links_json = '["https://alpha.example/profile"]', updated_at = datetime('now')
            WHERE member_id = ? AND user_id = ?`,
      ).bind(emailAId, memberAId, userId),
      env.DB.prepare(
        `UPDATE organization_representatives
              SET email_id = ?, job_title = 'Beta policy lead', biography = 'Beta biography',
                  links_json = '["https://beta.example/profile"]', updated_at = datetime('now')
            WHERE member_id = ? AND user_id = ?`,
      ).bind(emailBId, memberBId, userId),
    ]);

    const tokenA = await createMemberSession(env.DB, userId, "multi-org-a", undefined, memberAId);
    const tokenB = await createMemberSession(env.DB, userId, "multi-org-b", undefined, memberBId);
    const profileA = await (await call(tokenA, "/api/v1/users/current")).json<any>();
    const profileB = await (await call(tokenB, "/api/v1/users/current")).json<any>();
    expect(profileA).toMatchObject({
      organizationId: orgAId,
      emailId: emailAId,
      email: "person@alpha.example",
      jobTitle: "Alpha standards lead",
      biography: "Alpha biography",
      links: ["https://alpha.example/profile"],
    });
    expect(profileB).toMatchObject({
      organizationId: orgBId,
      emailId: emailBId,
      email: "person@beta.example",
      jobTitle: "Beta policy lead",
      biography: "Beta biography",
      links: ["https://beta.example/profile"],
    });

    const updated = await call(tokenA, "/api/v1/users/current", {
      method: "PATCH",
      body: JSON.stringify({
        emailId: null,
        jobTitle: "Updated Alpha role",
        biography: "Updated Alpha biography",
        links: ["https://alpha.example/new"],
      }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      organizationId: orgAId,
      emailId: null,
      jobTitle: "Updated Alpha role",
      biography: "Updated Alpha biography",
      links: ["https://alpha.example/new"],
    });
    expect(await (await call(tokenB, "/api/v1/users/current")).json()).toMatchObject({
      organizationId: orgBId,
      emailId: emailBId,
      email: "person@beta.example",
      jobTitle: "Beta policy lead",
      biography: "Beta biography",
      links: ["https://beta.example/profile"],
    });
    expect(
      await queryAll<{ job_title: string | null; biography: string | null; links_json: string | null }>(
        env.DB,
        "SELECT job_title, biography, links_json FROM users WHERE id = ?",
        [userId],
      ),
    ).toEqual([{ job_title: null, biography: null, links_json: null }]);
  });

  it("switchActiveMembership authorizes against the caller's own live memberships, not the client's say-so", async () => {
    const userId = await insertUser(env.DB);
    const otherUserId = await insertUser(env.DB);
    const orgAId = await insertOrganization(env.DB);
    const orgBId = await insertOrganization(env.DB);
    const orgCId = await insertOrganization(env.DB);
    const memberAId = await seedOrganizationAggregate(env.DB, orgAId, "A");
    const memberBId = await seedOrganizationAggregate(env.DB, orgBId, "B");
    const memberCId = await seedOrganizationAggregate(env.DB, orgCId, "C");
    await addRepresentative(env.DB, memberAId, userId);
    await addRepresentative(env.DB, memberBId, userId);
    // memberC is represented by a different user entirely.
    await addRepresentative(env.DB, memberCId, otherUserId);

    const initial = await findEligibleMemberById(env.DB, userId);
    const switched = await switchActiveMembership(env.DB, initial!, memberBId);
    expect(switched.memberId).toBe(memberBId);
    expect(switched.organizationId).toBe(orgBId);

    await expect(switchActiveMembership(env.DB, initial!, memberCId)).rejects.toThrow();
  });

  it("falls back to the deterministic default when a stale/tampered mid claim no longer matches an eligible membership", async () => {
    const userId = await insertUser(env.DB);
    const orgAId = await insertOrganization(env.DB);
    const memberAId = await seedOrganizationAggregate(env.DB, orgAId, "A");
    await addRepresentative(env.DB, memberAId, userId);

    const resolved = await findEligibleMemberById(env.DB, userId, "not-a-real-member-id");
    expect(resolved!.memberId).toBe(memberAId);
  });
});
