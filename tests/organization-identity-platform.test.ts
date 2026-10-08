import { grantAdministrator } from "./helpers/administrator";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  assessIdentityDomain,
  listVerifiedIdentityDomainMatches,
  organizationIdentityManagementEvidence,
  prepareExplicitVerifiedDomainIdentityStatements,
} from "../functions/_lib/services/identities";
import { queryAll } from "./helpers/context";
import {
  REPRESENTATIVE_ROLE_IDS,
  addRepresentative,
  assignRepresentativeRole,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { nowIso } from "../functions/_lib/utils/time";
import { resolveOwnedIdentityEmail } from "../functions/_lib/services/identities/owned-email";
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

async function secondaryWorkFixture() {
  const organizationId = await insertOrganization(env.DB, "Exact Work Mailbox");
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
  await claimDomain(organizationId, "exact-work.example");
  const userId = await insertUser(env.DB, "person@gmail.com");
  const emailId = crypto.randomUUID();
  const email = "person@exact-work.example";
  await env.DB.prepare(
    `INSERT INTO user_emails
       (id,user_id,email,normalized_email,verified_at,verification_method,created_at)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'magic_link', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(emailId, userId, email, email)
    .run();
  return { organizationId, memberId, userId, emailId, email };
}

beforeEach(resetDb);

describe("acting identity domain evidence", () => {
  it("requires an exact claimed custom domain and a verified user-owned address", async () => {
    const email = "alice@verified-company.example";
    const userId = await insertUser(env.DB, email);
    const organizationId = await insertOrganization(env.DB, "Verified Company");
    await seedOrganizationAggregate(env.DB, organizationId, "A");
    await claimDomain(organizationId, "verified-company.example");

    expect(await assessIdentityDomain(env.DB, userId, email)).toMatchObject({
      outcome: "unverified_email",
      mayCreateIdentity: false,
    });
    await env.DB.prepare(
      "UPDATE users SET email_verified_at = datetime('now'), email_verification_method = 'magic_link' WHERE id = ?",
    )
      .bind(userId)
      .run();
    expect(await assessIdentityDomain(env.DB, userId, email)).toMatchObject({
      outcome: "exact_claimed_match",
      mayCreateIdentity: true,
      organizationId,
    });
    expect(await listVerifiedIdentityDomainMatches(env.DB, userId)).toEqual([
      { email, domain: "verified-company.example", organizationId },
    ]);
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id = ?", [userId])).toEqual([]);
  });

  /*
   * An organization nobody speaks for any more.
   *
   * Representation is what member-facing routes resolve through, so an
   * organization whose last representative leaves is one the consortium can no
   * longer reach — and the way back in is the domain it already claimed. The
   * claim outlives the people who made it, which is the property worth
   * pinning: it is what lets a colleague arrive and rejoin the organization
   * that exists rather than create a second one beside it.
   */
  it("still recognizes a claimed domain after the last representative has gone", async () => {
    const email = "successor@abandoned-company.example";
    const organizationId = await insertOrganization(env.DB, "Abandoned Company");
    await seedOrganizationAggregate(env.DB, organizationId, "A");
    await claimDomain(organizationId, "abandoned-company.example");

    // Everyone who spoke for it has ended their affiliation.
    await env.DB.prepare("UPDATE identities SET ended_at = datetime('now') WHERE organization_id = ?")
      .bind(organizationId)
      .run();
    expect(
      await queryAll(env.DB, "SELECT id FROM identities WHERE organization_id = ? AND ended_at IS NULL", [
        organizationId,
      ]),
      "the organization is left with nobody speaking for it",
    ).toEqual([]);

    const userId = await insertUser(env.DB, email);
    await env.DB.prepare(
      "UPDATE users SET email_verified_at = datetime('now'), email_verification_method = 'magic_link' WHERE id = ?",
    )
      .bind(userId)
      .run();

    // The domain still resolves to the organization that claimed it, so the
    // newcomer joins it rather than founding a duplicate under the same name.
    expect(await assessIdentityDomain(env.DB, userId, email)).toMatchObject({
      outcome: "exact_claimed_match",
      mayCreateIdentity: true,
      organizationId,
    });
  });

  it.each(["person@gmail.com", "person@mailinator.com"])(
    "never treats %s as organization identity evidence",
    async (email) => {
      const userId = await insertUser(env.DB, email);
      await env.DB.prepare(
        "UPDATE users SET email_verified_at = datetime('now'), email_verification_method = 'magic_link' WHERE id = ?",
      )
        .bind(userId)
        .run();
      expect(await assessIdentityDomain(env.DB, userId, email)).toMatchObject({ mayCreateIdentity: false });
    },
  );

  it("uses one resolver for exact primary and verified secondary identity address selection", async () => {
    const f = await secondaryWorkFixture();
    const user = { id: f.userId, email: "person@gmail.com" };
    expect(await resolveOwnedIdentityEmail(env.DB, { user, email: " PERSON@GMAIL.COM " })).toEqual({
      emailId: null,
      normalizedEmail: "person@gmail.com",
    });
    expect(await resolveOwnedIdentityEmail(env.DB, { user, email: " PERSON@EXACT-WORK.EXAMPLE " })).toEqual({
      emailId: f.emailId,
      normalizedEmail: f.email,
    });
    const other = await insertUser(env.DB, "another@example.test");
    await expect(
      resolveOwnedIdentityEmail(env.DB, { user: { id: other, email: "another@example.test" }, email: f.email }),
    ).rejects.toMatchObject({ code: "IDENTITY_EMAIL_UNVERIFIED" });
  });

  it("keeps secondary work selection in organization identity creation by email without duplicating the person", async () => {
    const f = await secondaryWorkFixture();
    const adminId = await insertUser(env.DB, "email-selection-admin@example.test");
    await grantAdministrator(env.DB, adminId);
    const token = await createAdminSession(env.DB, adminId, crypto.randomUUID());
    const response = await callApi(env, `/api/v1/organizations/${f.organizationId}/identities`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        userReference: "email",
        email: f.email,
        name: "Do not overwrite the known person",
        activation: { mode: "invitation" },
        showOnOrganizationProfile: true,
      }),
    });
    expect(response.status, await response.clone().text()).toBe(201);
    expect(
      await queryAll(env.DB, "SELECT user_id,email_id FROM identities WHERE organization_id=?", [f.organizationId]),
    ).toEqual([{ user_id: f.userId, email_id: f.emailId }]);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email=?", [f.email])).toEqual([]);
  });

  it("refuses to overwrite an existing approved identity's different selected email", async () => {
    const f = await secondaryWorkFixture();
    const identityId = await addRepresentative(env.DB, f.memberId, f.userId);
    await expect(
      prepareExplicitVerifiedDomainIdentityStatements(env.DB, {
        userId: f.userId,
        organizationId: f.organizationId,
        normalizedEmail: f.email,
        at: nowIso(),
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_ALREADY_ACTIVE" });
    expect(await queryAll(env.DB, "SELECT id,email_id FROM identities WHERE user_id=?", [f.userId])).toEqual([
      { id: identityId, email_id: null },
    ]);
  });

  it.each([
    "alias_replaced",
    "alias_renamed",
    "alias_unverified",
    "alias_owner_changed",
    "claim_changed",
    "relationship_blocked",
    "user_disabled",
  ] as const)("rolls back prepared work identity enrollment when %s changes before commit", async (race) => {
    const f = await secondaryWorkFixture();
    const at = nowIso();
    const statements = await prepareExplicitVerifiedDomainIdentityStatements(env.DB, {
      userId: f.userId,
      organizationId: f.organizationId,
      normalizedEmail: f.email,
      at,
    });
    const originalName = await env.DB.prepare("SELECT first_name FROM users WHERE id=?")
      .bind(f.userId)
      .first("first_name");
    const originalAuditCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM audit_log").first("total");
    const otherUserId = await insertUser(env.DB, "new-alias-owner@example.test");
    const racedDb = mutateBeforeNextBatch(env.DB, async () => {
      if (race === "alias_replaced") {
        await env.DB.prepare("DELETE FROM user_emails WHERE id=?").bind(f.emailId).run();
        await env.DB.prepare(
          "INSERT INTO user_emails (id,user_id,email,normalized_email,verified_at,created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
          .bind(crypto.randomUUID(), f.userId, f.email, f.email, at, at)
          .run();
      } else if (race === "alias_renamed") {
        await env.DB.prepare(
          "UPDATE user_emails SET email='renamed@exact-work.example',normalized_email='renamed@exact-work.example' WHERE id=?",
        )
          .bind(f.emailId)
          .run();
      } else if (race === "alias_unverified") {
        await env.DB.prepare("UPDATE user_emails SET verified_at=NULL WHERE id=?").bind(f.emailId).run();
      } else if (race === "alias_owner_changed") {
        await env.DB.prepare("UPDATE user_emails SET user_id=? WHERE id=?").bind(otherUserId, f.emailId).run();
      } else if (race === "claim_changed") {
        await env.DB.prepare("DELETE FROM organization_domain_claims WHERE domain='exact-work.example'").run();
      } else if (race === "user_disabled") {
        await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(f.userId).run();
      } else {
        const blockedId = await addRepresentative(env.DB, f.memberId, f.userId);
        await env.DB.prepare(
          "UPDATE identities SET ended_at=started_at,blocked_at=started_at,blocked_by_user_id=? WHERE id=?",
        )
          .bind(f.userId, blockedId)
          .run();
      }
    });
    await expect(
      racedDb.batch([
        env.DB.prepare("UPDATE users SET first_name='Must roll back' WHERE id=?").bind(f.userId),
        ...statements,
      ]),
    ).rejects.toThrow();
    expect(await env.DB.prepare("SELECT first_name FROM users WHERE id=?").bind(f.userId).first("first_name")).toBe(
      originalName,
    );
    expect(
      await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=? AND ended_at IS NULL", [f.userId]),
    ).toEqual([]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM audit_log").first("total")).toBe(originalAuditCount);
    expect(await queryAll(env.DB, "SELECT id FROM group_memberships WHERE user_id=?", [f.userId])).toEqual([]);
  });

  it("refuses current-user work identity creation if the account is disabled while its session remains valid", async () => {
    const f = await secondaryWorkFixture();
    await grantAdministrator(env.DB, f.userId);
    const token = await createAdminSession(env.DB, f.userId, crypto.randomUUID());
    const session = await env.DB.prepare("SELECT id,expires_at,revoked_at FROM sessions WHERE user_id=?")
      .bind(f.userId)
      .first<{ id: string; expires_at: string; revoked_at: string | null }>();
    expect(session).toBeTruthy();
    const beforeAudits = await queryAll(env.DB, "SELECT * FROM audit_log ORDER BY id");
    const beforeGroups = await queryAll(env.DB, "SELECT * FROM group_memberships WHERE user_id=? ORDER BY id", [
      f.userId,
    ]);
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(f.userId).run(),
    );
    const response = await callApi({ ...env, DB: racedDb }, "/api/v1/users/current/identities", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ organizationId: f.organizationId, emailId: f.emailId }),
    });
    expect(response.status, await response.clone().text()).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "IDENTITY_CONFLICT" } });
    expect(await env.DB.prepare("SELECT active FROM users WHERE id=?").bind(f.userId).first("active")).toBe(0);
    expect(
      await env.DB.prepare("SELECT id,expires_at,revoked_at FROM sessions WHERE id=?").bind(session!.id).first(),
    ).toEqual(session);
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", [f.userId])).toEqual([]);
    expect(await queryAll(env.DB, "SELECT * FROM audit_log ORDER BY id")).toEqual(beforeAudits);
    expect(await queryAll(env.DB, "SELECT * FROM group_memberships WHERE user_id=? ORDER BY id", [f.userId])).toEqual(
      beforeGroups,
    );
  });

  it("binds organization-contact authority to the exact active identity used by the role", async () => {
    const organizationId = await insertOrganization(env.DB, "Identity Authority Org");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const userId = await insertUser(env.DB, "contact@identity-authority.example");
    const identityId = await addRepresentative(env.DB, memberId, userId);
    await assignRepresentativeRole(env.DB, memberId, userId, REPRESENTATIVE_ROLE_IDS.primaryContact);
    const evidence = organizationIdentityManagementEvidence({ memberId, actorUserId: userId, staffAuthorized: false });

    expect(
      await env.DB.prepare(`SELECT 1 AS authorized WHERE EXISTS (${evidence.sql})`)
        .bind(...evidence.bindings)
        .first(),
    ).toMatchObject({ authorized: 1 });
    await env.DB.prepare("UPDATE identities SET ended_at = started_at WHERE id = ?").bind(identityId).run();
    expect(
      await env.DB.prepare(`SELECT 1 AS authorized WHERE EXISTS (${evidence.sql})`)
        .bind(...evidence.bindings)
        .first(),
    ).toBeNull();
  });
});
