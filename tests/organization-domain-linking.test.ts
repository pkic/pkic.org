import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  affiliationOfferDismissalSchema,
  affiliationOfferResponseSchema,
} from "../assets/shared/schemas/affiliation-offer";
import { linkVerifiedAddressToDomainOrganization } from "../functions/_lib/services/identities/email-domain-link";
import { getUserDetail } from "../functions/_lib/services/user-management-detail";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

let tokenCounter = 0;

/** A signed-in person with a verified primary address and the individual identity every account starts with. */
async function signedIn(email: string): Promise<{ userId: string; token: string }> {
  const userId = await insertUser(env.DB, email);
  const at = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET email_verified_at = ?, email_verification_method = 'magic_link' WHERE id = ?",
    ).bind(at, userId),
    env.DB.prepare(
      `INSERT INTO identities (id, user_id, organization_id, source, show_on_organization_profile, invited_at,
         started_at, created_at, updated_at)
       VALUES (?, ?, NULL, 'account', 0, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), userId, at, at, at, at),
  ]);
  tokenCounter += 1;
  return { userId, token: await createMemberSession(env.DB, userId, `domain-link-token-${tokenCounter}`) };
}

async function claimDomain(organizationId: string, domain: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO organization_domain_claims (id, domain, organization_id, application_id, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?)`,
  )
    .bind(crypto.randomUUID(), domain, organizationId, nowIso(), nowIso())
    .run();
}

async function openReview(userId: string, organizationName: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO affiliation_reviews (id, user_id, organization_name, normalized_name, group_key, source_type, source_id,
       created_at)
     VALUES (?, ?, ?, lower(?), lower(?), 'user_profile', ?, ?)`,
  )
    .bind(crypto.randomUUID(), userId, organizationName, organizationName, organizationName, userId, nowIso())
    .run();
}

function call(token: string, path: string, body?: unknown): Promise<Response> {
  return callApi(env, path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function offerOf(token: string) {
  const response = await call(token, "/api/v1/users/current/identities/offer");
  expect(response.status).toBe(200);
  return affiliationOfferResponseSchema.parse(await response.json()).offer;
}

function organizationsOf(userId: string) {
  return queryAll(
    env.DB,
    `SELECT organization.name, identity.source, identity.verified_email_domain FROM identities identity
       JOIN organizations organization ON organization.id = identity.organization_id
      WHERE identity.user_id = ? AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL
      ORDER BY organization.name`,
    [userId],
  );
}

describe("a verified work address and the organization that owns its domain", () => {
  beforeEach(resetDb);

  it("joins a non-member organization automatically, once, and closes the person's own review", async () => {
    const organizationId = await insertOrganization(env.DB, "Open Claimed Co");
    await claimDomain(organizationId, "open-claimed.example");
    const { userId, token } = await signedIn("ana@open-claimed.example");
    await openReview(userId, "Open Claimed Co");

    expect(
      await linkVerifiedAddressToDomainOrganization(env.DB, { userId, normalizedEmail: "ana@open-claimed.example" }),
    ).toMatchObject({ organizationId });
    expect(
      await linkVerifiedAddressToDomainOrganization(env.DB, { userId, normalizedEmail: "ana@open-claimed.example" }),
    ).toBeNull();

    expect(await organizationsOf(userId)).toEqual([
      { name: "Open Claimed Co", source: "verified_domain", verified_email_domain: null },
    ]);
    expect(
      await queryAll(env.DB, "SELECT resolved_by_user_id FROM affiliation_reviews WHERE user_id = ?", [userId]),
    ).toEqual([{ resolved_by_user_id: userId }]);
    expect(
      await queryAll(env.DB, "SELECT actor_type FROM audit_log WHERE action = 'organization_identity_activated'"),
    ).toEqual([{ actor_type: "user" }]);
    // Nothing is left to ask except telling them about the link once.
    expect(await offerOf(token)).toMatchObject({ kind: "linked", organization: { id: organizationId } });
  });

  it("resolves matching registration and proposal reviews without erasing another employer", async () => {
    const organizationId = await insertOrganization(env.DB, "IBM");
    await claimDomain(organizationId, "ibm.example");
    const { userId } = await signedIn("history@ibm.example");
    for (const source of ["user_profile", "registration", "proposal_speaker"]) {
      const id = crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO affiliation_reviews(id,user_id,organization_name,normalized_name,group_key,source_type,source_id,created_at)
        VALUES (?,?,'IBM','ibm','ibm',?,?,?)`)
        .bind(id, userId, source, id, nowIso())
        .run();
    }
    await openReview(userId, "Past Employer");
    await env.DB.prepare("UPDATE affiliation_reviews SET email_domain = 'ibm.example' WHERE user_id = ?")
      .bind(userId)
      .run();
    await env.DB.prepare(
      "UPDATE affiliation_reviews SET normalized_name = NULL WHERE user_id = ? AND organization_name = 'IBM' AND source_type = 'user_profile'",
    )
      .bind(userId)
      .run();
    await linkVerifiedAddressToDomainOrganization(env.DB, { userId, normalizedEmail: "history@ibm.example" });
    expect(
      await queryAll(
        env.DB,
        "SELECT source_type FROM affiliation_reviews WHERE user_id = ? AND resolved_identity_id IS NOT NULL ORDER BY source_type",
        [userId],
      ),
    ).toEqual([{ source_type: "proposal_speaker" }, { source_type: "registration" }, { source_type: "user_profile" }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT organization_name FROM affiliation_reviews WHERE user_id = ? AND resolved_at IS NULL",
        [userId],
      ),
    ).toEqual([{ organization_name: "Past Employer" }]);
  });

  it("joins through the registrable domain from a subdomain address, and through an explicitly claimed subdomain", async () => {
    const parent = await insertOrganization(env.DB, "Example Group");
    const research = await insertOrganization(env.DB, "Example Research");
    await claimDomain(parent, "example.co.uk");
    await claimDomain(research, "research.example.co.uk");
    const mail = await signedIn("ana@mail.example.co.uk");
    const lab = await signedIn("ben@lab.research.example.co.uk");

    expect(
      await linkVerifiedAddressToDomainOrganization(env.DB, {
        userId: mail.userId,
        normalizedEmail: "ana@mail.example.co.uk",
      }),
    ).toMatchObject({ organizationId: parent });
    // The more specific claim wins for the addresses below it.
    expect(
      await linkVerifiedAddressToDomainOrganization(env.DB, {
        userId: lab.userId,
        normalizedEmail: "ben@lab.research.example.co.uk",
      }),
    ).toMatchObject({ organizationId: research });
    expect(await organizationsOf(lab.userId)).toEqual([
      { name: "Example Research", source: "verified_domain", verified_email_domain: null },
    ]);
  });

  it("names the claimed domain of a subdomain address whose domain is longer than D1's pattern budget", async () => {
    // Fifty-one characters: past the 50-byte LIKE/GLOB pattern limit D1 enforces.
    const domain = "a-long-organization-name-for-the-pattern-budget.test";
    const organizationId = await insertOrganization(env.DB, "Long Domain Co");
    await claimDomain(organizationId, domain);
    const { userId } = await signedIn(`ana@mail.${domain}`);
    await linkVerifiedAddressToDomainOrganization(env.DB, { userId, normalizedEmail: `ana@mail.${domain}` });

    const detail = await getUserDetail(env.DB, userId);
    expect(detail.identities.find((identity) => identity.organizationId === organizationId)).toMatchObject({
      organizationEmailDomain: domain,
    });
  });

  it("keeps an ISP mailbox independent even when its domain was claimed", async () => {
    const organizationId = await insertOrganization(env.DB, "Ziggo Customers");
    await claimDomain(organizationId, "ziggo.nl");
    const { userId } = await signedIn("gus@ziggo.nl");
    expect(
      await linkVerifiedAddressToDomainOrganization(env.DB, { userId, normalizedEmail: "gus@ziggo.nl" }),
    ).toBeNull();
    expect(await organizationsOf(userId)).toEqual([]);
  });

  it("automatically affiliates a verified member-organization address", async () => {
    const organizationId = await insertOrganization(env.DB, "Member Claimed Corp");
    await seedOrganizationAggregate(env.DB, organizationId, "A");
    await claimDomain(organizationId, "member.example");
    const { userId, token } = await signedIn("cy@member.example");
    await openReview(userId, "Member Claimed Corp");
    expect(
      await linkVerifiedAddressToDomainOrganization(env.DB, { userId, normalizedEmail: "cy@member.example" }),
    ).toMatchObject({ organizationId });
    expect(await organizationsOf(userId)).toEqual([
      { name: "Member Claimed Corp", source: "verified_domain", verified_email_domain: null },
    ]);
    expect(await offerOf(token)).toMatchObject({ kind: "linked", organization: { id: organizationId } });
  });

  it("never offers or joins an organization the person said is not theirs", async () => {
    const memberId = await insertOrganization(env.DB, "Member Corp");
    await seedOrganizationAggregate(env.DB, memberId, "A");
    await claimDomain(memberId, "member.example");
    const { userId, token } = await signedIn("dee@member.example");

    const dismissed = await call(
      token,
      "/api/v1/users/current/identities/offer/dismissals",
      affiliationOfferDismissalSchema.parse({ organizationId: memberId }),
    );
    expect(dismissed.status).toBe(201);
    expect(await offerOf(token)).toBeNull();

    const openId = await insertOrganization(env.DB, "Open Co");
    await claimDomain(openId, "open.example");
    await env.DB.prepare(
      `INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, created_at)
       VALUES ('dee-open', ?, 'dee@open.example', 'dee@open.example', ?, ?)`,
    )
      .bind(userId, nowIso(), nowIso())
      .run();
    await call(
      token,
      "/api/v1/users/current/identities/offer/dismissals",
      affiliationOfferDismissalSchema.parse({ organizationId: openId }),
    );
    expect(
      await linkVerifiedAddressToDomainOrganization(env.DB, { userId, normalizedEmail: "dee@open.example" }),
    ).toBeNull();
    expect(await organizationsOf(userId)).toEqual([]);
  });

  it("keeps free mail independent and asks for the organization's address until the person says they are independent", async () => {
    const organizationId = await insertOrganization(env.DB, "Acme PKI Ltd");
    await claimDomain(organizationId, "gmail.com");
    const { userId, token } = await signedIn("ned@gmail.com");
    await openReview(userId, "Acme PKI Ltd");

    expect(
      await linkVerifiedAddressToDomainOrganization(env.DB, { userId, normalizedEmail: "ned@gmail.com" }),
    ).toBeNull();
    expect(await organizationsOf(userId)).toEqual([]);
    expect(await offerOf(token)).toEqual({
      kind: "work_address",
      freeDomains: ["gmail.com"],
      writtenOrganizationName: "Acme PKI Ltd",
    });

    const independent = await call(
      token,
      "/api/v1/users/current/identities/offer/dismissals",
      affiliationOfferDismissalSchema.parse({ organizationId: null }),
    );
    expect(independent.status).toBe(201);
    expect(await offerOf(token)).toBeNull();
    expect(
      await queryAll(
        env.DB,
        "SELECT resolved_by_user_id, resolved_identity_id FROM affiliation_reviews WHERE user_id = ?",
        [userId],
      ),
    ).toEqual([{ resolved_by_user_id: userId, resolved_identity_id: null }]);
  });

  it("creates nothing for a business domain no organization owns", async () => {
    await insertOrganization(env.DB, "NewCo");
    const { userId, token } = await signedIn("eli@newco.example");
    expect(
      await linkVerifiedAddressToDomainOrganization(env.DB, { userId, normalizedEmail: "eli@newco.example" }),
    ).toBeNull();
    expect(await queryAll(env.DB, "SELECT name FROM organizations")).toEqual([{ name: "NewCo" }]);
    expect(await offerOf(token)).toBeNull();
  });
});
