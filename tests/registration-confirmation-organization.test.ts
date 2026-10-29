import type { z } from "zod";
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

  it("confirms a reserved work domain and queues its affiliation for review", async () => {
    const email = "registrant@pending-confirmation.example";
    await seedMemberApplication({ organizationDomain: "pending-confirmation.example" });
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
