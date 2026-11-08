import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  organizationDomainClaimCreateSchema,
  organizationDomainClaimResponseSchema,
  organizationDomainsListResponseSchema,
} from "../assets/shared/schemas/organization-domains";
import { apiValidationErrorDetailsSchema } from "../assets/shared/schemas/api-common";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { seedMemberApplication } from "./helpers/member-applications";
import { insertOrganization, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import {
  prepareReleaseApplicationDomainClaim,
  prepareTransferApplicationDomainClaim,
} from "../functions/_lib/services/membership/organization-domain-claims";

async function claimDomain(organizationId: string, domain: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO organization_domain_claims (id, domain, organization_id, application_id, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?)`,
  )
    .bind(crypto.randomUUID(), domain, organizationId, nowIso(), nowIso())
    .run();
}

/** A person whose active identity at the organization came from a verified address on `email`'s domain. */
async function linkedPerson(organizationId: string, email: string): Promise<string> {
  const userId = await insertUser(env.DB, email);
  const at = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET email_verified_at = ?, email_verification_method = 'magic_link' WHERE id = ?",
    ).bind(at, userId),
    env.DB.prepare(
      `INSERT INTO identities (id, user_id, organization_id, verified_email_domain, source, invited_at, started_at,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, 'verified_email', ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), userId, organizationId, email.split("@")[1], at, at, at, at),
  ]);
  return userId;
}

describe("staff manage an organization's email domains", () => {
  it.each(["release", "approve"])(
    "preserves additional claims when a pending application is decided (%s)",
    async (decision) => {
      const applicationId = await seedMemberApplication({
        applicantEmail: "person@pending-shared.example",
        organizationDomain: "pending-shared.example",
      });
      const first = await insertOrganization(env.DB, "First Organization");
      const second = await insertOrganization(env.DB, "Second Organization");
      const claimId = await env.DB.prepare("SELECT id FROM organization_domain_claims WHERE application_id=?")
        .bind(applicationId)
        .first<string>("id");
      const at = nowIso();
      await env.DB.batch(
        [first, second].map((organizationId) =>
          env.DB.prepare(
            `INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,(SELECT domain FROM organization_domain_claims WHERE id=?),?,?,?)`,
          ).bind(crypto.randomUUID(), claimId, organizationId, at, at),
        ),
      );
      const statements =
        decision === "release"
          ? prepareReleaseApplicationDomainClaim(env.DB, applicationId)
          : await prepareTransferApplicationDomainClaim(env.DB, {
              domain: "pending-shared.example",
              applicationId,
              organizationId: first,
              now: at,
            });
      await env.DB.batch(statements);
      const rows = await queryAll<{ organization_id: string; application_id: string | null }>(
        env.DB,
        "SELECT organization_id,application_id FROM organization_domain_claims WHERE domain=? ORDER BY organization_id",
        ["pending-shared.example"],
      );
      expect(rows).toEqual(
        [first, second].sort().map((organization_id) => ({ organization_id, application_id: null })),
      );
    },
  );
  let token: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
    token = await createAdminSession(env.DB, admin!.id, "organization-domains-admin-token");
  });

  function call(path: string, init: { method?: string; body?: unknown; bearer?: string } = {}) {
    return callApi(env, path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        authorization: `Bearer ${init.bearer ?? token}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  }

  async function domainsOf(organizationId: string) {
    const response = await call(`/api/v1/organizations/${organizationId}/domains?sort=domain`);
    expect(response.status, await response.clone().text()).toBe(200);
    return organizationDomainsListResponseSchema.parse(await response.json()).domains;
  }

  it("lists claimed, derived and held domains with the people linked through each", async () => {
    const acme = await insertOrganization(env.DB, "Acme");
    await claimDomain(acme, "acme.example");
    await linkedPerson(acme, "ana@acme.example");
    await linkedPerson(acme, "bo@acme.example");
    await linkedPerson(acme, "cy@acme-labs.example");
    await linkedPerson(acme, "di@acme-pending.example");
    await seedMemberApplication({ applicantEmail: "applicant@acme-pending.example" });

    expect(await domainsOf(acme)).toEqual([
      { domain: "acme-labs.example", status: "derived", people: 1, claimedAt: null },
      { domain: "acme-pending.example", status: "held", people: 1, claimedAt: null },
      { domain: "acme.example", status: "claimed", people: 2, claimedAt: expect.any(String) },
    ]);
  });

  it("claims a domain with a reason and removes it again, auditing both with from and to", async () => {
    const acme = await insertOrganization(env.DB, "Acme");
    await linkedPerson(acme, "ana@acme.example");

    const added = await call(`/api/v1/organizations/${acme}/domains`, {
      body: organizationDomainClaimCreateSchema.parse({ domain: "@ACME.example", reason: "Their own web site" }),
    });
    expect(added.status, await added.clone().text()).toBe(201);
    expect(organizationDomainClaimResponseSchema.parse(await added.json()).domain).toMatchObject({
      domain: "acme.example",
      status: "claimed",
      people: 1,
    });

    const removed = await call(`/api/v1/organizations/${acme}/domains/acme.example`, { method: "DELETE" });
    expect(removed.status, await removed.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT domain FROM organization_domain_claims")).toEqual([]);
    expect(
      await queryAll(
        env.DB,
        `SELECT action, entity_id, json_extract(details_json, '$.domain.from') AS "from",
                json_extract(details_json, '$.domain.to') AS "to", json_extract(details_json, '$.reason.to') AS reason
           FROM audit_log WHERE action IN ('organization_domain_claimed', 'organization_domain_released') ORDER BY created_at, action`,
      ),
    ).toEqual([
      {
        action: "organization_domain_claimed",
        entity_id: acme,
        from: null,
        to: "acme.example",
        reason: "Their own web site",
      },
      { action: "organization_domain_released", entity_id: acme, from: "acme.example", to: null, reason: null },
    ]);
    // People already linked keep their relationship; the domain is now only derived.
    expect(await domainsOf(acme)).toEqual([{ domain: "acme.example", status: "derived", people: 1, claimedAt: null }]);
  });

  it("allows organizations to share a domain without automatically affiliating its verified users", async () => {
    const first = await insertOrganization(env.DB, "First Organization");
    const second = await insertOrganization(env.DB, "Second Organization");
    await claimDomain(first, "shared-work.example");
    const person = await insertUser(env.DB, "person@shared-work.example");
    await env.DB.prepare(
      "UPDATE users SET email_verified_at = ?, email_verification_method = 'magic_link' WHERE id = ?",
    )
      .bind(nowIso(), person)
      .run();

    const added = await call(`/api/v1/organizations/${second}/domains`, {
      body: { domain: "shared-work.example", reason: "Both organizations use this domain" },
    });
    expect(added.status, await added.clone().text()).toBe(201);
    expect((await domainsOf(first)).map((item) => item.domain)).toContain("shared-work.example");
    expect((await domainsOf(second)).map((item) => item.domain)).toContain("shared-work.example");
    expect(await queryAll(env.DB, "SELECT organization_id FROM identities WHERE user_id = ?", [person])).toEqual([]);
  });

  it.each(["first", "second"])("removes the %s shared claim without removing the other", async (removed) => {
    const first = await insertOrganization(env.DB, "First Organization");
    const second = await insertOrganization(env.DB, "Second Organization");
    await claimDomain(first, "shared-work.example");
    const added = await call(`/api/v1/organizations/${second}/domains`, {
      body: { domain: "shared-work.example", reason: "Both organizations use this domain" },
    });
    expect(added.status, await added.clone().text()).toBe(201);
    const removeId = removed === "first" ? first : second;
    const keepId = removed === "first" ? second : first;
    const response = await call(`/api/v1/organizations/${removeId}/domains/shared-work.example`, { method: "DELETE" });
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await domainsOf(removeId)).map((item) => item.domain)).not.toContain("shared-work.example");
    expect((await domainsOf(keepId)).map((item) => item.domain)).toContain("shared-work.example");
    expect(
      await queryAll(env.DB, "SELECT organization_id FROM organization_domain_claims WHERE domain=?", [
        "shared-work.example",
      ]),
    ).toEqual([{ organization_id: keepId }]);
  });

  it("enforces distinct claimants and allows a pending application to share its domain", async () => {
    const first = await insertOrganization(env.DB, "First Organization");
    const second = await insertOrganization(env.DB, "Second Organization");
    await claimDomain(first, "shared-work.example");
    await seedMemberApplication({ applicantEmail: "applicant@pending.example" });
    const roots = await queryAll<{ id: string; domain: string }>(
      env.DB,
      "SELECT id,domain FROM organization_domain_claims WHERE domain IN (?,?)",
      ["shared-work.example", "pending.example"],
    );
    const rootId = roots.find((item) => item.domain === "shared-work.example")!.id;
    const pendingId = roots.find((item) => item.domain === "pending.example")!.id;
    const insert = (root: string, organization: string) =>
      env.DB.prepare(
        `INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,(SELECT domain FROM organization_domain_claims WHERE id=?),?,?,?)`,
      )
        .bind(crypto.randomUUID(), root, organization, nowIso(), nowIso())
        .run();
    await expect(insert(rootId, first)).rejects.toThrow();
    await insert(pendingId, second);
    await insert(rootId, second);
    await expect(insert(rootId, second)).rejects.toThrow();
    await env.DB.prepare("DELETE FROM organization_domain_claims WHERE id=?").bind(rootId).run();
    expect(
      await queryAll(env.DB, "SELECT organization_id FROM organization_domain_claims WHERE domain=?", [
        "shared-work.example",
      ]),
    ).toEqual([{ organization_id: second }]);
  });

  it("refuses ineligible and duplicate claims while allowing a pending domain to be shared", async () => {
    const acme = await insertOrganization(env.DB, "Acme");
    await claimDomain(acme, "acme.example");
    await seedMemberApplication({ applicantEmail: "applicant@pending.example" });
    const claim = (domain: string) =>
      call(`/api/v1/organizations/${acme}/domains`, { body: { domain, reason: "Staff knowledge" } });

    // The browser does not hold the lists, so the refusal names the field it reads back.
    for (const domain of ["gmail.com", "ziggo.nl", "mailinator.com", "co.uk", "github.io"]) {
      const refused = await claim(domain);
      expect(refused.status, domain).toBe(422);
      const body = (await refused.json()) as { error: { code: string; details: unknown } };
      expect(body.error.code).toBe("ORGANIZATION_DOMAIN_INELIGIBLE");
      expect(apiValidationErrorDetailsSchema.parse(body.error.details).fieldErrors?.domain).toHaveLength(1);
    }

    const duplicate = await claim("acme.example");
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { error: { code: string } }).error.code).toBe(
      "ORGANIZATION_DOMAIN_ALREADY_CLAIMED",
    );

    const held = await claim("pending.example");
    expect(held.status, await held.clone().text()).toBe(201);
    expect(
      await queryAll(
        env.DB,
        "SELECT application_id IS NOT NULL AS held FROM organization_domain_claims WHERE domain=? AND application_id IS NOT NULL",
        ["pending.example"],
      ),
    ).toEqual([{ held: 1 }]);

    expect(await queryAll(env.DB, "SELECT action FROM audit_log WHERE action LIKE 'organization_domain_%'")).toEqual([
      { action: "organization_domain_claimed" },
    ]);
  });

  it("removes only a claim the organization holds and requires organization permissions", async () => {
    const acme = await insertOrganization(env.DB, "Acme");
    const other = await insertOrganization(env.DB, "Other");
    await claimDomain(other, "other.example");

    const foreign = await call(`/api/v1/organizations/${acme}/domains/other.example`, { method: "DELETE" });
    expect(foreign.status).toBe(404);

    const memberId = await insertUser(env.DB, "plain@person.example");
    const memberToken = await createMemberSession(env.DB, memberId, "organization-domains-plain-token");
    const forbidden = await call(`/api/v1/organizations/${other}/domains`, { bearer: memberToken });
    expect([401, 403]).toContain(forbidden.status);
    expect(await queryAll(env.DB, "SELECT domain FROM organization_domain_claims")).toEqual([
      { domain: "other.example" },
    ]);
  });
});
