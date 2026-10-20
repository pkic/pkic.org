import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { callApi } from "./helpers/app";
import { insertOrganization, seedOrganizationAggregate } from "./helpers/membership";
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
      attendanceType: "virtual",
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
  );
  expect(response.status).toBe(200);
  return registrationConfirmInfoResponseSchema.parse(await response.json());
}

async function confirm(body: unknown) {
  const response = await callApi(env, "/api/v1/events/pqc-2026/registrations/confirm-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(registrationConfirmSchema.parse(body)),
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
    await seedEventAndAdmin(env.DB);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks an unknown work domain once and creates the affiliation through the canonical rule", async () => {
    const token = await register("person@unknown-works.example");
    expect((await info(token)).asksOrganization).toBe(true);
    const confirmed = await confirm({ token, organization: { name: "Unknown Works", jobTitle: "Engineer" } });
    expect(confirmed.organizationOutcome).toBe("linked");
    expect(await affiliations("person@unknown-works.example")).toEqual([
      { name: "Unknown Works", job_title: "Engineer" },
    ]);
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

  it("asks nothing for a consumer address or a domain that already names an organization", async () => {
    const personal = await register("person@gmail.com", true);
    expect((await info(personal)).asksOrganization).toBe(false);
    const organizationId = await insertOrganization(env.DB, "Claimed Domain Corp");
    await seedOrganizationAggregate(env.DB, organizationId, "A");
    await env.DB.prepare(
      `INSERT INTO organization_domain_claims (id, domain, application_id, organization_id, created_at, updated_at)
       VALUES (?, 'claimed-domain.test', NULL, ?, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), organizationId)
      .run();
    const claimed = await register("person@claimed-domain.test");
    expect((await info(claimed)).asksOrganization).toBe(false);
    // The approved domain establishes affiliation; a supplied name and title cannot override it.
    const confirmed = await confirm({
      token: claimed,
      organization: { name: "Someone Else Ltd", jobTitle: "Engineer" },
    });
    expect(confirmed.organizationOutcome).toBeNull();
    expect(await affiliations("person@claimed-domain.test")).toEqual([
      { name: "Claimed Domain Corp", job_title: null },
    ]);
  });

  it("joins a non-member organization that owns the confirmed address's domain without asking", async () => {
    const organizationId = await insertOrganization(env.DB, "Open Domain Co");
    await env.DB.prepare(
      `INSERT INTO organization_domain_claims (id, domain, application_id, organization_id, created_at, updated_at)
       VALUES (?, 'open-domain.test', NULL, ?, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), organizationId)
      .run();
    const token = await register("person@open-domain.test");
    expect((await info(token)).asksOrganization).toBe(false);
    await confirm({ token });
    expect(await affiliations("person@open-domain.test")).toEqual([{ name: "Open Domain Co", job_title: null }]);
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
});
