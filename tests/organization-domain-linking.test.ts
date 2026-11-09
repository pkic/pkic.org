import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  affiliationOfferDismissalSchema,
  affiliationOfferResponseSchema,
} from "../assets/shared/schemas/affiliation-offer";
import {
  linkVerifiedAddressToDomainOrganization,
  prepareVerifiedAddressDomainOrganizationLink,
} from "../functions/_lib/services/identities/email-domain-link";
import { getUserDetail } from "../functions/_lib/services/user-management-detail";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { profileD1Flow } from "./helpers/d1-flow-profile";
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

  it("does not automatically link when a second claim appears before commit", async () => {
    const first = await insertOrganization(env.DB, "First Organization");
    const second = await insertOrganization(env.DB, "Second Organization");
    await claimDomain(first, "shared-work.example");
    const { userId } = await signedIn("person@shared-work.example");
    const prepared = await prepareVerifiedAddressDomainOrganizationLink(env.DB, {
      userId,
      normalizedEmail: "person@shared-work.example",
      emailId: null,
      at: nowIso(),
    });
    expect(prepared).not.toBeNull();
    const rootId = await env.DB.prepare("SELECT id FROM organization_domain_claims WHERE domain=?")
      .bind("shared-work.example")
      .first<string>("id");
    await env.DB.prepare(
      `INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,(SELECT domain FROM organization_domain_claims WHERE id=?),?,?,?)`,
    )
      .bind(crypto.randomUUID(), rootId, second, nowIso(), nowIso())
      .run();
    await expect(env.DB.batch(prepared!.statements)).rejects.toThrow();
    expect(await organizationsOf(userId)).toEqual([]);
  });

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
    expect(
      await linkVerifiedAddressToDomainOrganization(env.DB, { userId, normalizedEmail: "history@ibm.example" }),
    ).toMatchObject({ organizationId, resolvedReviews: 3 });
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
    expect(
      await linkVerifiedAddressToDomainOrganization(env.DB, {
        userId,
        normalizedEmail: "history@ibm.example",
        systemDecision: { action: "test_domain_repair", details: {} },
      }),
    ).toBeNull();
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'test_domain_repair'")).toEqual([]);
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
      affiliationOfferDismissalSchema.parse({ organizationId: null, answeredOffer: await offerOf(token) }),
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

  it.each([
    ["work_address", false],
    ["work_address", true],
    ["choose_organization", false],
    ["choose_organization", true],
  ] as const)("still offers new organizations after dismissing the %s prompt (shared: %s)", async (kind, shared) => {
    const { userId, token } = await signedIn(
      kind === "work_address" ? "independent@gmail.com" : "independent@shared.example",
    );
    if (kind === "choose_organization") {
      await claimDomain(await insertOrganization(env.DB, "Shared First"), "shared.example");
      await claimDomain(await insertOrganization(env.DB, "Shared Second"), "shared.example");
    }
    expect(await offerOf(token)).toMatchObject({ kind });
    const dismissal = await call(token, "/api/v1/users/current/identities/offer/dismissals", {
      organizationId: null,
      answeredOffer: await offerOf(token),
    });
    expect(dismissal.status).toBe(201);
    expect(await offerOf(token)).toBeNull();
    const acme = await insertOrganization(env.DB, "Acme");
    await claimDomain(acme, "acme.example");
    if (shared) await claimDomain(await insertOrganization(env.DB, "Another Acme"), "acme.example");
    const at = nowIso();
    await env.DB.prepare(`INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,verification_method,created_at)
        VALUES (?,?,'independent@acme.example','independent@acme.example',?,'magic_link',?)`)
      .bind(crypto.randomUUID(), userId, at, at)
      .run();
    expect(await organizationsOf(userId)).toEqual([]);
    expect(await offerOf(token)).toMatchObject(
      shared
        ? { kind: "choose_organization", domain: "acme.example" }
        : { kind: "organization", organization: { id: acme } },
    );
    await call(token, "/api/v1/users/current/identities/offer/dismissals", {
      organizationId: shared ? null : acme,
      answeredOffer: await offerOf(token),
    });
    expect(await offerOf(token)).toBeNull();
    await claimDomain(await insertOrganization(env.DB, "New Acme Claimant"), "acme.example");
    expect(await offerOf(token)).toMatchObject({ kind: "choose_organization", domain: "acme.example" });
  });

  it("keeps a newly verified shared domain available after answering a stale work-address card", async () => {
    const { userId, token } = await signedIn("person@gmail.com");
    const answeredOffer = await offerOf(token);
    const first = await insertOrganization(env.DB, "First Shared Organization");
    const second = await insertOrganization(env.DB, "Second Shared Organization");
    await claimDomain(first, "shared.example");
    await claimDomain(second, "shared.example");
    await env.DB.prepare(`INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,created_at)
      VALUES (?,?,'person@shared.example','person@shared.example',?,?)`)
      .bind(crypto.randomUUID(), userId, nowIso(), nowIso())
      .run();
    expect(await offerOf(token)).toMatchObject({ kind: "choose_organization" });
    const response = await call(token, "/api/v1/users/current/identities/offer/dismissals", {
      organizationId: null,
      answeredOffer,
    });
    expect(response.status).toBe(201);
    expect(
      await queryAll(env.DB, "SELECT organization_id FROM affiliation_offer_dismissals WHERE user_id=?", [userId]),
    ).toEqual([{ organization_id: null }]);
    expect(await offerOf(token)).toMatchObject({ kind: "choose_organization" });
  });

  it.each(["changed domain", "unverified", "removed", "another user's address", "joined organization"])(
    "does not dismiss stale candidates (%s)",
    async (change) => {
      const { userId, token } = await signedIn("person@gmail.com");
      const emailId = crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,created_at)
        VALUES (?,?,'person@shared.example','person@shared.example',?,?)`)
        .bind(emailId, userId, nowIso(), nowIso())
        .run();
      const first = await insertOrganization(env.DB, "First Shared Organization");
      const second = await insertOrganization(env.DB, "Second Shared Organization");
      await claimDomain(first, "shared.example");
      await claimDomain(second, "shared.example");
      const answeredOffer = await offerOf(token);
      if (change === "removed") await env.DB.prepare("DELETE FROM user_emails WHERE id=?").bind(emailId).run();
      if (change === "unverified")
        await env.DB.prepare("UPDATE user_emails SET verified_at=NULL WHERE id=?").bind(emailId).run();
      if (change === "changed domain") {
        await claimDomain(first, "changed.example");
        await claimDomain(second, "changed.example");
        await env.DB.prepare(
          "UPDATE user_emails SET email='person@changed.example',normalized_email='person@changed.example' WHERE id=?",
        )
          .bind(emailId)
          .run();
      }
      if (change === "another user's address")
        await env.DB.prepare("UPDATE user_emails SET user_id=? WHERE id=?")
          .bind(await insertUser(env.DB, "other@gmail.com"), emailId)
          .run();
      if (change === "joined organization") {
        const identity = await buildCreateIdentityStatement(env.DB, {
          userId,
          organizationId: first,
          source: "staff",
          jobTitle: "Engineer",
          startImmediately: true,
        });
        await env.DB.batch([identity.statement]);
      }
      const response = await call(token, "/api/v1/users/current/identities/offer/dismissals", {
        organizationId: null,
        answeredOffer,
      });
      expect(response.status).toBe(201);
      expect(
        await queryAll(env.DB, "SELECT organization_id FROM affiliation_offer_dismissals WHERE user_id=?", [userId]),
      ).toEqual([{ organization_id: null }]);
    },
  );

  it.each([false, true])("dismisses surviving candidates when a shared domain narrows (alias: %s)", async (alias) => {
    const { userId, token } = await signedIn(alias ? "person@gmail.com" : "person@shared.example");
    if (alias)
      await env.DB.prepare(`INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,created_at)
      VALUES (?,?,'person@shared.example','person@shared.example',?,?)`)
        .bind(crypto.randomUUID(), userId, nowIso(), nowIso())
        .run();
    const first = await insertOrganization(env.DB, "Remaining Organization");
    const second = await insertOrganization(env.DB, "Former Organization");
    await claimDomain(first, "shared.example");
    await claimDomain(second, "shared.example");
    const answeredOffer = await offerOf(token);
    expect(answeredOffer?.kind).toBe("choose_organization");
    await env.DB.prepare("DELETE FROM organization_domain_claims WHERE organization_id=?").bind(second).run();
    expect(await offerOf(token)).toMatchObject({ kind: "organization", organization: { id: first } });
    const response = await call(token, "/api/v1/users/current/identities/offer/dismissals", {
      organizationId: null,
      answeredOffer,
    });
    expect(response.status).toBe(201);
    const dismissed = await queryAll<{ organization_id: string | null }>(
      env.DB,
      "SELECT organization_id FROM affiliation_offer_dismissals WHERE user_id=?",
      [userId],
    );
    expect(dismissed.map((row) => row.organization_id).sort()).toEqual([null, first].sort());
    expect(await offerOf(token)).toBeNull();
    expect(
      await linkVerifiedAddressToDomainOrganization(env.DB, {
        userId,
        normalizedEmail: "person@shared.example",
      }),
    ).toBeNull();
  });

  it("dismisses only the answered candidates, records them in the audit, and remains idempotent", async () => {
    const { userId, token } = await signedIn("person@shared.example");
    const first = await insertOrganization(env.DB, "First Shared Organization");
    const second = await insertOrganization(env.DB, "Second Shared Organization");
    await claimDomain(first, "shared.example");
    await claimDomain(second, "shared.example");
    const answeredOffer = await offerOf(token);
    const third = await insertOrganization(env.DB, "New Shared Organization");
    await claimDomain(third, "shared.example");
    for (let retry = 0; retry < 2; retry++) {
      const response = await call(token, "/api/v1/users/current/identities/offer/dismissals", {
        organizationId: null,
        answeredOffer,
      });
      expect(response.status).toBe(201);
    }
    const dismissed = await queryAll<{ organization_id: string | null }>(
      env.DB,
      "SELECT organization_id FROM affiliation_offer_dismissals WHERE user_id=?",
      [userId],
    );
    expect(dismissed.map((row) => row.organization_id).sort()).toEqual([null, first, second].sort());
    const audits = await queryAll<{ details: string }>(
      env.DB,
      "SELECT details_json AS details FROM audit_log WHERE action='affiliation_offer_dismissed' AND entity_id=?",
      [userId],
    );
    expect(audits).toHaveLength(2);
    for (const audit of audits) {
      const details = JSON.parse(audit.details);
      expect(details).toMatchObject({ organizationId: { to: null }, independent: { to: true } });
      expect(details.dismissedOrganizationIds.to.sort()).toEqual([first, second].sort());
    }
    expect(await offerOf(token)).toMatchObject({ kind: "choose_organization" });
  });

  it("bounds dismissal writes independently of candidate and verified-address counts", async () => {
    const { userId, token } = await signedIn("person@shared.example");
    const at = nowIso();
    const ids = Array.from({ length: 128 }, () => crypto.randomUUID());
    const organizations = ids.map((id, index) => ({ id, name: `Shared Organization ${index}` }));
    const addresses = Array.from({ length: 19 }, (_, index) => ({
      id: crypto.randomUUID(),
      email: `person${index}@other-work.example`,
    }));
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO organizations(id,name,normalized_name,created_at,updated_at)
        SELECT json_extract(value,'$.id'), json_extract(value,'$.name'), lower(json_extract(value,'$.name')), ?, ?
        FROM json_each(?)`).bind(at, at, JSON.stringify(organizations)),
      env.DB.prepare(`INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at)
        SELECT lower(hex(randomblob(16))), 'shared.example', value, ?, ? FROM json_each(?)`).bind(
        at,
        at,
        JSON.stringify(ids),
      ),
      env.DB.prepare(`INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,created_at)
        SELECT json_extract(value,'$.id'), ?, json_extract(value,'$.email'), json_extract(value,'$.email'), ?, ?
        FROM json_each(?)`).bind(userId, at, at, JSON.stringify(addresses)),
    ]);
    const answeredOffer = await offerOf(token);
    const profile = profileD1Flow(env.DB, { measurePayloadBytes: true });
    const response = await callApi({ ...env, DB: profile.db }, "/api/v1/users/current/identities/offer/dismissals", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ organizationId: null, answeredOffer }),
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const report = await profile.report();
    const mutation = report.queries.filter((query) => query.sql.includes("INSERT INTO affiliation_offer_dismissals"));
    expect(mutation).toHaveLength(1);
    expect(mutation[0].operation).toBe("batch");
    expect(report.executedSql.filter((sql) => sql.startsWith("INSERT INTO affiliation_offer_dismissals"))).toHaveLength(
      1,
    );
    expect(report.executedSql.filter((sql) => sql.startsWith("INSERT INTO audit_log"))).toHaveLength(1);
    expect(mutation[0].sql).toContain("UPDATE affiliation_reviews");
    const dismissalPlan = report.plans.find((plan) => plan.sql.includes("INSERT INTO affiliation_offer_dismissals"));
    expect(JSON.stringify(dismissalPlan?.plan)).toContain("affiliation_offer_dismissals_organization");
    expect(JSON.stringify(dismissalPlan?.plan)).toContain("affiliation_offer_dismissals_independent");
    expect(report.queries.reduce((total, query) => total + (query.requestBytes ?? 0), 0)).toBeLessThan(40_000);
    expect(report.queries.reduce((total, query) => total + (query.resultBytes ?? 0), 0)).toBeLessThan(40_000);
    expect(
      await queryAll(env.DB, "SELECT id FROM affiliation_offer_dismissals WHERE user_id=?", [userId]),
    ).toHaveLength(ids.length + 1);
  });

  it("requires the answered card for independence", async () => {
    const { userId, token } = await signedIn("person@gmail.com");
    const response = await call(token, "/api/v1/users/current/identities/offer/dismissals", { organizationId: null });
    expect(response.status).toBe(400);
    expect(await queryAll(env.DB, "SELECT id FROM affiliation_offer_dismissals WHERE user_id=?", [userId])).toEqual([]);
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
