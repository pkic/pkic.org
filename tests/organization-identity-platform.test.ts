import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  assessIdentityDomain,
  listVerifiedIdentityDomainMatches,
  organizationIdentityManagementEvidence,
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
