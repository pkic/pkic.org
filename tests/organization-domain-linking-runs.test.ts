/**
 * Claiming a domain reaches the people who verified an address on it
 * earlier, through the same rule as a fresh verification: staff see how many
 * before confirming, a non-member organization joins them as a system
 * decision, a member organization is only offered, and a large domain is
 * finished by the scheduler in bounded, resumable passes.
 */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { affiliationOfferResponseSchema } from "../assets/shared/schemas/affiliation-offer";
import {
  organizationDomainClaimCreateSchema,
  organizationDomainClaimPreviewResponseSchema,
  organizationDomainClaimResponseSchema,
} from "../assets/shared/schemas/organization-domains";
import {
  advanceDomainLinkRun,
  runDomainLinking,
} from "../functions/_lib/services/organization-management/domain-link-runs";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

/** A person with a verified primary address and the individual identity every account starts with. */
async function person(email: string, verified = true): Promise<string> {
  const userId = await insertUser(env.DB, email);
  const at = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET email_verified_at = ?, email_verification_method = 'magic_link' WHERE id = ?",
    ).bind(verified ? at : null, verified ? userId : "none"),
    env.DB.prepare(
      `INSERT INTO identities (id, user_id, organization_id, source, show_on_organization_profile, invited_at,
         started_at, created_at, updated_at)
       VALUES (?, ?, NULL, 'account', 0, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), userId, at, at, at, at),
  ]);
  return userId;
}

async function verifiedAlias(userId: string, email: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, verification_method, created_at)
     VALUES (?, ?, ?, ?, ?, 'magic_link', ?)`,
  )
    .bind(crypto.randomUUID(), userId, email, email, nowIso(), nowIso())
    .run();
}

function organizationsOf(userId: string) {
  return queryAll<{ organization_id: string }>(
    env.DB,
    "SELECT organization_id FROM identities WHERE user_id = ? AND organization_id IS NOT NULL AND ended_at IS NULL",
    [userId],
  );
}

describe("a domain claim links the people who verified an address on it", () => {
  let token: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
    adminId = admin!.id;
    token = await createAdminSession(env.DB, adminId, "domain-linking-admin-token");
  });

  function call(path: string, body?: unknown, bearer = token) {
    return callApi(env, path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it("says how many people a claim reaches, then joins them as a system decision", async () => {
    const acme = await insertOrganization(env.DB, "Acme");
    const ana = await person("ana@acme.example");
    const bo = await person("bo@gmail.com");
    await verifiedAlias(bo, "bo@acme.example");
    const unverified = await person("cy@acme.example", false);
    const dismissed = await person("di@acme.example");
    await env.DB.prepare(
      "INSERT INTO affiliation_offer_dismissals (id, user_id, organization_id, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), dismissed, acme, nowIso())
      .run();

    const preview = await call(`/api/v1/organizations/${acme}/domains/acme.example`);
    expect(preview.status, await preview.clone().text()).toBe(200);
    expect(organizationDomainClaimPreviewResponseSchema.parse(await preview.json()).preview).toEqual({
      domain: "acme.example",
      peopleToLink: 2,
    });

    const claimed = await call(
      `/api/v1/organizations/${acme}/domains`,
      organizationDomainClaimCreateSchema.parse({ domain: "acme.example", reason: "Their web site" }),
    );
    expect(claimed.status, await claimed.clone().text()).toBe(201);
    expect(organizationDomainClaimResponseSchema.parse(await claimed.json())).toMatchObject({
      domain: { domain: "acme.example", status: "claimed", people: 2 },
      linking: { peopleLinked: 2, continuing: false },
    });
    expect(await organizationsOf(ana)).toEqual([{ organization_id: acme }]);
    expect(await organizationsOf(bo)).toEqual([{ organization_id: acme }]);
    expect(await organizationsOf(unverified)).toEqual([]);
    expect(await organizationsOf(dismissed)).toEqual([]);
    expect(
      await queryAll(
        env.DB,
        `SELECT actor_type, action FROM audit_log
          WHERE action IN ('organization_domain_person_linked', 'organization_domain_linking_completed')
          ORDER BY action`,
      ),
    ).toEqual([
      { actor_type: "system", action: "organization_domain_linking_completed" },
      { actor_type: "system", action: "organization_domain_person_linked" },
      { actor_type: "system", action: "organization_domain_person_linked" },
    ]);
  });

  it("reaches addresses on the domain's subdomains, except below a more specific claim", async () => {
    const group = await insertOrganization(env.DB, "Example Group");
    const research = await insertOrganization(env.DB, "Example Research");
    await env.DB.prepare(
      `INSERT INTO organization_domain_claims (id, domain, organization_id, application_id, created_at, updated_at)
       VALUES (?, 'research.example.co.uk', ?, NULL, ?, ?)`,
    )
      .bind(crypto.randomUUID(), research, nowIso(), nowIso())
      .run();
    const mail = await person("ana@mail.example.co.uk");
    const lab = await person("bo@lab.research.example.co.uk");

    const preview = await call(`/api/v1/organizations/${group}/domains/example.co.uk`);
    expect(organizationDomainClaimPreviewResponseSchema.parse(await preview.json()).preview.peopleToLink).toBe(1);
    const claimed = await call(`/api/v1/organizations/${group}/domains`, {
      domain: "example.co.uk",
      reason: "Their web site",
    });
    expect(claimed.status, await claimed.clone().text()).toBe(201);
    expect(organizationDomainClaimResponseSchema.parse(await claimed.json()).linking.peopleLinked).toBe(1);
    expect(await organizationsOf(mail)).toEqual([{ organization_id: group }]);
    expect(await organizationsOf(lab)).toEqual([]);
  });

  it("automatically affiliates verified people when a member organization claims its domain", async () => {
    const member = await insertOrganization(env.DB, "Member Co");
    await seedOrganizationAggregate(env.DB, member);
    const eva = await person("eva@member.example");

    const preview = await call(`/api/v1/organizations/${member}/domains/member.example`);
    expect(organizationDomainClaimPreviewResponseSchema.parse(await preview.json()).preview).toMatchObject({
      peopleToLink: 1,
    });
    const claimed = await call(`/api/v1/organizations/${member}/domains`, {
      domain: "member.example",
      reason: "Membership application",
    });
    expect(organizationDomainClaimResponseSchema.parse(await claimed.json()).linking.peopleLinked).toBe(1);
    expect(await organizationsOf(eva)).toEqual([{ organization_id: member }]);

    const evaToken = await createMemberSession(env.DB, eva, "domain-linking-eva-token", undefined, null);
    const offer = await call("/api/v1/users/current/identities/offer", undefined, evaToken);
    expect(affiliationOfferResponseSchema.parse(await offer.json()).offer).toMatchObject({
      kind: "linked",
      organization: { id: member },
    });
  });

  it("finishes a large domain in bounded passes that resume from the cursor, and ends when the claim goes", async () => {
    const acme = await insertOrganization(env.DB, "Acme");
    const people = [await person("a1@big.example"), await person("a2@big.example"), await person("a3@big.example")];
    const at = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO organization_domain_claims (id, domain, organization_id, application_id, created_at, updated_at)
         VALUES (?, 'big.example', ?, NULL, ?, ?)`,
      ).bind(crypto.randomUUID(), acme, at, at),
      env.DB.prepare(
        `INSERT INTO organization_domain_link_runs (id, organization_id, domain, requested_by_user_id, created_at,
           updated_at) VALUES ('run-big', ?, 'big.example', ?, ?, ?)`,
      ).bind(acme, adminId, at, at),
      env.DB.prepare(
        `INSERT INTO organization_domain_link_runs (id, organization_id, domain, requested_by_user_id, created_at,
           updated_at) VALUES ('run-released', ?, 'released.example', ?, ?, ?)`,
      ).bind(acme, adminId, at, at),
    ]);

    expect(await advanceDomainLinkRun(env.DB, "run-big", 2)).toEqual({ complete: false, examined: 2, linked: 2 });
    const summary = await runDomainLinking(env.DB);
    expect(summary).toMatchObject({ runs: 2, examined: 1, linked: 1, remaining: false });
    for (const userId of people) expect(await organizationsOf(userId)).toEqual([{ organization_id: acme }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id, examined, linked, completed_at IS NOT NULL AS done FROM organization_domain_link_runs ORDER BY id",
      ),
    ).toEqual([
      { id: "run-big", examined: 3, linked: 3, done: 1 },
      { id: "run-released", examined: 0, linked: 0, done: 1 },
    ]);
  });
});
