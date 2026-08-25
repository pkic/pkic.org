import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createGroup, joinGroup } from "../functions/_lib/services/groups";
import {
  assessRepresentationDomain,
  associateOrganizationRepresentative,
  blockOrganizationRepresentative,
  organizationRepresentativeManagementEvidence,
  prepareVerifiedDomainAssociationStatements,
  reconcileVerifiedDomainRepresentations,
  restoreOrganizationRepresentative,
} from "../functions/_lib/services/organization-representations";
import { prepareVerifyPrimaryEmailStatement } from "../functions/_lib/services/email-verification";
import type { AuthAdmin } from "../functions/_lib/types";
import { queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import {
  REPRESENTATIVE_ROLE_IDS,
  addRepresentative,
  assignRepresentativeRole,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function claimDomain(organizationId: string, domain: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO organization_domain_claims
       (id, domain, application_id, organization_id, created_at, updated_at)
     VALUES (?, ?, NULL, ?, datetime('now'), datetime('now'))`,
  )
    .bind(crypto.randomUUID(), domain, organizationId)
    .run();
}

async function insertAdmin(email: string): Promise<AuthAdmin> {
  const id = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(id).run();
  return { identityType: "user", id, email, role: "admin" };
}

beforeEach(async () => {
  await resetDb();
});

describe("organization representation domain evidence", () => {
  it("automatically associates only an exact claimed custom domain after mailbox verification", async () => {
    const email = "alice@verified-company.example";
    const userId = await insertUser(env.DB, email);
    const organizationId = await insertOrganization(env.DB, "Verified Company");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await claimDomain(organizationId, "verified-company.example");

    const before = await assessRepresentationDomain(env.DB, userId, email);
    expect(before).toMatchObject({ outcome: "unverified_email", mayAutomaticallyAssociate: false, memberId: null });
    expect(await reconcileVerifiedDomainRepresentations(env.DB, userId)).toEqual([]);

    await env.DB.prepare(
      `UPDATE users
          SET email_verified_at = datetime('now'), email_verification_method = 'magic_link'
        WHERE id = ?`,
    )
      .bind(userId)
      .run();
    const verified = await assessRepresentationDomain(env.DB, userId, email);
    expect(verified).toMatchObject({ outcome: "exact_claimed_match", mayAutomaticallyAssociate: true, memberId });

    const reconciled = await reconcileVerifiedDomainRepresentations(env.DB, userId);
    expect(reconciled).toHaveLength(1);
    const [representative] = await queryAll<{ member_id: string; source: string; left_at: string | null }>(
      env.DB,
      "SELECT member_id, source, left_at FROM organization_representatives WHERE user_id = ?",
      userId,
    );
    expect(representative).toEqual({ member_id: memberId, source: "verified_domain", left_at: null });
    expect(await reconcileVerifiedDomainRepresentations(env.DB, userId)).toEqual([]);
  });

  it("warns for personal email even when verified and never auto-associates it", async () => {
    const userId = await insertUser(env.DB, "personal-representative@gmail.com");
    await env.DB.prepare(
      `UPDATE users
          SET email_verified_at = datetime('now'), email_verification_method = 'magic_link'
        WHERE id = ?`,
    )
      .bind(userId)
      .run();
    const assessment = await assessRepresentationDomain(env.DB, userId, "personal-representative@gmail.com");
    expect(assessment.outcome).toBe("free_or_personal_domain");
    expect(assessment.mayAutomaticallyAssociate).toBe(false);
    expect(assessment.warning).toMatch(/contact may associate/i);
    expect(await reconcileVerifiedDomainRepresentations(env.DB, userId)).toEqual([]);
  });

  it("warns for known disposable domains and never treats them as organization evidence", async () => {
    const userId = await insertUser(env.DB, "throwaway@mailinator.com");
    const organizationId = await insertOrganization(env.DB, "Disposable Domain Org");
    await seedOrganizationAggregate(env.DB, organizationId, "A");
    await claimDomain(organizationId, "mailinator.com");
    await env.DB.prepare(
      `UPDATE users
          SET email_verified_at = datetime('now'), email_verification_method = 'magic_link'
        WHERE id = ?`,
    )
      .bind(userId)
      .run();
    const assessment = await assessRepresentationDomain(env.DB, userId, "throwaway@mailinator.com");
    expect(assessment.outcome).toBe("disposable_domain");
    expect(assessment.mayAutomaticallyAssociate).toBe(false);
    expect(assessment.warning).toMatch(/contact may associate/i);
    expect(await reconcileVerifiedDomainRepresentations(env.DB, userId)).toEqual([]);
  });

  it("commits verification evidence and the exact-domain association in one proof-producing batch", async () => {
    const email = "confirmed@registration-proof.example";
    const userId = await insertUser(env.DB, email);
    const organizationId = await insertOrganization(env.DB, "Registration Proof Org");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await claimDomain(organizationId, "registration-proof.example");
    const at = new Date().toISOString();
    await env.DB.batch([
      prepareVerifyPrimaryEmailStatement(env.DB, {
        userId,
        normalizedEmail: email,
        method: "registration_confirmation",
        verifiedAt: at,
      }),
      ...(await prepareVerifiedDomainAssociationStatements(env.DB, { userId, normalizedEmail: email, at })),
    ]);

    const [user] = await queryAll<{ email_verification_method: string }>(
      env.DB,
      "SELECT email_verification_method FROM users WHERE id = ?",
      userId,
    );
    expect(user.email_verification_method).toBe("registration_confirmation");
    const [representative] = await queryAll<{ member_id: string; source: string }>(
      env.DB,
      "SELECT member_id, source FROM organization_representatives WHERE user_id = ?",
      userId,
    );
    expect(representative).toEqual({ member_id: memberId, source: "verified_domain" });
  });

  it("keeps email verification successful when the optional domain claim disappears before commit", async () => {
    const email = `confirmed-${crypto.randomUUID()}@claim-race.example`;
    const userId = await insertUser(env.DB, email);
    const organizationId = await insertOrganization(env.DB, "Claim Race Org");
    await seedOrganizationAggregate(env.DB, organizationId, "A");
    await claimDomain(organizationId, "claim-race.example");
    const at = new Date().toISOString();
    const associationStatements = await prepareVerifiedDomainAssociationStatements(env.DB, {
      userId,
      normalizedEmail: email,
      at,
    });
    await env.DB.prepare("DELETE FROM organization_domain_claims WHERE domain = ?").bind("claim-race.example").run();

    await env.DB.batch([
      prepareVerifyPrimaryEmailStatement(env.DB, {
        userId,
        normalizedEmail: email,
        method: "registration_confirmation",
        verifiedAt: at,
      }),
      ...associationStatements,
    ]);

    expect(
      await queryAll<{ email_verified_at: string | null }>(env.DB, "SELECT email_verified_at FROM users WHERE id = ?", [
        userId,
      ]),
    ).toEqual([{ email_verified_at: at }]);
    expect(
      await queryAll(env.DB, "SELECT id FROM organization_representatives WHERE user_id = ?", [userId]),
    ).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'organization_representative_domain_reconciled'"),
    ).toHaveLength(0);
  });

  it("reconciles the same verified domain concurrently without duplicate or failed relationships", async () => {
    const email = "race@verified-race.example";
    const userId = await insertUser(env.DB, email);
    const organizationId = await insertOrganization(env.DB, "Verified Race Org");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await claimDomain(organizationId, "verified-race.example");
    await env.DB.prepare(
      `UPDATE users
          SET email_verified_at = datetime('now'), email_verification_method = 'magic_link'
        WHERE id = ?`,
    )
      .bind(userId)
      .run();

    const reconciled = await Promise.all([
      reconcileVerifiedDomainRepresentations(env.DB, userId),
      reconcileVerifiedDomainRepresentations(env.DB, userId),
    ]);
    expect(reconciled.flat()).toHaveLength(1);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM organization_representatives WHERE member_id = ? AND user_id = ? AND left_at IS NULL",
        [memberId, userId],
      ),
    ).toHaveLength(1);
  });

  it("returns no association when a verified domain claim is revoked before the reconciliation batch", async () => {
    const email = `reconcile-${crypto.randomUUID()}@revoked-claim.example`;
    const userId = await insertUser(env.DB, email);
    const organizationId = await insertOrganization(env.DB, "Revoked Claim Org");
    await seedOrganizationAggregate(env.DB, organizationId, "A");
    await claimDomain(organizationId, "revoked-claim.example");
    await env.DB.prepare(
      `UPDATE users
            SET email_verified_at = datetime('now'), email_verification_method = 'magic_link'
          WHERE id = ?`,
    )
      .bind(userId)
      .run();
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("DELETE FROM organization_domain_claims WHERE domain = ?").bind("revoked-claim.example").run(),
    );

    await expect(reconcileVerifiedDomainRepresentations(racingDb, userId)).resolves.toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT id FROM organization_representatives WHERE user_id = ?", [userId]),
    ).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'organization_representative_domain_reconciled'"),
    ).toHaveLength(0);
  });
});

describe("organization-contact association lifecycle", () => {
  it("uses bounded indexes for organization-contact authorization evidence", async () => {
    const organizationId = await insertOrganization(env.DB, "Authorization Plan Org");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const contactUserId = await insertUser(env.DB, "contact@authorization-plan.example");
    await addRepresentative(env.DB, memberId, contactUserId);
    await assignRepresentativeRole(env.DB, memberId, contactUserId, REPRESENTATIVE_ROLE_IDS.primaryContact);
    const evidence = organizationRepresentativeManagementEvidence({
      memberId,
      actorUserId: contactUserId,
      staffAuthorized: false,
    });
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${evidence.sql}`)
      .bind(...evidence.bindings)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");

    expect(details).toMatch(
      /SEARCH representative USING INDEX (?:sqlite_autoindex_organization_representatives_2|idx_organization_representatives_member_active)/,
    );
    expect(details).toMatch(/SEARCH role USING INDEX idx_user_roles_context/);
    expect(details).not.toMatch(/SCAN (representative|role)\b/);
  });

  it("allows immediate explicit association, makes removal persistent, and never restores ended group capacity", async () => {
    const admin = await insertAdmin("representation-admin@example.test");
    const organizationId = await insertOrganization(env.DB, "Representation Lifecycle Org");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const contactUserId = await insertUser(env.DB, "contact@representation.example");
    await addRepresentative(env.DB, memberId, contactUserId);
    await assignRepresentativeRole(env.DB, memberId, contactUserId, REPRESENTATIVE_ROLE_IDS.primaryContact);

    const targetUserId = await insertUser(env.DB, "mistyped-personal-address@gmail.com");
    const actor = { userId: contactUserId, actorType: "member" as const, staffAuthorized: false };
    const representativeId = await associateOrganizationRepresentative(env.DB, actor, {
      memberId,
      userId: targetUserId,
      showOnOrganizationProfile: true,
    });
    const [associated] = await queryAll<{ source: string; blocked_at: string | null }>(
      env.DB,
      "SELECT source, blocked_at FROM organization_representatives WHERE id = ?",
      representativeId,
    );
    expect(associated).toEqual({ source: "organization_contact", blocked_at: null });
    expect(
      await queryAll(
        env.DB,
        "SELECT template_key FROM email_outbox WHERE recipient_user_id = ? ORDER BY created_at, id",
        targetUserId,
      ),
    ).toEqual([{ template_key: "organization-representation-changed" }]);

    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: "Representation Lifecycle Group",
      eligibilityMode: "open",
    });
    await joinGroup(env.DB, group.id, {
      actorUserId: targetUserId,
      targetUserId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });
    await assignRepresentativeRole(env.DB, memberId, targetUserId, REPRESENTATIVE_ROLE_IDS.secondaryContact);

    await blockOrganizationRepresentative(env.DB, actor, {
      memberId,
      userId: targetUserId,
      reason: "Removed by the organization contact",
    });
    const [blocked] = await queryAll<{ left_at: string | null; blocked_at: string | null }>(
      env.DB,
      "SELECT left_at, blocked_at FROM organization_representatives WHERE id = ?",
      representativeId,
    );
    expect(blocked.left_at).not.toBeNull();
    expect(blocked.blocked_at).not.toBeNull();
    expect(
      await queryAll(env.DB, "SELECT id FROM group_memberships WHERE user_id = ? AND left_at IS NULL", targetUserId),
    ).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_user_id = ?", targetUserId),
    ).toHaveLength(2);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM user_roles WHERE user_id = ? AND context_type = 'organization' AND context_id = ? AND revoked_at IS NULL",
        [targetUserId, memberId],
      ),
    ).toHaveLength(0);
    await expect(
      associateOrganizationRepresentative(env.DB, actor, {
        memberId,
        userId: targetUserId,
        showOnOrganizationProfile: true,
      }),
    ).rejects.toMatchObject({ code: "ORGANIZATION_REPRESENTATION_BLOCKED" });

    await restoreOrganizationRepresentative(env.DB, actor, {
      memberId,
      userId: targetUserId,
      reason: "Restored by the organization contact",
    });
    const [restored] = await queryAll<{ source: string; left_at: string | null; blocked_at: string | null }>(
      env.DB,
      "SELECT source, left_at, blocked_at FROM organization_representatives WHERE id = ?",
      representativeId,
    );
    expect(restored).toEqual({ source: "organization_contact", left_at: null, blocked_at: null });
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ? AND left_at IS NULL",
        [group.id, targetUserId],
      ),
    ).toHaveLength(0);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM group_memberships WHERE group_id = '20000000-0000-4000-8000-000000000001' AND user_id = ? AND left_at IS NULL",
        targetUserId,
      ),
    ).toHaveLength(1);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_user_id = ?", targetUserId),
    ).toHaveLength(3);
  });

  it("rejects management by an ordinary representative", async () => {
    const organizationId = await insertOrganization(env.DB, "Authorization Org");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const ordinaryUserId = await insertUser(env.DB, "ordinary@authorization.example");
    const targetUserId = await insertUser(env.DB, "target@authorization.example");
    await addRepresentative(env.DB, memberId, ordinaryUserId);

    await expect(
      associateOrganizationRepresentative(
        env.DB,
        { userId: ordinaryUserId, actorType: "member", staffAuthorized: false },
        { memberId, userId: targetUserId, showOnOrganizationProfile: false },
      ),
    ).rejects.toMatchObject({ code: "ORGANIZATION_CONTACT_REQUIRED" });
  });

  it("rolls back association when contact authority is revoked before the batch commits", async () => {
    const organizationId = await insertOrganization(env.DB, "Revoked Contact Org");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const contactUserId = await insertUser(env.DB, "contact@revoked-contact.example");
    await addRepresentative(env.DB, memberId, contactUserId);
    await assignRepresentativeRole(env.DB, memberId, contactUserId, REPRESENTATIVE_ROLE_IDS.primaryContact);
    const targetUserId = await insertUser(env.DB, "target@revoked-contact.example");
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare(
        `UPDATE user_roles
            SET revoked_at = datetime('now')
          WHERE user_id = ? AND context_type = 'organization' AND context_id = ?
            AND role_id = ? AND revoked_at IS NULL`,
      )
        .bind(contactUserId, memberId, REPRESENTATIVE_ROLE_IDS.primaryContact)
        .run(),
    );

    await expect(
      associateOrganizationRepresentative(
        racingDb,
        { userId: contactUserId, actorType: "member", staffAuthorized: false },
        { memberId, userId: targetUserId, showOnOrganizationProfile: false },
      ),
    ).rejects.toMatchObject({ status: 409, code: "ORGANIZATION_REPRESENTATION_MANAGEMENT_CHANGED" });

    expect(
      await queryAll(env.DB, "SELECT id FROM organization_representatives WHERE member_id = ? AND user_id = ?", [
        memberId,
        targetUserId,
      ]),
    ).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'organization_representative_associated'"),
    ).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_user_id = ?", targetUserId),
    ).toHaveLength(0);
  });

  it("rolls back representative removal when staff authority is revoked before commit", async () => {
    const admin = await insertAdmin("revoked-staff@example.test");
    const organizationId = await insertOrganization(env.DB, "Revoked Staff Org");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const targetUserId = await insertUser(env.DB, "target@revoked-staff.example");
    await addRepresentative(env.DB, memberId, targetUserId);
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE users SET role = 'user' WHERE id = ?").bind(admin.id).run(),
    );

    await expect(
      blockOrganizationRepresentative(
        racingDb,
        {
          userId: admin.id,
          databaseUserId: admin.id,
          actorType: "admin",
          staffAuthorized: true,
        },
        { memberId, userId: targetUserId, reason: "Authority changed" },
      ),
    ).rejects.toMatchObject({ status: 409, code: "ORGANIZATION_REPRESENTATION_MANAGEMENT_CHANGED" });

    const [representative] = await queryAll<{ left_at: string | null; blocked_at: string | null }>(
      env.DB,
      "SELECT left_at, blocked_at FROM organization_representatives WHERE member_id = ? AND user_id = ?",
      [memberId, targetUserId],
    );
    expect(representative).toEqual({ left_at: null, blocked_at: null });
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'organization_representative_blocked'"),
    ).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_user_id = ?", targetUserId),
    ).toHaveLength(0);
  });

  it("turns a concurrent same-organization association race into one durable relationship and a bounded conflict", async () => {
    const organizationId = await insertOrganization(env.DB, "Concurrent Representation Org");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const contactUserId = await insertUser(env.DB, "contact@concurrent-representation.example");
    await addRepresentative(env.DB, memberId, contactUserId);
    await assignRepresentativeRole(env.DB, memberId, contactUserId, REPRESENTATIVE_ROLE_IDS.primaryContact);
    const targetUserId = await insertUser(env.DB, "target@concurrent-representation.example");
    const actor = { userId: contactUserId, actorType: "member" as const, staffAuthorized: false };

    const attempts = await Promise.allSettled([
      associateOrganizationRepresentative(env.DB, actor, {
        memberId,
        userId: targetUserId,
        showOnOrganizationProfile: true,
      }),
      associateOrganizationRepresentative(env.DB, actor, {
        memberId,
        userId: targetUserId,
        showOnOrganizationProfile: true,
      }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const [rejected] = attempts.filter((attempt) => attempt.status === "rejected") as PromiseRejectedResult[];
    expect(rejected?.reason).toMatchObject({ status: 409, code: "ORGANIZATION_REPRESENTATION_CONFLICT" });
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM organization_representatives WHERE member_id = ? AND user_id = ? AND left_at IS NULL",
        [memberId, targetUserId],
      ),
    ).toHaveLength(1);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_user_id = ?", targetUserId),
    ).toHaveLength(1);
  });
});
