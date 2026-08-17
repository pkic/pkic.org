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
import { resetDb } from "./helpers/reset-db";
import { insertUser, insertOrganization, seedOrganizationAggregate, addRepresentative } from "./helpers/membership";
import { findEligibleMemberById, switchActiveMembership } from "../functions/_lib/auth/member";
import { getMyProfile } from "../functions/_lib/services/member-self-service";

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
