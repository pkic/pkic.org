import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/reset-db";
import {
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
  assignRepresentativeRole,
  REPRESENTATIVE_ROLE_IDS,
} from "./helpers/membership";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { preparePrimaryEmailDomainChange } from "../functions/_lib/services/identities/primary-email-domain-change";
import { nowIso } from "../functions/_lib/utils/time";

beforeEach(resetDb);

describe("primary email domain changes", () => {
  it.each([
    {
      scenario: "approved-domain representation",
      alias: null,
      verified: false,
      next: "member@next.example",
      ends: true,
      legacy: true,
    },
    { scenario: "no supporting address", alias: null, verified: false, next: "member@next.example", ends: true },
    {
      scenario: "verified old-domain address",
      alias: "other@old.example",
      verified: true,
      next: "member@next.example",
      ends: false,
    },
    {
      scenario: "unverified old-domain address",
      alias: "other@old.example",
      verified: false,
      next: "member@next.example",
      ends: true,
    },
    {
      scenario: "verified unrelated address",
      alias: "other@unrelated.example",
      verified: true,
      next: "member@next.example",
      ends: true,
    },
    { scenario: "local-part correction", alias: null, verified: false, next: "corrected@old.example", ends: false },
    {
      scenario: "same organization on another claimed domain",
      alias: "other@subsidiary.example",
      verified: true,
      next: "member@next.example",
      ends: false,
    },
  ])("$scenario", async ({ alias, verified, next, ends, ...variant }) => {
    const previousEmail = "member@old.example";
    const userId = await insertUser(env.DB, previousEmail);
    const organizationId = await insertOrganization(env.DB, "Domain Fixture Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId);
    const at = nowIso();
    const identity = await buildCreateIdentityStatement(env.DB, {
      userId,
      organizationId,
      source: "legacy" in variant && variant.legacy ? "verified_domain" : "verified_email",
      verifiedEmailDomain: "legacy" in variant && variant.legacy ? null : "old.example",
      startImmediately: true,
      now: at,
    });
    await env.DB.batch([
      identity.statement,
      env.DB.prepare("UPDATE users SET email_verified_at=? WHERE id=?").bind(at, userId),
      env.DB.prepare(
        "INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,?,?,?,?)",
      ).bind(crypto.randomUUID(), "subsidiary.example", organizationId, at, at),
    ]);
    await assignRepresentativeRole(env.DB, memberId, userId, REPRESENTATIVE_ROLE_IDS.primaryContact);
    const aliasId = crypto.randomUUID();
    if (alias)
      await env.DB.prepare(
        "INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,created_at) VALUES (?,?,?,?,?,?)",
      )
        .bind(aliasId, userId, alias, alias, verified ? at : null, at)
        .run();
    const change = preparePrimaryEmailDomainChange(env.DB, { userId, previousEmail, nextEmail: next, at });
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET email=?,normalized_email=?,email_verified_at=? WHERE id=?").bind(
        next,
        next,
        at,
        userId,
      ),
      ...change,
    ]);
    const stored = await env.DB.prepare("SELECT ended_at,email_id FROM identities WHERE id=?")
      .bind(identity.identityId)
      .first<{ ended_at: string | null; email_id: string | null }>();
    expect(stored?.ended_at).toBe(ends ? at : null);
    const preservedByAlias = !ends && alias !== null && next !== "corrected@old.example";
    expect(stored?.email_id).toBe(preservedByAlias ? aliasId : null);
    if (preservedByAlias)
      expect(
        await env.DB.prepare("SELECT identity_id FROM user_emails WHERE id=?").bind(aliasId).first(),
      ).toMatchObject({ identity_id: identity.identityId });
    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM audit_log WHERE entity_id=? AND action='organization_identity_ended'",
    )
      .bind(identity.identityId)
      .first<{ total: number }>();
    expect(audit?.total).toBe(ends ? 1 : 0);
    const grant = await env.DB.prepare("SELECT revoked_at FROM user_roles WHERE identity_id=? AND role_id=?")
      .bind(identity.identityId, REPRESENTATIVE_ROLE_IDS.primaryContact)
      .first<{ revoked_at: string | null }>();
    expect(grant).not.toBeNull();
    if (ends) expect(grant?.revoked_at).toEqual(expect.any(String));
    else expect(grant?.revoked_at).toBeNull();
  });

  it("rolls back the email promotion and representation end together", async () => {
    const userId = await insertUser(env.DB, "member@old.example");
    const organizationId = await insertOrganization(env.DB, "Rollback Domain Fixture");
    const at = nowIso();
    const identity = await buildCreateIdentityStatement(env.DB, {
      userId,
      organizationId,
      source: "verified_email",
      verifiedEmailDomain: "old.example",
      startImmediately: true,
      now: at,
    });
    await env.DB.batch([identity.statement]);
    await expect(
      env.DB.batch([
        env.DB.prepare(
          "UPDATE users SET email='member@next.example',normalized_email='member@next.example',email_verified_at=? WHERE id=?",
        ).bind(at, userId),
        ...preparePrimaryEmailDomainChange(env.DB, {
          userId,
          previousEmail: "member@old.example",
          nextEmail: "member@next.example",
          at,
        }),
        env.DB.prepare(
          "INSERT INTO users(id,email,normalized_email,active,created_at,updated_at) SELECT id,email,normalized_email,active,created_at,updated_at FROM users WHERE id=?",
        ).bind(userId),
      ]),
    ).rejects.toThrow();
    expect(await env.DB.prepare("SELECT email FROM users WHERE id=?").bind(userId).first()).toMatchObject({
      email: "member@old.example",
    });
    expect(
      await env.DB.prepare("SELECT ended_at FROM identities WHERE id=?").bind(identity.identityId).first(),
    ).toMatchObject({ ended_at: null });
  });
});
