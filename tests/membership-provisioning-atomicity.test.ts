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
import {
  buildProvisionOrganizationMembership,
  provisionOrganizationMembership,
} from "../functions/_lib/services/membership/provisioning";
import { insertOrganization, seedOrganizationAggregate, addRepresentative, insertUser } from "./helpers/membership";

async function publicationCount() {
  return env.DB.prepare(
    "SELECT COUNT(*) AS count FROM site_publication_requests WHERE resource_type='membership'",
  ).first<number>("count");
}

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
        identities: [{ name: "Alice Anderson", email: `alice-${crypto.randomUUID()}@example.test` }],
        identitySource: "staff",
        activateIdentities: true,
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
      identities: [{ name: "Bob Builder", email }],
      identitySource: "staff",
      activateIdentities: true,
      workingGroupSlugs: [],
    });

    expect(result.organizationWasCreated).toBe(true);
    expect(result.identities).toHaveLength(1);
    expect(result.identities[0].assignedContactRole).toBe("primary");

    const orgs = await queryAll<{ id: string }>(env.DB, "SELECT id FROM organizations WHERE name = ?", orgName);
    expect(orgs).toHaveLength(1);
    const members = await queryAll(env.DB, "SELECT id FROM members WHERE organization_id = ?", orgs[0]!.id);
    expect(members).toHaveLength(1);
    const identities = await queryAll(env.DB, "SELECT id FROM identities WHERE organization_id = ?", orgs[0]!.id);
    expect(identities).toHaveLength(1);
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
        identities: [{ name: "Carol Contact", email }],
        identitySource: "staff",
        activateIdentities: true,
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
        identities: [{ name: "Existing Rep", email }],
        identitySource: "staff",
        activateIdentities: true,
        workingGroupSlugs: [],
      }),
    ).rejects.toMatchObject({ status: 409, code: "ALREADY_MEMBER" });

    const identities = await queryAll(env.DB, "SELECT id FROM identities WHERE organization_id = ?", orgId);
    expect(identities).toHaveLength(1); // still just the one seeded above, no duplicate
  });
  it("queues one request for new public data and reuses unchanged affiliations without another publication", async () => {
    const input = {
      organizationName: "Public provisioning publisher",
      membershipCategory: "F",
      memberSince: "2026-01-15",
      identities: [{ name: "Alice Author", email: "alice-provision@example.test", jobTitle: "Engineer" }],
      identitySource: "staff" as const,
      activateIdentities: true,
      workingGroupSlugs: [],
      rejectExistingMembership: false,
    };
    const first = await provisionOrganizationMembership(env.DB, input);
    expect(await publicationCount()).toBe(1);
    const replay = await provisionOrganizationMembership(env.DB, input);
    expect(replay.identities[0].identityId).toBe(first.identities[0].identityId);
    expect(await publicationCount()).toBe(1);
    await provisionOrganizationMembership(env.DB, {
      ...input,
      identities: [{ name: "Bob Builder", email: "bob-provision@example.test", jobTitle: "Architect" }],
    });
    expect(await publicationCount()).toBe(2);
    await provisionOrganizationMembership(env.DB, {
      ...input,
      activateIdentities: false,
      identities: [{ name: "Private invite", email: "private-provision@example.test", jobTitle: "Engineer" }],
    });
    expect(await publicationCount()).toBe(2);
    await env.DB.prepare("UPDATE members SET member_since=NULL WHERE id=?")
      .bind(first.identities[0].membershipId)
      .run();
    await provisionOrganizationMembership(env.DB, { ...input, identities: [] });
    expect(await publicationCount()).toBe(3);
    await provisionOrganizationMembership(env.DB, { ...input, identities: [] });
    expect(await publicationCount()).toBe(3);
  });

  it("rolls back provisioning and publication together when a request insert fails", async () => {
    await env.DB.prepare(`CREATE TRIGGER fail_provision_publication BEFORE INSERT ON site_publication_requests
      WHEN NEW.resource_type='membership' BEGIN SELECT RAISE(ABORT,'forced provisioning publication failure'); END`).run();
    try {
      await expect(
        provisionOrganizationMembership(env.DB, {
          organizationName: "Rollback publisher",
          membershipCategory: "F",
          identities: [{ name: "Rollback person", email: "rollback-provision@example.test", jobTitle: "Engineer" }],
          identitySource: "staff",
          activateIdentities: true,
          workingGroupSlugs: [],
        }),
      ).rejects.toThrow("forced provisioning publication failure");
      expect(await publicationCount()).toBe(0);
      expect(await queryAll(env.DB, "SELECT id FROM organizations")).toEqual([]);
      expect(await queryAll(env.DB, "SELECT id FROM members")).toEqual([]);
      expect(await queryAll(env.DB, "SELECT id FROM identities")).toEqual([]);
      expect(await queryAll(env.DB, "SELECT id FROM users")).toEqual([]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_provision_publication").run();
    }
  });
});

/** The individual path must use the same known-address discovery as its preparation. */
describe("individual membership alias preflight", () => {
  beforeEach(resetDb);

  function input(email: string, rejectExistingMembership = true) {
    return {
      membershipCategory: "H5",
      identities: [{ name: "Alias Member", email }],
      identitySource: "staff" as const,
      activateIdentities: true,
      workingGroupSlugs: [],
      rejectExistingMembership,
    };
  }

  async function addAlias(userId: string, verified: boolean) {
    const email = "known-alias@example.test";
    await env.DB.prepare(`INSERT INTO user_emails (id,user_id,email,normalized_email,verified_at,created_at)
      VALUES (?,?,?,?,?,?)`)
      .bind(
        crypto.randomUUID(),
        userId,
        email,
        email,
        verified ? "2026-10-17T00:00:00.000Z" : null,
        "2026-10-17T00:00:00.000Z",
      )
      .run();
    return email;
  }

  async function effectCounts() {
    return queryAll(
      env.DB,
      `SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM members) AS members,
      (SELECT COUNT(*) FROM identities) AS identities,
      (SELECT COUNT(*) FROM user_roles) AS roles,
      (SELECT COUNT(*) FROM group_memberships) AS groups,
      (SELECT COUNT(*) FROM audit_log) AS audits,
      (SELECT COUNT(*) FROM email_outbox) AS notifications,
      (SELECT COUNT(*) FROM site_publication_requests) AS publications`,
    );
  }

  it.each(["primary", "case-normalized primary", "verified alias", "unverified alias"])(
    "refuses an existing individual member via %s before writing",
    async (variant) => {
      const primary = "individual@example.test";
      const member = await provisionOrganizationMembership(env.DB, input(primary));
      const alias = await addAlias(member.identities[0].userId, variant === "verified alias");
      const before = await effectCounts();
      const email =
        variant === "primary" ? primary : variant === "case-normalized primary" ? primary.toUpperCase() : alias;
      await expect(provisionOrganizationMembership(env.DB, input(email))).rejects.toMatchObject({
        status: 409,
        code: "ALREADY_MEMBER",
      });
      expect(await effectCounts()).toEqual(before);
    },
  );

  it("does not grant an approved applicant's membership to an unverified alias holder", async () => {
    const claimantId = await insertUser(env.DB);
    const email = await addAlias(claimantId, false);
    const result = await provisionOrganizationMembership(env.DB, {
      ...input(email),
      identitySource: "membership_approval",
      mailboxVerified: true,
    });
    expect(result.identities[0].userId).not.toBe(claimantId);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE id=?", claimantId)).toHaveLength(1);
    expect(
      await env.DB.prepare("SELECT email_verified_at FROM users WHERE id=?")
        .bind(result.identities[0].userId)
        .first("email_verified_at"),
    ).not.toBeNull();
    expect(
      await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=? AND started_at IS NOT NULL", claimantId),
    ).toHaveLength(0);
  });

  it.each([true, false])("reuses the canonical nonmember through a known alias (verified=%s)", async (verified) => {
    const userId = await insertUser(env.DB);
    const alias = await addAlias(userId, verified);
    const result = await provisionOrganizationMembership(env.DB, input(alias));
    expect(result.identities[0].userId).toBe(userId);
    expect(await queryAll(env.DB, "SELECT id FROM users")).toEqual([{ id: userId }]);
    expect(
      await queryAll(env.DB, "SELECT user_id FROM identities WHERE id=?", result.identities[0].identityId),
    ).toEqual([{ user_id: userId }]);
  });

  it("adds approved membership to an attendee's existing personal identity without replacing its profile", async () => {
    const userId = await insertUser(env.DB);
    const alias = await addAlias(userId, true);
    const identityId = crypto.randomUUID();
    const at = "2026-10-17T00:00:00.000Z";
    await env.DB.prepare(`INSERT INTO identities(id,user_id,source,biography,show_on_organization_profile,invited_at,started_at,created_at,updated_at)
      VALUES(?,?,'staff','Existing attendee profile',0,?,?,?,?)`)
      .bind(identityId, userId, at, at, at, at)
      .run();
    const result = await provisionOrganizationMembership(env.DB, input(alias));
    expect(result.identities[0].identityId).toBe(identityId);
    expect(
      await env.DB.prepare("SELECT biography FROM identities WHERE id=?").bind(identityId).first("biography"),
    ).toBe("Existing attendee profile");
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", userId)).toEqual([{ id: identityId }]);
  });

  it("preserves rejection-disabled reuse and the existing active-identity refusal", async () => {
    const userId = await insertUser(env.DB);
    const alias = await addAlias(userId, false);
    const created = await provisionOrganizationMembership(env.DB, input(alias, false));
    expect(created.identities[0].userId).toBe(userId);
    const before = await effectCounts();
    // Disabling the membership preflight preserves the existing active-identity refusal.
    await expect(provisionOrganizationMembership(env.DB, input(alias, false))).rejects.toMatchObject({
      status: 409,
      code: "IDENTITY_ALREADY_ACTIVE",
    });
    expect(await effectCounts()).toEqual(before);
  });

  it("cannot steal a pending address reservation, including a reservation made after preparation", async () => {
    const ownerId = await insertUser(env.DB);
    const eventId = crypto.randomUUID(),
      registrationId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events (id,slug,name,timezone,created_at,updated_at) VALUES (?,'pending-alias','Pending alias','UTC',?,?)",
    )
      .bind(eventId, "2026-10-17T00:00:00.000Z", "2026-10-17T00:00:00.000Z")
      .run();
    await env.DB.prepare(`INSERT INTO registrations (id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,confirmation_link_secret,created_at,updated_at)
      VALUES (?,?,?,'pending_email_confirmation','virtual','test',?,?,?,?)`)
      .bind(
        registrationId,
        eventId,
        ownerId,
        crypto.randomUUID(),
        crypto.randomUUID(),
        "2026-10-17T00:00:00.000Z",
        "2026-10-17T00:00:00.000Z",
      )
      .run();
    const email = "reserved@example.test";
    const prepared = await buildProvisionOrganizationMembership(env.DB, input(email));
    await env.DB.prepare("UPDATE users SET pending_email=?,pending_email_change_registration_id=? WHERE id=?")
      .bind(email, registrationId, ownerId)
      .run();
    const before = await effectCounts();
    await expect(env.DB.batch(prepared.statements)).rejects.toThrow("EMAIL_TAKEN");
    expect(await effectCounts()).toEqual(before);
    await expect(provisionOrganizationMembership(env.DB, input(email))).rejects.toThrow("EMAIL_TAKEN");
    expect(await effectCounts()).toEqual(before);
  });

  it("rolls back a prepared alias command if another command creates the membership first", async () => {
    const userId = await insertUser(env.DB);
    const alias = await addAlias(userId, true);
    const stale = await buildProvisionOrganizationMembership(env.DB, input(alias));
    await provisionOrganizationMembership(env.DB, input(alias));
    const before = await effectCounts();
    await expect(env.DB.batch(stale.statements)).rejects.toThrow();
    expect(await effectCounts()).toEqual(before);
  });
});
