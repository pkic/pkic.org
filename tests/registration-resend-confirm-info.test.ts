import { getEventBySlug } from "../functions/_lib/services/events";
import { queueRegistrationManageLinkRecovery } from "../functions/_lib/services/registrations/manage-link-recovery";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { insertOrganization } from "./helpers/membership";
import { seedMemberApplication } from "./helpers/member-applications";
import { registrationEmailProofVerifyResponseSchema } from "../assets/shared/schemas/registration-email-proof";
import { ADMINISTRATOR_FIXTURE_USER_SQL } from "./helpers/administrator";
/**
 * registration-resend-confirm-info.test.ts
 *
 * Covers:
 *  - GET  /api/v1/events/:slug/registrations/confirm-info?token=...
 *  - POST /api/v1/events/:slug/registrations/resend-confirmation
 *  - POST /api/v1/events/:slug/registrations/resend-manage-link
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { createTestRateLimiter, seedEventAndAdmin, queryAll } from "./helpers/context";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";
import { issueDatabaseCapability, materializeQueuedCapabilityLinks } from "../functions/_lib/services/capability-links";
import { getRegistrationByManageToken } from "../functions/_lib/services/registrations";
import { callApi } from "./helpers/app";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import {
  registrationConfirmInfoResponseSchema,
  registrationManageReadResponseSchema,
} from "../assets/shared/schemas/registration";
import { eventRegistrationManagementUpdateResponseSchema } from "../assets/shared/schemas/route-contracts-event-registration-management";
import { createAdminSession } from "./helpers/auth";

const signingSecret = "test-signing-secret";

function resendManageLink(environment: typeof env, email: string, clientIp = "203.0.113.20"): Promise<Response> {
  return callApi(environment, "/api/v1/events/pqc-2026/registrations/resend-manage-link", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": clientIp },
    body: JSON.stringify({ email }),
  });
}

/** Organizers correct a registrant's address; an attendee's address follows their identity. */
async function organizerChangesEmail(registrationId: string, email: string): Promise<Response> {
  const [admin] = await queryAll<{ id: string }>(env.DB, ADMINISTRATOR_FIXTURE_USER_SQL);
  const token = await createAdminSession(env.DB, admin.id, `organizer-${crypto.randomUUID()}`);
  return callApi(env, `/api/v1/events/pqc-2026/registrations/${encodeURIComponent(registrationId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "update", email }),
  });
}

/** Exercise the same verified-domain chooser used by the confirmation page. */
async function confirmationOrganization(token: string) {
  const infoResponse = await callApi(
    env,
    `/api/v1/events/pqc-2026/registrations/confirm-info?token=${encodeURIComponent(token)}`,
    undefined,
    { maxRoundTrips: 1 },
  );
  expect(infoResponse.status).toBe(200);
  const info = registrationConfirmInfoResponseSchema.parse(await infoResponse.json());
  expect(info.organizationProof).toBeTruthy();
  const affiliation = {
    organizationId: null,
    organizationName: "Corrected Domain Fixture",
    jobTitle: "Engineer",
  };
  const prepared = await callApi(env, "/api/v1/events/pqc-2026/registrations/proof/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: info.organizationProof, affiliation }),
  });
  expect(prepared.status, await prepared.clone().text()).toBe(200);
  const proof = registrationEmailProofVerifyResponseSchema.parse(await prepared.json());
  return {
    name: affiliation.organizationName,
    jobTitle: affiliation.jobTitle,
    contextToken: proof.affiliation!.contextToken!,
  };
}

async function registerAttendee(): Promise<{
  confirmationToken: string;
  registrationId: string;
  email: string;
  manageToken: string;
}> {
  await env.DB.prepare(
    "INSERT INTO event_days(id,event_id,day_date,created_at,updated_at) SELECT ? ,id,'2026-12-01',?,? FROM events WHERE slug='pqc-2026' ON CONFLICT(event_id,day_date) DO NOTHING",
  )
    .bind(crypto.randomUUID(), new Date().toISOString(), new Date().toISOString())
    .run();
  const registrationEnv = {
    ...env,
    EMAIL_RATE_LIMITER: createTestRateLimiter(100),
    IP_RATE_LIMITER: createTestRateLimiter(100),
  };
  const response = await callApi(registrationEnv, "/api/v1/events/pqc-2026/registrations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      firstName: "Test",
      lastName: "User",
      email: "resendtest@pkic.org",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "virtual" }],
      sourceType: "direct",
      consents: [
        { termKey: "privacy-policy", version: "v1" },
        { termKey: "code-of-conduct", version: "v1" },
      ],
    }),
  });

  expect(response.status).toBe(200);
  const payload = (await response.json()) as { manageToken: string };

  const registration = (
    await queryAll<{ id: string }>(env.DB, "SELECT id FROM registrations ORDER BY created_at DESC LIMIT 1")
  )[0];
  const registrationId = registration.id;
  const confirmationToken = await issueDatabaseCapability({
    db: env.DB,
    signingSecret,
    purpose: "registration_confirm",
    resourceId: registrationId,
  });

  return { confirmationToken, registrationId, email: "resendtest@pkic.org", manageToken: payload.manageToken };
}

describe("confirm-info endpoint", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await resetDb();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "msg-1" } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns attendee info for a valid confirmation token", async () => {
    await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, ADMINISTRATOR_FIXTURE_USER_SQL))[0];
    await seedWorkflowEmailTemplates(env.DB, admin.id);

    const { confirmationToken, registrationId } = await registerAttendee();

    const response = await callApi(
      env,
      `/api/v1/events/pqc-2026/registrations/confirm-info?token=${encodeURIComponent(confirmationToken)}&id=${encodeURIComponent(registrationId)}`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      eventName: string | null;
      expired: boolean;
    };
    expect(body.firstName).toBe("Test");
    expect(body.lastName).toBe("User");
    expect(body.email).toBe("resendtest@pkic.org");
    expect(body.eventName).toBe("PQC Conference 2026");
    expect(body.expired).toBe(false);
  });

  it("advances only the canonical guard revision for a pending registration's name-only edit", async () => {
    await seedEventAndAdmin(env.DB);
    const { confirmationToken, manageToken, registrationId } = await registerAttendee();
    const response = await callApi(
      env,
      `/api/v1/events/pqc-2026/registrations/confirm-info?token=${encodeURIComponent(confirmationToken)}`,
    );
    const info = registrationConfirmInfoResponseSchema.parse(await response.json());
    expect(info.organizationProof).toBeTruthy();
    const revisions = () =>
      queryAll<{ transition_revision: number }>(env.DB, "SELECT transition_revision FROM registrations WHERE id=?", [
        registrationId,
      ]);
    const [before] = await revisions();
    const updated = await callApi(env, `/api/v1/registrations/access/${encodeURIComponent(manageToken)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "update", firstName: "Updated" }),
    });
    expect(updated.status, await updated.clone().text()).toBe(200);
    const [after] = await revisions();
    expect(after.transition_revision).toBe(before.transition_revision + 1);
    const proof = await callApi(env, "/api/v1/events/pqc-2026/registrations/proof/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: info.organizationProof }),
    });
    expect(proof.status).toBe(409);
    expect(await proof.json()).toMatchObject({ error: { code: "REGISTRATION_CHANGED" } });
  });

  it("refuses a confirmation mailbox proof after its pending registration changes", async () => {
    await seedEventAndAdmin(env.DB);
    const { confirmationToken, registrationId } = await registerAttendee();
    const response = await callApi(
      env,
      `/api/v1/events/pqc-2026/registrations/confirm-info?token=${encodeURIComponent(confirmationToken)}`,
      undefined,
      { maxRoundTrips: 1 },
    );
    const info = registrationConfirmInfoResponseSchema.parse(await response.json());
    expect(info.organizationProof).toBeTruthy();
    await env.DB.prepare("UPDATE registrations SET transition_revision=transition_revision+1 WHERE id=?")
      .bind(registrationId)
      .run();
    const stale = await callApi(
      env,
      "/api/v1/events/pqc-2026/registrations/proof/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: info.organizationProof }),
      },
      { maxRoundTrips: 1 },
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "REGISTRATION_CHANGED" } });
  });

  it.each(["shared claim", "pending application"])(
    "confirms the organization despite an unrelated change on its domain (%s)",
    async (change) => {
      await seedEventAndAdmin(env.DB);
      const { confirmationToken, registrationId } = await registerAttendee();
      const organization = await confirmationOrganization(confirmationToken);
      if (change === "shared claim") {
        const competitor = await insertOrganization(env.DB, "Concurrent Domain Fixture");
        const at = new Date().toISOString();
        await env.DB.prepare(
          "INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,?,?,?,?)",
        )
          .bind(crypto.randomUUID(), "pkic.org", competitor, at, at)
          .run();
      } else
        await seedMemberApplication({
          applicantEmail: "pending@pkic.org",
          organizationName: "Pending Domain Fixture",
          organizationDomain: "pkic.org",
        });
      const response = await callApi(env, "/api/v1/events/pqc-2026/registrations/confirm-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: confirmationToken, id: registrationId, organization }),
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const registration = await env.DB.prepare("SELECT status,registration_identity_id FROM registrations WHERE id=?")
        .bind(registrationId)
        .first<{ status: string; registration_identity_id: string | null }>();
      expect(registration?.status).toBe("registered");
      expect(registration?.registration_identity_id).toBeTruthy();
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS total FROM organizations WHERE name=?")
          .bind(organization.name)
          .first(),
      ).toMatchObject({ total: 1 });
    },
  );

  it("returns null values for an invalid/unknown token", async () => {
    await seedEventAndAdmin(env.DB);

    const response = await callApi(env, "/api/v1/events/pqc-2026/registrations/confirm-info?token=invalid-goes-here");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      firstName: null;
      eventName: null;
      expired: boolean;
    };
    expect(body.firstName).toBeNull();
    expect(body.eventName).toBeNull();
    expect(body.expired).toBe(false);
  });

  it("returns null values when no token is provided", async () => {
    await seedEventAndAdmin(env.DB);

    const response = await callApi(env, "/api/v1/events/pqc-2026/registrations/confirm-info");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { firstName: null; eventName: null };
    expect(body.firstName).toBeNull();
    expect(body.eventName).toBeNull();
  });
});

describe("resend-confirmation endpoint", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await resetDb();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "msg-1" } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queues a fresh expiring confirmation link without invalidating the earlier link", async () => {
    await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, ADMINISTRATOR_FIXTURE_USER_SQL))[0];
    await seedWorkflowEmailTemplates(env.DB, admin.id);

    const { confirmationToken, registrationId } = await registerAttendee();

    const response = await callApi(env, "/api/v1/events/pqc-2026/registrations/resend-confirmation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: registrationId, token: confirmationToken }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // Verify a new confirmation email was queued
    const outbox = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM email_outbox WHERE template_key = 'registration_confirm_email' ORDER BY created_at DESC LIMIT 1",
    );
    expect(outbox.length).toBeGreaterThan(0);

    const latestPayload = (
      await queryAll<{ payload_json: string }>(
        env.DB,
        "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_confirm_email' ORDER BY created_at DESC LIMIT 1",
      )
    )[0];
    const storedPayload = JSON.parse(latestPayload.payload_json) as Record<string, unknown>;
    expect(JSON.stringify(storedPayload)).toContain("pkcq1_");
    const deliveredPayload = await materializeQueuedCapabilityLinks(env.DB, env, storedPayload);
    const confirmationUrl = new URL(deliveredPayload.confirmationUrl as string);
    const freshToken = confirmationUrl.searchParams.get("token") as string;
    expect(freshToken).toMatch(/^pkc1_/);

    const originalInfoResponse = await callApi(
      env,
      `/api/v1/events/pqc-2026/registrations/confirm-info?token=${encodeURIComponent(confirmationToken)}&id=${encodeURIComponent(registrationId)}`,
    );
    const originalInfo = (await originalInfoResponse.json()) as {
      email: string | null;
      expired: boolean;
      recoverable: boolean;
    };
    expect(originalInfo.email).toBe("resendtest@pkic.org");
    expect(originalInfo.expired).toBe(false);
    expect(originalInfo.recoverable).toBe(false);

    const freshInfoResponse = await callApi(
      env,
      `/api/v1/events/pqc-2026/registrations/confirm-info?token=${encodeURIComponent(freshToken)}&id=${encodeURIComponent(registrationId)}`,
    );
    expect((await freshInfoResponse.json()) as { email: string | null }).toMatchObject({
      email: "resendtest@pkic.org",
    });

    const staleResponse = await callApi(env, "/api/v1/events/pqc-2026/registrations/resend-confirmation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: registrationId, token: confirmationToken }),
    });
    expect(staleResponse.status).toBe(200);
  });

  it("rolls back recovery when managed email change makes the recipient snapshot stale", async () => {
    await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, ADMINISTRATOR_FIXTURE_USER_SQL))[0];
    await seedWorkflowEmailTemplates(env.DB, admin.id);

    const { confirmationToken, registrationId } = await registerAttendee();
    const [{ user_id: userId }] = await queryAll<{ user_id: string }>(
      env.DB,
      "SELECT user_id FROM registrations WHERE id=?",
      [registrationId],
    );
    const originalIdentity = await buildCreateIdentityStatement(env.DB, {
      userId,
      organizationId: await insertOrganization(env.DB, "Original Domain Fixture"),
      source: "verified_email",
      verifiedEmailDomain: "pkic.org",
      startImmediately: true,
    });
    await env.DB.batch([
      originalIdentity.statement,
      env.DB.prepare("UPDATE registrations SET registration_identity_id=? WHERE id=?").bind(
        originalIdentity.identityId,
        registrationId,
      ),
    ]);

    const oldRecipientBefore = (
      await queryAll<{ total: number }>(
        env.DB,
        `SELECT COUNT(*) AS total FROM email_outbox
         WHERE template_key = 'registration_confirm_email' AND recipient_email = ?`,
        ["resendtest@pkic.org"],
      )
    )[0].total;

    const gate = gateNextBatch(env.DB);
    const staleRecovery = callApi(
      { ...env, DB: gate.db },
      "/api/v1/events/pqc-2026/registrations/resend-confirmation",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "resendtest@pkic.org" }),
      },
    );
    await gate.reached;

    const emailChange = await organizerChangesEmail(registrationId, "resend-corrected@example.test");
    expect(emailChange.status, await emailChange.clone().text()).toBe(200);
    expect(eventRegistrationManagementUpdateResponseSchema.parse(await emailChange.json())).toMatchObject({
      success: true,
      emailChanged: true,
    });

    gate.release();
    const recoveryResponse = await staleRecovery;
    expect(recoveryResponse.status).toBe(200);
    expect(await recoveryResponse.json()).toEqual({ ok: true });

    const oldRecipientAfter = (
      await queryAll<{ total: number }>(
        env.DB,
        `SELECT COUNT(*) AS total FROM email_outbox
         WHERE template_key = 'registration_confirm_email' AND recipient_email = ?`,
        ["resendtest@pkic.org"],
      )
    )[0].total;
    expect(oldRecipientAfter).toBe(oldRecipientBefore);

    const newAddressOutbox = await queryAll<{ payload_json: string }>(
      env.DB,
      `SELECT payload_json FROM email_outbox
       WHERE template_key = 'registration_email_change' AND recipient_email = ?`,
      ["resend-corrected@example.test"],
    );
    expect(newAddressOutbox).toHaveLength(1);
    await expect(
      queryAll<{ recipient_email: string }>(
        env.DB,
        `SELECT recipient_email FROM email_outbox
          WHERE template_key = 'registration_email_change_notice'`,
      ),
    ).resolves.toEqual([{ recipient_email: "resendtest@pkic.org" }]);

    const oldConfirmation = await callApi(env, "/api/v1/events/pqc-2026/registrations/confirm-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: registrationId, token: confirmationToken }),
    });
    expect(oldConfirmation.status).toBe(404);

    const newAddressDelivery = await materializeQueuedCapabilityLinks(
      env.DB,
      env,
      JSON.parse(newAddressOutbox[0].payload_json) as Record<string, unknown>,
    );
    const newAddressToken = new URL(newAddressDelivery.confirmationUrl as string).searchParams.get("token");
    expect(newAddressToken).toMatch(/^pkc1_/);

    const organization = await confirmationOrganization(newAddressToken!);
    expect(
      await env.DB.prepare("SELECT ended_at FROM identities WHERE id=?").bind(originalIdentity.identityId).first(),
    ).toMatchObject({ ended_at: null });
    const confirmation = await callApi(env, "/api/v1/events/pqc-2026/registrations/confirm-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: registrationId,
        token: newAddressToken,
        organization,
      }),
    });
    expect(confirmation.status).toBe(200);
    const [selected] = await queryAll<{ name: string; registration_identity_id: string }>(
      env.DB,
      `SELECT organization.name,registration.registration_identity_id
      FROM registrations registration JOIN identities identity ON identity.id=registration.registration_identity_id
      JOIN organizations organization ON organization.id=identity.organization_id WHERE registration.id=?`,
      [registrationId],
    );
    expect(selected.name).toBe("Corrected Domain Fixture");
    expect(selected.registration_identity_id).not.toBe(originalIdentity.identityId);
    expect(
      await env.DB.prepare("SELECT ended_at FROM identities WHERE id=?").bind(originalIdentity.identityId).first(),
    ).toMatchObject({ ended_at: expect.any(String) });

    expect(await confirmation.json()).toMatchObject({
      success: true,
      stage: "confirmed",
      manageToken: expect.any(String),
    });
    await expect(
      queryAll<{ email: string; pending_email: string | null }>(
        env.DB,
        "SELECT email, pending_email FROM users WHERE id = (SELECT user_id FROM registrations WHERE id = ?)",
        [registrationId],
      ),
    ).resolves.toEqual([{ email: "resend-corrected@example.test", pending_email: null }]);
  });

  it("resends only to the new address and invalidates delayed confirmation capabilities after promotion", async () => {
    await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, ADMINISTRATOR_FIXTURE_USER_SQL))[0];
    await seedWorkflowEmailTemplates(env.DB, admin.id);
    const { registrationId } = await registerAttendee();

    const emailChange = await organizerChangesEmail(registrationId, "delayed-new@example.test");
    expect(emailChange.status, await emailChange.clone().text()).toBe(200);
    const newAddressRows = await queryAll<{ payload_json: string }>(
      env.DB,
      `SELECT payload_json FROM email_outbox
        WHERE template_key = 'registration_email_change' AND recipient_email = ?`,
      ["delayed-new@example.test"],
    );
    expect(newAddressRows).toHaveLength(1);

    // The old address can request recovery without account enumeration, but
    // the resulting live confirmation capability is delivered only to the new
    // proof target.
    const recovery = await callApi(env, "/api/v1/events/pqc-2026/registrations/resend-confirmation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "resendtest@pkic.org" }),
    });
    expect(recovery.status).toBe(200);

    const recoveryRows = await queryAll<{ payload_json: string }>(
      env.DB,
      `SELECT payload_json FROM email_outbox
        WHERE template_key = 'registration_confirm_email' AND recipient_email = ?
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      ["delayed-new@example.test"],
    );
    expect(recoveryRows).toHaveLength(1);

    const firstConfirmationDelivery = await materializeQueuedCapabilityLinks(
      env.DB,
      env,
      JSON.parse(newAddressRows[0].payload_json) as Record<string, unknown>,
    );
    const firstToken = new URL(firstConfirmationDelivery.confirmationUrl as string).searchParams.get("token");
    const firstConfirmation = await callApi(env, "/api/v1/events/pqc-2026/registrations/confirm-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: registrationId,
        token: firstToken,
        organization: await confirmationOrganization(firstToken!),
      }),
    });
    expect(firstConfirmation.status).toBe(200);
    expect(await firstConfirmation.json()).toMatchObject({ stage: "confirmed" });

    await expect(
      materializeQueuedCapabilityLinks(
        env.DB,
        env,
        JSON.parse(recoveryRows[0].payload_json) as Record<string, unknown>,
      ),
    ).rejects.toMatchObject({ code: "CAPABILITY_RESOURCE_STALE" });

    await expect(
      queryAll<{ recipient_email: string }>(
        env.DB,
        `SELECT recipient_email FROM email_outbox
          WHERE template_key = 'registration_email_change'
          AND recipient_email = 'resendtest@pkic.org'`,
      ),
    ).resolves.toEqual([]);
    await expect(
      queryAll<{ recipient_email: string }>(
        env.DB,
        `SELECT recipient_email FROM email_outbox
          WHERE template_key = 'registration_email_change_notice'
          AND recipient_email = 'resendtest@pkic.org'`,
      ),
    ).resolves.toEqual([{ recipient_email: "resendtest@pkic.org" }]);
  });

  it("reactivates a cancelled registration when the attendee registers again", async () => {
    await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, ADMINISTRATOR_FIXTURE_USER_SQL))[0];
    await seedWorkflowEmailTemplates(env.DB, admin.id);

    await registerAttendee();
    const registration = (
      await queryAll<{ id: string }>(
        env.DB,
        "SELECT id FROM registrations WHERE status = 'pending_email_confirmation' LIMIT 1",
      )
    )[0];
    await env.DB.prepare("UPDATE registrations SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?")
      .bind(registration.id)
      .run();

    const response = await callApi(env, "/api/v1/events/pqc-2026/registrations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        firstName: "Test",
        lastName: "User",
        email: "resendtest@pkic.org",
        dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "virtual" }],
        sourceType: "direct",
        consents: [
          { termKey: "privacy-policy", version: "v1" },
          { termKey: "code-of-conduct", version: "v1" },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { registrationId: string; status: string };
    expect(body.registrationId).toBe(registration.id);
    expect(body.status).toBe("pending_email_confirmation");

    const audit = await queryAll<{ action: string }>(
      env.DB,
      "SELECT action FROM audit_log WHERE entity_id = ? ORDER BY created_at DESC LIMIT 1",
      [registration.id],
    );
    expect(audit[0].action).toBe("registration_reactivated");
  });

  it("does not authorize a resend by registration ID after token verification fails", async () => {
    await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, ADMINISTRATOR_FIXTURE_USER_SQL))[0];
    await seedWorkflowEmailTemplates(env.DB, admin.id);

    const { registrationId } = await registerAttendee();
    const queuedBefore = (await queryAll<{ count: number }>(env.DB, "SELECT COUNT(*) AS count FROM email_outbox"))[0]
      .count;

    const invalidResponse = await callApi(env, "/api/v1/events/pqc-2026/registrations/resend-confirmation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: registrationId, token: "bogus-nonexistent-token" }),
    });
    expect(invalidResponse.status).toBe(404);
    await expect(invalidResponse.json()).resolves.toMatchObject({ error: { code: "RESEND_TOKEN_INVALID" } });
    const queuedAfter = (await queryAll<{ count: number }>(env.DB, "SELECT COUNT(*) AS count FROM email_outbox"))[0]
      .count;
    expect(queuedAfter).toBe(queuedBefore);
  });
});

describe("resend-manage-link endpoint", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await resetDb();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "msg-1" } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function setupRepresentationRecipient() {
    await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, ADMINISTRATOR_FIXTURE_USER_SQL);
    await seedWorkflowEmailTemplates(env.DB, admin.id);
    const registered = await registerAttendee();
    const [{ user_id: userId }] = await queryAll<{ user_id: string }>(
      env.DB,
      "SELECT user_id FROM registrations WHERE id=?",
      [registered.registrationId],
    );
    const identity = await buildCreateIdentityStatement(env.DB, {
      userId,
      organizationId: await insertOrganization(env.DB, "Recovery representation"),
      source: "account",
      startImmediately: true,
    });
    const emailId = crypto.randomUUID();
    const at = new Date().toISOString();
    await env.DB.batch([
      identity.statement,
      env.DB.prepare(`INSERT INTO user_emails (id,user_id,email,normalized_email,verified_at,verification_method,created_at)
        VALUES (?,?,'work@example.test','work@example.test',?,'staff',?)`).bind(emailId, userId, at, at),
      env.DB.prepare("UPDATE identities SET email_id=? WHERE id=?").bind(emailId, identity.identityId),
      env.DB.prepare("UPDATE registrations SET registration_identity_id=?,status='registered' WHERE id=?").bind(
        identity.identityId,
        registered.registrationId,
      ),
    ]);
    return { ...registered, emailId, identityId: identity.identityId };
  }

  it("matches and delivers recovery to the verified representation address", async () => {
    await setupRepresentationRecipient();
    expect((await resendManageLink(env, "WORK@example.test")).status).toBe(200);
    expect(
      await queryAll(env.DB, "SELECT recipient_email FROM email_outbox WHERE template_key='registration_manage_link'"),
    ).toEqual([{ recipient_email: "work@example.test" }]);
  });

  it.each(["not started", "ended", "blocked"])(
    "uses the account mailbox after the representation is %s",
    async (state) => {
      const f = await setupRepresentationRecipient();
      const recoveryEnvironment = {
        ...env,
        EMAIL_RATE_LIMITER: createTestRateLimiter(100),
        IP_RATE_LIMITER: createTestRateLimiter(100),
      };
      const at = new Date().toISOString();
      // The identities constraint requires blocked identities to be ended too.
      await env.DB.prepare("UPDATE identities SET started_at=?, ended_at=?, blocked_at=? WHERE id=?")
        .bind(
          state === "not started" ? null : at,
          state === "ended" || state === "blocked" ? at : null,
          state === "blocked" ? at : null,
          f.identityId,
        )
        .run();
      const path = `/api/v1/registrations/access/${encodeURIComponent(f.manageToken)}`;
      const view = await callApi(env, path);
      expect(view.status).toBe(200);
      expect(registrationManageReadResponseSchema.parse(await view.json()).user.email).toBe(f.email);
      const updated = await callApi(env, path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update", firstName: "Updated" }),
      });
      expect(updated.status, await updated.clone().text()).toBe(200);
      expect(
        await queryAll(env.DB, "SELECT recipient_email FROM email_outbox WHERE template_key='registration_updated'"),
      ).toEqual([{ recipient_email: f.email }]);
      expect((await resendManageLink(recoveryEnvironment, "work@example.test")).status).toBe(200);
      expect(
        await queryAll(
          env.DB,
          "SELECT recipient_email FROM email_outbox WHERE template_key='registration_manage_link'",
        ),
      ).toHaveLength(0);
      expect((await resendManageLink(recoveryEnvironment, f.email)).status).toBe(200);
      expect(
        await queryAll(
          env.DB,
          "SELECT recipient_email FROM email_outbox WHERE template_key='registration_manage_link'",
        ),
      ).toEqual([{ recipient_email: f.email }]);
    },
  );

  it.each(["work@bücher.example", "WORK@xn--bcher-kva.example"])(
    "matches the stored normalized representation mailbox for %s",
    async (email) => {
      const f = await setupRepresentationRecipient();
      await env.DB.prepare("UPDATE user_emails SET email=?,normalized_email=? WHERE id=?")
        .bind("work@bücher.example", "work@xn--bcher-kva.example", f.emailId)
        .run();
      expect((await resendManageLink(env, email)).status).toBe(200);
      expect(
        await queryAll(
          env.DB,
          "SELECT recipient_email FROM email_outbox WHERE template_key='registration_manage_link'",
        ),
      ).toEqual([{ recipient_email: "work@bücher.example" }]);
    },
  );

  it("recovers through the account address when the registration uses another verified mailbox", async () => {
    const f = await setupRepresentationRecipient();
    expect((await resendManageLink(env, f.email)).status).toBe(200);
    expect(
      await queryAll(env.DB, "SELECT recipient_email FROM email_outbox WHERE template_key='registration_manage_link'"),
    ).toEqual([{ recipient_email: f.email }]);
  });

  it("uses the account address while registration awaits confirmation", async () => {
    const f = await setupRepresentationRecipient();
    await env.DB.prepare("UPDATE registrations SET status='pending_email_confirmation' WHERE id=?")
      .bind(f.registrationId)
      .run();
    const event = await getEventBySlug(env.DB, "pqc-2026");
    expect(
      await queueRegistrationManageLinkRecovery(env.DB, event, "work@example.test", "https://app.test"),
    ).toBeNull();
    expect(await queueRegistrationManageLinkRecovery(env.DB, event, f.email, "https://app.test")).not.toBeNull();
    expect(
      await queryAll(env.DB, "SELECT recipient_email FROM email_outbox WHERE template_key='registration_manage_link'"),
    ).toEqual([{ recipient_email: f.email }]);
  });

  it("suppresses recovery when the representation address changes before enqueueing", async () => {
    const f = await setupRepresentationRecipient();
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("INSERT") && sql.includes("email_outbox"),
      () => env.DB.prepare("UPDATE user_emails SET verified_at=NULL WHERE id=?").bind(f.emailId).run(),
    );
    expect(await queueRegistrationManageLinkRecovery(db, event, "work@example.test", "https://app.test")).toBeNull();
    expect(
      await queryAll(env.DB, "SELECT recipient_email FROM email_outbox WHERE template_key='registration_manage_link'"),
    ).toHaveLength(0);
  });

  it("sends a fresh manage link without invalidating the earlier link", async () => {
    await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, ADMINISTRATOR_FIXTURE_USER_SQL))[0];
    await seedWorkflowEmailTemplates(env.DB, admin.id);

    // Register + confirm
    const { registrationId, email, manageToken } = await registerAttendee();

    // Confirm the registration to make it "registered"
    await env.DB.prepare("UPDATE registrations SET status = 'registered', confirmation_link_secret = NULL WHERE id = ?")
      .bind(registrationId)
      .run();
    const secretBefore = (
      await queryAll<{ manage_link_secret: string }>(
        env.DB,
        "SELECT manage_link_secret FROM registrations WHERE id = ?",
        registrationId,
      )
    )[0].manage_link_secret;

    const response = await resendManageLink(env, email);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);

    const queued = (
      await queryAll<{ payload_json: string }>(
        env.DB,
        "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_manage_link' ORDER BY created_at DESC LIMIT 1",
      )
    )[0];
    const delivered = await materializeQueuedCapabilityLinks(
      env.DB,
      env,
      JSON.parse(queued.payload_json) as Record<string, unknown>,
    );
    const freshToken = new URL(delivered.manageUrl as string).searchParams.get("token") as string;
    expect(new URL(delivered.myAgendaUrl as string).hash).toMatch(/^#\/events\/[^/]+\/agenda\?mine=1$/);
    const [earlierRegistration, freshRegistration] = await Promise.all([
      getRegistrationByManageToken(env.DB, manageToken, signingSecret),
      getRegistrationByManageToken(env.DB, freshToken, signingSecret),
    ]);
    expect(earlierRegistration.id).toBe(registrationId);
    expect(freshRegistration.id).toBe(registrationId);
    const secretAfter = (
      await queryAll<{ manage_link_secret: string }>(
        env.DB,
        "SELECT manage_link_secret FROM registrations WHERE id = ?",
        registrationId,
      )
    )[0].manage_link_secret;
    expect(secretAfter).toBe(secretBefore);
  });

  it("never sends a manage capability to an unverified pending address", async () => {
    await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, ADMINISTRATOR_FIXTURE_USER_SQL))[0];
    await seedWorkflowEmailTemplates(env.DB, admin.id);
    const { registrationId, email } = await registerAttendee();

    const change = await organizerChangesEmail(registrationId, "unverified-pending@example.test");
    expect(change.status, await change.clone().text()).toBe(200);

    const before = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM email_outbox WHERE template_key = 'registration_manage_link'",
    );
    expect((await resendManageLink(env, "unverified-pending@example.test")).status).toBe(200);
    const afterPendingRequest = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM email_outbox WHERE template_key = 'registration_manage_link'",
    );
    expect(afterPendingRequest).toEqual(before);

    expect((await resendManageLink(env, email)).status).toBe(200);
    await expect(
      queryAll<{ recipient_email: string }>(
        env.DB,
        `SELECT recipient_email FROM email_outbox
          WHERE template_key = 'registration_manage_link'
          ORDER BY created_at DESC LIMIT 1`,
      ),
    ).resolves.toEqual([{ recipient_email: email }]);
  });

  it("returns success even for non-existent email (prevents enumeration)", async () => {
    await seedEventAndAdmin(env.DB);

    const response = await resendManageLink(env, "nobody@example.test");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it("rejects with invalid email format", async () => {
    await seedEventAndAdmin(env.DB);

    const response = await resendManageLink(env, "not-an-email");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("rate-limits repeated manage-link resends for the same email", async () => {
    await seedEventAndAdmin(env.DB);
    const limitedEnv = {
      ...env,
      EMAIL_RATE_LIMITER: createTestRateLimiter(3),
      IP_RATE_LIMITER: createTestRateLimiter(20),
    };
    const email = `rate-limit-${crypto.randomUUID()}@example.test`;

    const makeRequest = () => resendManageLink(limitedEnv, email);

    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(429);
  });
});
