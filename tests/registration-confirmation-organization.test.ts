import type { z } from "zod";
import { linkConfirmedRegistrationOrganization } from "../functions/_lib/services/registrations/confirmation-organization";
import {
  registrationEmailProofVerifySchema,
  registrationEmailProofVerifyResponseSchema,
} from "../assets/shared/schemas/registration-email-proof";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedMemberApplication } from "./helpers/member-applications";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { callApi } from "./helpers/app";
import { buildRegistrationManageView } from "../functions/_lib/services/registrations/manage-view";
import type { RegistrationRecord } from "../functions/_lib/services/registrations/types";
import { insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { stubSuccessfulMxLookup } from "./helpers/mx-lookup";
import {
  registrationConfirmInfoResponseSchema,
  registrationConfirmResponseSchema,
  registrationConfirmSchema,
} from "../assets/shared/schemas/registration";

const consents = [
  { termKey: "privacy-policy", version: "v1" },
  { termKey: "code-of-conduct", version: "v1" },
];

async function register(email: string, unaffiliatedAttestation = false): Promise<string> {
  const response = await callApi(env, "/api/v1/events/pqc-2026/registrations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      firstName: "New",
      lastName: "Attendee",
      email,
      unaffiliatedAttestation,
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "virtual" }],
      sourceType: "direct",
      consents,
    }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const [mail] = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_confirm_email' AND recipient_email = ?",
    [email],
  );
  const payload = await deliveredEmailPayload<{ confirmationUrl: string }>(env.DB, env, mail.payload_json);
  return new URL(payload.confirmationUrl).searchParams.get("token")!;
}

async function info(token: string) {
  const response = await callApi(
    env,
    `/api/v1/events/pqc-2026/registrations/confirm-info?token=${encodeURIComponent(token)}`,
    undefined,
    { maxRoundTrips: 1 },
  );
  expect(response.status).toBe(200);
  return registrationConfirmInfoResponseSchema.parse(await response.json());
}

async function verifyOrganization(
  token: string,
  affiliation?: z.infer<typeof registrationEmailProofVerifySchema>["affiliation"],
) {
  const response = await callApi(
    env,
    "/api/v1/events/pqc-2026/registrations/proof/verify",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(registrationEmailProofVerifySchema.parse({ token, affiliation })),
    },
    { maxRoundTrips: 1 },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return registrationEmailProofVerifyResponseSchema.parse(await response.json()).affiliation!;
}

async function confirm(body: unknown) {
  const parsed = registrationConfirmSchema.parse(body);
  if (parsed.organization && !parsed.organization.contextToken) {
    const confirmation = await info(parsed.token);
    const prepared = await verifyOrganization(confirmation.organizationProof!, {
      organizationId: null,
      organizationName: parsed.organization.name,
      jobTitle: parsed.organization.jobTitle,
    });
    parsed.organization = { ...parsed.organization, organizationId: null, contextToken: prepared.contextToken };
  }
  const response = await callApi(env, "/api/v1/events/pqc-2026/registrations/confirm-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(parsed),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return registrationConfirmResponseSchema.parse(await response.json());
}

function affiliations(email: string) {
  return queryAll<{ name: string; job_title: string | null }>(
    env.DB,
    `SELECT organization.name, identity.job_title FROM identities identity
       JOIN users person ON person.id = identity.user_id
       JOIN organizations organization ON organization.id = identity.organization_id
      WHERE person.normalized_email = ?`,
    [email],
  );
}

describe("organization named on registration confirmation", () => {
  beforeEach(async () => {
    await resetDb();
    stubSuccessfulMxLookup();
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.prepare(
      "INSERT INTO event_days(id,event_id,day_date,created_at,updated_at) VALUES(?,?,'2026-12-01',?,?)",
    )
      .bind(crypto.randomUUID(), eventId, new Date().toISOString(), new Date().toISOString())
      .run();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("preserves the confirmation link and email intent when the stored event start is unsupported", async () => {
    const token = await register("unaffiliated-attendee@gmail.com", true);
    const state = () =>
      queryAll(env.DB, "SELECT status,confirmed_at,confirmation_link_secret,manage_link_secret FROM registrations");
    const emails = () => queryAll(env.DB, "SELECT id FROM email_outbox ORDER BY id");
    const before = await state();
    const beforeEmails = await emails();
    await env.DB.prepare("UPDATE events SET starts_at=? WHERE slug='pqc-2026'").bind("2026-12-01T09:00:00+01:00").run();
    const response = await callApi(env, "/api/v1/events/pqc-2026/registrations/confirm-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(registrationConfirmSchema.parse({ token })),
    });
    expect(response.status).toBe(500);
    expect(await state()).toEqual(before);
    expect(await emails()).toEqual(beforeEmails);
    await env.DB.prepare("UPDATE events SET starts_at=? WHERE slug='pqc-2026'").bind("2026-12-01T08:00:00.000Z").run();
    expect((await confirm({ token })).status).toBe("registered");
  });

  it("asks an unknown work domain once and creates the affiliation through the canonical rule", async () => {
    const token = await register("person@unknown-works.example");
    expect((await info(token)).asksOrganization).toBe(true);
    const confirmed = await confirm({ token, organization: { name: "Unknown Works", jobTitle: "Engineer" } });
    expect(confirmed.organizationOutcome).toBe("linked");
    expect(await affiliations("person@unknown-works.example")).toEqual([
      { name: "Unknown Works", job_title: "Engineer" },
    ]);
    expect(
      await queryAll(
        env.DB,
        `SELECT organization.name FROM organization_domain_claims claim
      JOIN organizations organization ON organization.id=claim.organization_id WHERE claim.domain=?`,
        ["unknown-works.example"],
      ),
    ).toEqual([]);
  });

  it("links a newly named organization to a domain already claimed by another organization", async () => {
    const existing = await insertOrganization(env.DB, "Existing Organization");
    const at = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at)
      VALUES (?,?,?,?,?)`)
      .bind(crypto.randomUUID(), "new-shared.example", existing, at, at)
      .run();
    const token = await register("person@new-shared.example");
    const proof = (await info(token)).organizationProof!;
    const prepared = await verifyOrganization(proof, {
      organizationId: null,
      organizationName: "New Organization",
      domain: "new-shared.example",
      jobTitle: "Engineer",
    });
    await confirm({
      token,
      organization: {
        name: "New Organization",
        organizationId: null,
        jobTitle: "Engineer",
        contextToken: prepared.contextToken,
      },
    });
    expect(
      await queryAll(
        env.DB,
        `SELECT organization.name FROM organization_domain_claims claim
      JOIN organizations organization ON organization.id=claim.organization_id WHERE claim.domain=? ORDER BY organization.name`,
        ["new-shared.example"],
      ),
    ).toEqual([{ name: "Existing Organization" }]);
  });

  it("refuses an organization named without a job title, before anything is linked", async () => {
    const token = await register("person@unknown-works.example");
    const response = await callApi(env, "/api/v1/events/pqc-2026/registrations/confirm-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, organization: { name: "Unknown Works" } }),
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain("Enter your job title at this organization.");
    expect(await affiliations("person@unknown-works.example")).toEqual([]);
  });

  it("confirms a reserved work domain and queues its affiliation for review", async () => {
    const email = "registrant@pending-confirmation.example";
    await seedMemberApplication({
      organizationDomain: "pending-confirmation.example",
      organizationName: "Pending Confirmation Organization",
    });
    const token = await register(email);
    const confirmation = await info(token);
    expect(confirmation.asksOrganization).toBe(true);
    const prepared = await verifyOrganization(confirmation.organizationProof!, {
      organizationId: null,
      organizationName: "Pending Confirmation Organization",
      jobTitle: "Engineer",
    });
    const result = await confirm({
      token,
      organization: {
        name: "Pending Confirmation Organization",
        jobTitle: "Engineer",
        contextToken: prepared.contextToken,
      },
    });
    expect(result.organizationOutcome).toBe("review_required");
    expect(await affiliations(email)).toEqual([]);
    expect(
      await queryAll(
        env.DB,
        `SELECT review.organization_name FROM affiliation_reviews review
      JOIN registrations registration ON registration.id=review.source_id
      JOIN users person ON person.id=registration.user_id WHERE person.normalized_email=?`,
        [email],
      ),
    ).toEqual([{ organization_name: "Pending Confirmation Organization" }]);
    const [registration] = await queryAll<RegistrationRecord>(
      env.DB,
      `SELECT registration.* FROM registrations registration
      JOIN users person ON person.id=registration.user_id WHERE person.normalized_email=?`,
      [email],
    );
    // The manage page names the organization awaiting review rather than showing the registrant as Personal.
    expect(await buildRegistrationManageView(env.DB, registration, "https://app.test")).toMatchObject({
      user: { organization_name: null },
      pendingOrganizationName: "Pending Confirmation Organization",
    });
  });

  it("queues a differently spelled organization for review while an application uses its domain", async () => {
    const applicationId = await seedMemberApplication({
      organizationDomain: "pending-other.example",
      organizationName: "Pending Organization",
    });
    const token = await register("person@pending-other.example");
    const confirmed = await confirm({ token, organization: { name: "Different Organization", jobTitle: "Engineer" } });
    expect(confirmed.organizationOutcome).toBe("review_required");
    expect(await affiliations("person@pending-other.example")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM organizations WHERE name='Different Organization'")).toEqual([]);
    expect(
      await env.DB.prepare("SELECT application_id FROM organization_domain_claims WHERE domain=?")
        .bind("pending-other.example")
        .first("application_id"),
    ).toBe(applicationId);
  });

  it("does not ask a consumer address for an organization", async () => {
    const personal = await register("person@gmail.com", true);
    expect(await info(personal)).toMatchObject({ asksOrganization: false });
    expect((await info(personal)).organizationProof).toBeUndefined();
  });

  it.each([true, false])(
    "confirms the domain's default organization through the shared chooser (member: %s)",
    async (member) => {
      const name = member ? "Claimed Domain Corp" : "Open Domain Co";
      const organizationId = await insertOrganization(env.DB, name);
      if (member) await seedOrganizationAggregate(env.DB, organizationId, "A");
      const at = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO organization_domain_claims (id, domain, application_id, organization_id, created_at, updated_at)
       VALUES (?, 'claimed-domain.test', NULL, ?, ?, ?)`,
      )
        .bind(crypto.randomUUID(), organizationId, at, at)
        .run();
      const email = "person@claimed-domain.test";
      const token = await register(email);
      const confirmation = await info(token);
      expect(confirmation.asksOrganization).toBe(true);
      expect(confirmation.organizationProof).toEqual(expect.any(String));
      const preview = await verifyOrganization(confirmation.organizationProof!);
      expect(preview.organization).toEqual({ id: organizationId, name });
      expect(preview.organizations).toMatchObject([{ id: organizationId, name }]);
      const prepared = await verifyOrganization(confirmation.organizationProof!, {
        organizationId,
        jobTitle: "Engineer",
      });
      const selection = { name, organizationId, jobTitle: "Engineer", contextToken: prepared.contextToken };
      // A signed selection cannot be replaced by an unrelated organization name.
      const refusal = await callApi(env, "/api/v1/events/pqc-2026/registrations/confirm-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          registrationConfirmSchema.parse({ token, organization: { ...selection, name: "Someone Else Ltd" } }),
        ),
      });
      expect(refusal.status).toBe(409);
      expect(await affiliations(email)).toEqual([]);
      const confirmed = await confirm({ token, organization: selection });
      expect(confirmed.organizationOutcome).toBe("linked");
      expect(await affiliations(email)).toEqual([{ name, job_title: "Engineer" }]);
      expect(
        await queryAll(
          env.DB,
          `SELECT identity.organization_id FROM registrations registration
      JOIN users person ON person.id=registration.user_id
      JOIN identities identity ON identity.id=registration.registration_identity_id
      WHERE person.normalized_email=?`,
          [email],
        ),
      ).toEqual([{ organization_id: organizationId }]);
    },
  );

  it.each(["First Organization", "Second Organization"])(
    "asks a registrant to choose %s when a domain is shared",
    async (selectedName) => {
      const first = await insertOrganization(env.DB, "First Organization");
      const second = await insertOrganization(env.DB, "Second Organization");
      const claimId = crypto.randomUUID();
      const at = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO organization_domain_claims
          (id,domain,organization_id,created_at,updated_at) VALUES (?,'shared-domain.example',?,?,?)`).bind(
          claimId,
          first,
          at,
          at,
        ),
        env.DB.prepare(
          `INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,(SELECT domain FROM organization_domain_claims WHERE id=?),?,?,?)`,
        ).bind(crypto.randomUUID(), claimId, second, at, at),
      ]);
      const email = "person@shared-domain.example";
      const token = await register(email);
      const confirmation = await info(token);
      const preview = await verifyOrganization(confirmation.organizationProof!);
      expect(preview.organization).toBeNull();
      expect(preview.organizations.map(({ id }) => id).sort()).toEqual([first, second].sort());
      expect(await affiliations(email)).toEqual([]);
      const organizationId = selectedName === "First Organization" ? first : second;
      const prepared = await verifyOrganization(confirmation.organizationProof!, {
        organizationId,
        jobTitle: "Engineer",
      });
      const result = await confirm({
        token,
        organization: {
          name: selectedName,
          organizationId,
          jobTitle: "Engineer",
          contextToken: prepared.contextToken,
        },
      });
      expect(result.organizationOutcome).toBe("linked");
      expect(await affiliations(email)).toEqual([{ name: selectedName, job_title: "Engineer" }]);
    },
  );

  it("does not confirm a selected organization whose shared claim was removed", async () => {
    const first = await insertOrganization(env.DB, "First Organization");
    const second = await insertOrganization(env.DB, "Second Organization");
    const claimId = crypto.randomUUID();
    const extraId = crypto.randomUUID();
    const at = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at)
        VALUES (?,'shared-domain.example',?,?,?)`).bind(claimId, first, at, at),
      env.DB.prepare(
        `INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,(SELECT domain FROM organization_domain_claims WHERE id=?),?,?,?)`,
      ).bind(extraId, claimId, second, at, at),
    ]);
    const email = "person@shared-domain.example";
    const token = await register(email);
    const confirmation = await info(token);
    const prepared = await verifyOrganization(confirmation.organizationProof!, {
      organizationId: second,
      jobTitle: "Engineer",
    });
    await env.DB.prepare("DELETE FROM organization_domain_claims WHERE id=?").bind(extraId).run();
    const response = await callApi(env, "/api/v1/events/pqc-2026/registrations/confirm-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        registrationConfirmSchema.parse({
          token,
          organization: {
            name: "Second Organization",
            organizationId: second,
            jobTitle: "Engineer",
            contextToken: prepared.contextToken,
          },
        }),
      ),
    });
    expect(response.status).toBe(409);
    expect(await affiliations(email)).toEqual([]);
  });

  it("queues a name the rule cannot link for staff review and still confirms the registration", async () => {
    const organizationId = await insertOrganization(env.DB, "Closed Member Corp");
    await seedOrganizationAggregate(env.DB, organizationId, "A");
    const token = await register("person@closed-member.example");
    expect((await info(token)).asksOrganization).toBe(true);
    const confirmed = await confirm({ token, organization: { name: "Closed Member Corp", jobTitle: "Engineer" } });
    expect(confirmed.status).toBe("registered");
    expect(confirmed.organizationOutcome).toBe("review_required");
    expect(await affiliations("person@closed-member.example")).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT organization_name, source_type, email_domain FROM affiliation_reviews"),
    ).toEqual([
      { organization_name: "Closed Member Corp", source_type: "registration", email_domain: "closed-member.example" },
    ]);
  });
  it("registers a selected member on a shared domain for affiliation review without granting member access", async () => {
    const selected = await insertOrganization(env.DB, "Shared Member");
    await seedOrganizationAggregate(env.DB, selected);
    const other = await insertOrganization(env.DB, "Other Claimant");
    const at = new Date().toISOString();
    await env.DB.batch(
      [selected, other].map((organizationId) =>
        env.DB.prepare(
          "INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,'member-shared.example',?,?,?)",
        ).bind(crypto.randomUUID(), organizationId, at, at),
      ),
    );
    const email = "person@member-shared.example";
    const token = await register(email);
    const confirmation = await info(token);
    const prepared = await verifyOrganization(confirmation.organizationProof!, {
      organizationId: selected,
      jobTitle: "Engineer",
    });
    const result = await confirm({
      token,
      organization: {
        name: "Shared Member",
        organizationId: selected,
        jobTitle: "Engineer",
        contextToken: prepared.contextToken,
      },
    });
    expect(result.organizationOutcome).toBe("review_required");
    expect(result.status).toBe("registered");
    expect(await affiliations(email)).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT organization_name FROM affiliation_reviews WHERE source_type='registration'"),
    ).toEqual([{ organization_name: "Shared Member" }]);
  });

  it("queues a confirmed named organization on an owned domain when no signed chooser context was supplied", async () => {
    const organizationId = await insertOrganization(env.DB, "Known Organization");
    const email = "person@known-work.example";
    const userId = await insertUser(env.DB, email);
    const at = new Date().toISOString();
    const registrationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET email_verified_at=? WHERE id=?").bind(at, userId),
      env.DB.prepare(
        "INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,'known-work.example',?,?,?)",
      ).bind(crypto.randomUUID(), organizationId, at, at),
      env.DB.prepare(
        "INSERT INTO registrations(id,event_id,user_id,status,source_type,confirmed_at,manage_link_secret,created_at,updated_at) VALUES (?,(SELECT id FROM events WHERE slug='pqc-2026'),?,'registered','direct',?,'synthetic-manage-secret',?,?)",
      ).bind(registrationId, userId, at, at, at),
    ]);
    const outcome = await linkConfirmedRegistrationOrganization(env.DB, {
      registrationId,
      organization: { name: "Known Organization", jobTitle: "Engineer" },
      at,
    });
    expect(outcome).toBe("review_required");
    expect(await affiliations(email)).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT organization_name FROM affiliation_reviews WHERE source_id=?", [registrationId]),
    ).toEqual([{ organization_name: "Known Organization" }]);
  });
});
