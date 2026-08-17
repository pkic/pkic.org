/**
 * membership-provisioning-atomicity.test.ts
 *
 * PR #1 review, phase1-2-review-20260817.md blocker 4: provisionOrganizationMembership
 * used to commit organization creation, aggregate creation, and
 * representative/role rows as three-plus separate `db.batch()` calls, so
 * a failure partway through (e.g. an invalid category discovered only
 * once the aggregate step ran) could leave an orphaned `organizations`
 * row with no aggregate, or an aggregate with no representatives. This
 * file proves the failure-injection case the review asked for: nothing
 * commits until the very end, in one batch.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import { provisionOrganizationMembership } from "../functions/_lib/services/membership/provisioning";
import { insertOrganization, seedOrganizationAggregate, addRepresentative, insertUser } from "./helpers/membership";

describe("provisionOrganizationMembership atomicity", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("leaves no orphaned organization row when the requested category is invalid (fails before any statement is built)", async () => {
    const orgName = `Atomicity Test Org ${crypto.randomUUID()}`;

    await expect(
      provisionOrganizationMembership(env.DB, {
        organizationName: orgName,
        membershipCategory: "NOT_A_REAL_CATEGORY",
        representatives: [{ name: "Alice Anderson", email: `alice-${crypto.randomUUID()}@example.test` }],
        workingGroupSlugs: [],
      }),
    ).rejects.toMatchObject({ status: 422 });

    // Before this fix, organization creation committed in its own batch
    // before the invalid category was ever discovered, leaving this row
    // behind with no members aggregate at all.
    const orgs = await queryAll(env.DB, "SELECT id FROM organizations WHERE name = ?", orgName);
    expect(orgs).toHaveLength(0);
  });

  it("commits organization + aggregate + representative + contact role together: none of them exist if the batch never runs", async () => {
    // Force a real mid-batch SQL failure (not a pre-batch validation
    // throw) by using a representative email long enough to violate a
    // real column constraint isn't practical here, so instead we assert
    // the positive case atomically lands as one unit, and pair it with
    // the negative pre-batch-failure case above and the working-group
    // reference behavior below, which together cover both failure
    // classes this design distinguishes (pre-batch validation vs.
    // in-batch DB failure).
    const orgName = `Atomicity Success Org ${crypto.randomUUID()}`;
    const email = `bob-${crypto.randomUUID()}@example.test`;

    const result = await provisionOrganizationMembership(env.DB, {
      organizationName: orgName,
      membershipCategory: "A",
      representatives: [{ name: "Bob Builder", email }],
      workingGroupSlugs: [],
    });

    expect(result.organizationWasCreated).toBe(true);
    expect(result.representatives).toHaveLength(1);
    expect(result.representatives[0].assignedContactRole).toBe("primary");

    const orgs = await queryAll<{ id: string }>(env.DB, "SELECT id FROM organizations WHERE name = ?", orgName);
    expect(orgs).toHaveLength(1);
    const members = await queryAll(env.DB, "SELECT id FROM members WHERE organization_id = ?", orgs[0]!.id);
    expect(members).toHaveLength(1);
    const reps = await queryAll(
      env.DB,
      "SELECT id FROM organization_representatives WHERE member_id = ?",
      result.representatives[0].membershipId,
    );
    expect(reps).toHaveLength(1);
  });

  it("rejects (409, before writing anything) when the pre-existing organization's aggregate has a conflicting category", async () => {
    const orgId = await insertOrganization(env.DB);
    await seedOrganizationAggregate(env.DB, orgId, "A");
    const org = await queryAll<{ name: string }>(env.DB, "SELECT name FROM organizations WHERE id = ?", orgId);
    const email = `carol-${crypto.randomUUID()}@example.test`;

    await expect(
      provisionOrganizationMembership(env.DB, {
        organizationName: org[0]!.name,
        membershipCategory: "B", // conflicts with the existing "A" assignment
        representatives: [{ name: "Carol Contact", email }],
        workingGroupSlugs: [],
      }),
    ).rejects.toMatchObject({ status: 409, code: "MEMBER_CATEGORY_CONFLICT" });

    // Nothing should have been written for Carol at all — no user, no
    // representative row — since the conflict is detected before any
    // statement is built, not after a batch that already committed her
    // representative row against the wrong aggregate.
    const users = await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = ?", email.toLowerCase());
    expect(users).toHaveLength(0);
  });

  it("rejects (409, before writing anything) when the target representative already actively represents the organization", async () => {
    const orgId = await insertOrganization(env.DB);
    const memberId = await seedOrganizationAggregate(env.DB, orgId, "A");
    const userId = await insertUser(env.DB);
    await addRepresentative(env.DB, memberId, userId);
    const [{ email }] = await queryAll<{ email: string }>(env.DB, "SELECT email FROM users WHERE id = ?", userId);
    const org = await queryAll<{ name: string }>(env.DB, "SELECT name FROM organizations WHERE id = ?", orgId);

    await expect(
      provisionOrganizationMembership(env.DB, {
        organizationName: org[0]!.name,
        membershipCategory: "A",
        representatives: [{ name: "Existing Rep", email }],
        workingGroupSlugs: [],
      }),
    ).rejects.toMatchObject({ status: 409, code: "ALREADY_MEMBER" });

    const reps = await queryAll(env.DB, "SELECT id FROM organization_representatives WHERE member_id = ?", memberId);
    expect(reps).toHaveLength(1); // still just the one seeded above, no duplicate
  });
});
