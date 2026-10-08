import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  prepareVerifiedOrganizationAffiliation,
  resolveVerifiedEmailDomainOrganization,
} from "../functions/_lib/services/identities";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { nowIso } from "../functions/_lib/utils/time";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { seedMemberApplication } from "./helpers/member-applications";
import { resetDb } from "./helpers/reset-db";

const domain = "dedupe-work.example";
async function verifiedPerson(local: string) {
  const email = `${local}@${domain}`;
  const userId = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET email_verified_at=?,email_verification_method='magic_link' WHERE id=?")
    .bind(nowIso(), userId)
    .run();
  await createAdminSession(env.DB, userId, crypto.randomUUID());
  const sessionId = await env.DB.prepare("SELECT id FROM sessions WHERE user_id=?").bind(userId).first<string>("id");
  return { userId, email, sessionId: sessionId! };
}
async function prepare(
  person: Awaited<ReturnType<typeof verifiedPerson>>,
  organizationName: string,
  organizationId?: string,
) {
  return prepareVerifiedOrganizationAffiliation(env.DB, {
    userId: person.userId,
    normalizedEmail: person.email,
    emailId: null,
    organizationName,
    organizationId,
    at: nowIso(),
    proofEvidence: {
      sql: "SELECT 1 FROM sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
      bindings: [person.sessionId, person.userId],
    },
  });
}
async function establish(local = "original", name = "Canonical Employer") {
  const person = await verifiedPerson(local);
  const prepared = await prepare(person, name);
  await env.DB.batch(prepared.statements);
  return { person, prepared };
}
async function claim(organizationId: string) {
  await env.DB.prepare(
    "INSERT INTO organization_domain_claims(id,domain,organization_id,application_id,created_at,updated_at) VALUES (?,?,?,NULL,?,?)",
  )
    .bind(crypto.randomUUID(), domain, organizationId, nowIso(), nowIso())
    .run();
}

beforeEach(resetDb);
describe("Immutable verified-email organization resolution", () => {
  it("links another proved person to one canonical organization despite a different submitted name", async () => {
    const original = await establish();
    const person = await verifiedPerson("colleague");
    expect(await resolveVerifiedEmailDomainOrganization(env.DB, person.email)).toEqual({
      id: original.prepared.organizationId,
      name: "Canonical Employer",
    });
    const prepared = await prepare(person, "New spelling must not create another organization");
    expect(prepared.organizationId).toBe(original.prepared.organizationId);
    expect(prepared.memberId).toBeNull();
    expect(prepared.snapshot.organizationName).toBe("Canonical Employer");
    await env.DB.batch(prepared.statements);
    expect(await queryAll(env.DB, "SELECT id,name FROM organizations")).toEqual([
      { id: original.prepared.organizationId, name: "Canonical Employer" },
    ]);
    expect(
      await queryAll(env.DB, "SELECT source,verified_email_domain,organization_id FROM identities WHERE id=?", [
        prepared.identityId,
      ]),
    ).toEqual([
      { source: "verified_email", verified_email_domain: domain, organization_id: original.prepared.organizationId },
    ]);
    expect(await queryAll(env.DB, "SELECT id FROM organization_domain_claims")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM members")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM member_applications")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM permission_grants WHERE user_id=?", [person.userId])).toEqual([]);
  });

  it("retains original domain proof across primary-address changes and requires review after its last active period ends", async () => {
    const original = await establish();
    await env.DB.prepare(
      "UPDATE users SET email='changed@different-work.example',normalized_email='changed@different-work.example' WHERE id=?",
    )
      .bind(original.person.userId)
      .run();
    const colleague = await verifiedPerson("after-address-change");
    const linked = await prepare(colleague, "Different spelling");
    expect(linked.organizationId).toBe(original.prepared.organizationId);
    await env.DB.batch(linked.statements);
    expect(
      await queryAll(env.DB, "SELECT verified_email_domain FROM identities WHERE id=?", [original.prepared.identityId]),
    ).toEqual([{ verified_email_domain: domain }]);
    await env.DB.prepare("UPDATE identities SET ended_at=? WHERE organization_id=?")
      .bind(nowIso(), original.prepared.organizationId)
      .run();
    await expect(prepare(await verifiedPerson("after-history"), "A new employer spelling")).rejects.toMatchObject({
      code: "ORGANIZATION_AFFILIATION_REVIEW_REQUIRED",
    });
    expect(await queryAll(env.DB, "SELECT id FROM organizations")).toHaveLength(1);
    await expect(
      env.DB.prepare("UPDATE identities SET verified_email_domain='changed.example' WHERE id=?")
        .bind(original.prepared.identityId)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare("UPDATE identities SET organization_id=? WHERE id=?")
        .bind(await insertOrganization(env.DB, "Unrelated Employer"), original.prepared.identityId)
        .run(),
    ).rejects.toThrow();
  });

  it("reuses an explicit owned affiliation unchanged while new links require pending-claim review", async () => {
    const original = await establish();
    await seedOrganizationAggregate(env.DB, original.prepared.organizationId, "A");
    await seedMemberApplication({ applicantEmail: `pending@${domain}`, organizationDomain: domain });
    const before = await queryAll(
      env.DB,
      "SELECT id,source,email_id,verified_email_domain,job_title FROM identities WHERE id=?",
      [original.prepared.identityId],
    );
    const prepared = await prepare(original.person, "Do not rename", original.prepared.organizationId);
    expect(prepared.identityId).toBe(original.prepared.identityId);
    expect(prepared.snapshot.organizationName).toBe("Canonical Employer");
    await env.DB.batch(prepared.statements);
    expect(
      await queryAll(env.DB, "SELECT id,source,email_id,verified_email_domain,job_title FROM identities WHERE id=?", [
        original.prepared.identityId,
      ]),
    ).toEqual(before);
    await expect(prepare(await verifiedPerson("new-pending"), "Different Name")).rejects.toMatchObject({
      code: "ORGANIZATION_DOMAIN_IN_USE",
    });
  });

  it.each(["ambiguous", "blocked", "member", "unknown"] as const)(
    "refuses %s evidence without creating a fresh organization",
    async (state) => {
      const original = await establish();
      if (state === "ambiguous") {
        const conflictingOrg = await insertOrganization(env.DB, "Reviewed Fixture With Conflicting Domain");
        const person = await verifiedPerson("conflicting");
        const identity = await buildCreateIdentityStatement(env.DB, {
          userId: person.userId,
          organizationId: conflictingOrg,
          source: "verified_email",
          verifiedEmailDomain: domain,
          startImmediately: true,
        });
        await env.DB.batch([identity.statement]);
      } else if (state === "blocked") {
        await env.DB.prepare("UPDATE identities SET ended_at=?,blocked_at=?,blocked_by_user_id=? WHERE id=?")
          .bind(nowIso(), nowIso(), original.person.userId, original.prepared.identityId)
          .run();
      } else if (state === "member") {
        await seedOrganizationAggregate(env.DB, original.prepared.organizationId, "A");
      } else {
        // A prior unknown source cannot be inferred or rewritten from its selected current mailbox.
        const older = await verifiedPerson("older-unknown");
        const identity = await buildCreateIdentityStatement(env.DB, {
          userId: older.userId,
          organizationId: original.prepared.organizationId,
          source: "verified_email",
          startImmediately: true,
        });
        await env.DB.batch([identity.statement]);
        await expect(
          env.DB.prepare("UPDATE identities SET verified_email_domain=? WHERE id=?")
            .bind(domain, identity.identityId)
            .run(),
        ).rejects.toThrow();
      }
      const before = await queryAll(env.DB, "SELECT id FROM organizations ORDER BY id");
      await expect(
        prepare(await verifiedPerson(`new-${state}`), "A different submitted spelling"),
      ).rejects.toMatchObject({ code: "ORGANIZATION_AFFILIATION_REVIEW_REQUIRED" });
      expect(await queryAll(env.DB, "SELECT id FROM organizations ORDER BY id")).toEqual(before);
    },
  );

  it("keeps pending and conflicting claims under review but lets an exact same-organization claim carry member authority", async () => {
    const original = await establish();
    await seedMemberApplication({ applicantEmail: `pending@${domain}`, organizationDomain: domain });
    await expect(prepare(await verifiedPerson("while-pending"), "Different Name")).rejects.toMatchObject({
      code: "ORGANIZATION_DOMAIN_IN_USE",
    });
    await env.DB.prepare("DELETE FROM organization_domain_claims WHERE domain=?").bind(domain).run();
    const otherOrg = await insertOrganization(env.DB, "Conflicting Claimed Employer");
    await claim(otherOrg);
    await expect(prepare(await verifiedPerson("conflicting-claim"), "Different Name")).rejects.toMatchObject({
      code: "ORGANIZATION_AFFILIATION_REVIEW_REQUIRED",
    });
    await env.DB.prepare("DELETE FROM organization_domain_claims WHERE domain=?").bind(domain).run();
    await claim(original.prepared.organizationId);
    const memberId = await seedOrganizationAggregate(env.DB, original.prepared.organizationId, "A");
    const prepared = await prepare(await verifiedPerson("claimed-colleague"), "Ignore this name");
    expect(prepared.organizationId).toBe(original.prepared.organizationId);
    expect(prepared.memberId).toBe(memberId);
    await env.DB.batch(prepared.statements);
    expect(
      await queryAll(env.DB, "SELECT source,verified_email_domain FROM identities WHERE id=?", [prepared.identityId]),
    ).toEqual([{ source: "verified_domain", verified_email_domain: null }]);
  });

  it("rolls back a concurrent same-domain different-name creation, then retries by linking the winner", async () => {
    const firstPerson = await verifiedPerson("first");
    const secondPerson = await verifiedPerson("second");
    const first = await prepare(firstPerson, "First Canonical Name");
    const second = await prepare(secondPerson, "Different Candidate Name");
    expect(first.organizationId).not.toBe(second.organizationId);
    await env.DB.batch(first.statements);
    const beforeAudit = await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id");
    const beforeName = await queryAll(env.DB, "SELECT first_name FROM users WHERE id=?", [secondPerson.userId]);
    await expect(
      env.DB.batch([
        env.DB.prepare("UPDATE users SET first_name='Must roll back' WHERE id=?").bind(secondPerson.userId),
        ...second.statements,
      ]),
    ).rejects.toThrow();
    expect(await queryAll(env.DB, "SELECT first_name FROM users WHERE id=?", [secondPerson.userId])).toEqual(
      beforeName,
    );
    expect(await queryAll(env.DB, "SELECT id FROM organizations")).toEqual([{ id: first.organizationId }]);
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", [secondPerson.userId])).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id")).toEqual(beforeAudit);
    const retry = await prepare(secondPerson, "Still a different submitted spelling");
    expect(retry.organizationId).toBe(first.organizationId);
    await env.DB.batch(retry.statements);
    expect(await queryAll(env.DB, "SELECT id FROM organizations")).toHaveLength(1);
  });

  it.each(["ended", "membership", "claim", "name", "claimed_conflict"] as const)(
    "rolls back prepared reuse when %s changes before the final batch",
    async (race) => {
      const original = await establish();
      if (race === "claimed_conflict") await claim(original.prepared.organizationId);
      const person = await verifiedPerson(`reuse-${race}`);
      const prepared = await prepare(person, "Ignored submitted name");
      const beforeAudit = await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id");
      const beforeName = await queryAll(env.DB, "SELECT first_name FROM users WHERE id=?", [person.userId]);
      const raced = mutateBeforeNextBatch(env.DB, async () => {
        if (race === "ended")
          await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?")
            .bind(nowIso(), original.prepared.identityId)
            .run();
        else if (race === "membership") await seedOrganizationAggregate(env.DB, original.prepared.organizationId, "A");
        else if (race === "claim") await claim(original.prepared.organizationId);
        else if (race === "claimed_conflict") {
          const conflictingOrg = await insertOrganization(env.DB, "Concurrent Domain Conflict");
          const owner = await verifiedPerson("concurrent-conflict");
          const identity = await buildCreateIdentityStatement(env.DB, {
            userId: owner.userId,
            organizationId: conflictingOrg,
            source: "verified_email",
            verifiedEmailDomain: domain,
            startImmediately: true,
          });
          await env.DB.batch([identity.statement]);
        } else
          await env.DB.prepare("UPDATE organizations SET name='Concurrent canonical rename' WHERE id=?")
            .bind(original.prepared.organizationId)
            .run();
      });
      await expect(
        raced.batch([
          env.DB.prepare("UPDATE users SET first_name='Must roll back' WHERE id=?").bind(person.userId),
          ...prepared.statements,
        ]),
      ).rejects.toThrow();
      expect(await queryAll(env.DB, "SELECT first_name FROM users WHERE id=?", [person.userId])).toEqual(beforeName);
      expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", [person.userId])).toEqual([]);
      expect(await queryAll(env.DB, "SELECT id FROM organizations")).toHaveLength(race === "claimed_conflict" ? 2 : 1);
      expect(await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id")).toEqual(beforeAudit);
    },
  );
});
