/**
 * membership-provisioning-concurrency.test.ts
 *
 * PR #1 review, phase1-2-review-20260817.md blocker 4 remediation gap: the
 * atomicity fix in provisioning.ts and membership-provisioning-atomicity.test.ts
 * was verified with sequential failure-injection only — no test ever fired
 * two actual simultaneous requests at the provisioning path. This file
 * does that with real `Promise.all` concurrency against the same D1
 * binding, not a simulated/sequential race.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import { provisionOrganizationMembership } from "../functions/_lib/services/membership/provisioning";

describe("provisionOrganizationMembership concurrency", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("two concurrent requests for the same brand-new organization name (no domain) do not create two organizations", async () => {
    const orgName = `Concurrency Test Org ${crypto.randomUUID()}`;
    const emailA = `alice-${crypto.randomUUID()}@example.test`;
    const emailB = `bob-${crypto.randomUUID()}@example.test`;

    const results = await Promise.allSettled([
      provisionOrganizationMembership(env.DB, {
        organizationName: orgName,
        membershipCategory: "A",
        identities: [{ name: "Alice Anderson", email: emailA }],
        identitySource: "staff",
        activateIdentities: true,
        workingGroupSlugs: [],
      }),
      provisionOrganizationMembership(env.DB, {
        organizationName: orgName,
        membershipCategory: "A",
        identities: [{ name: "Bob Builder", email: emailB }],
        identitySource: "staff",
        activateIdentities: true,
        workingGroupSlugs: [],
      }),
    ]);

    const orgs = await queryAll<{ id: string }>(env.DB, "SELECT id FROM organizations WHERE name = ?", orgName);
    const aggregates = await queryAll<{ id: string; organization_id: string }>(
      env.DB,
      "SELECT id, organization_id FROM members WHERE organization_id IN (SELECT id FROM organizations WHERE name = ?)",
      orgName,
    );

    // The invariant that actually matters: whatever the two racing callers
    // observed (both succeeding onto one shared org, or one succeeding and
    // one rejecting), the database must never end up with two organization
    // rows or two aggregates for the same org name — that's the "partially
    // provisioned / split organization" failure mode the review's blocker 4
    // was about.
    expect(orgs.length).toBeLessThanOrEqual(1);
    expect(aggregates.length).toBeLessThanOrEqual(1);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Empirically observed outcome of this test against the real D1
    // binding (not simulated): the two `provisionOrganizationMembership`
    // calls genuinely interleave — both pass the pre-batch "does this org
    // exist yet" read before either commits — and the loser's `db.batch()`
    // then fails on the pre-existing `organizations.normalized_name`
    // UNIQUE constraint (migrations/0000_initial_schema.sql:50), which
    // rolls back its entire batch atomically (no partial org/aggregate/
    // representative rows for the loser — confirmed by the assertions
    // above). This is the same "whole batch rolls back cleanly on a
    // losing race" design already documented and relied on for the
    // aggregate race in buildResolveOrCreateAggregateStatements above and
    // memberships.ts's getOrCreateOrganizationMemberAggregate — this test
    // confirms the organization-creation race resolves the same way under
    // real concurrent execution, not just by code inspection.
    if (fulfilled.length === 2) {
      // Both succeeded: they must have resolved onto the same organization,
      // not created a duplicate each.
      const values = fulfilled.map(
        (r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof provisionOrganizationMembership>>>).value,
      );
      expect(values[0]!.organizationId).toBe(values[1]!.organizationId);
      const identities = await queryAll(
        env.DB,
        "SELECT id FROM identities WHERE organization_id = ?",
        values[0]!.identities[0]!.organizationId,
      );
      expect(identities.length).toBe(2);
    } else {
      // One rejected: acceptable outcome too, as long as no orphaned data
      // was left by the loser (checked above via orgs/aggregates counts)
      // and the rejection is specifically the expected organization-name
      // race, not some other unrelated failure this test would otherwise
      // mask.
      expect(rejected.length).toBeGreaterThanOrEqual(1);
      const reason = String((rejected[0] as PromiseRejectedResult).reason);
      expect(reason).toMatch(/UNIQUE constraint failed: organizations\.normalized_name/);
    }
  });
});
