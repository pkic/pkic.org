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
import { createContext, createTestRateLimiter, seedEventAndAdmin, queryAll } from "./helpers/context";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";
import { onRequestPost as createRegistration } from "../functions/api/v1/events/[eventSlug]/registrations";
import { onRequestGet as confirmInfo } from "../functions/api/v1/events/[eventSlug]/registrations/confirm-info";
import { onRequestPost as resendConfirmation } from "../functions/api/v1/events/[eventSlug]/registrations/resend-confirmation";
import { issueDatabaseCapability, materializeQueuedCapabilityLinks } from "../functions/_lib/services/capability-links";
import { getRegistrationByManageToken } from "../functions/_lib/services/registrations";
import { callApi } from "./helpers/app";

const signingSecret = "test-signing-secret";

function resendManageLink(environment: typeof env, email: string, clientIp = "203.0.113.20"): Promise<Response> {
  return callApi(environment, "/api/v1/events/pqc-2026/registrations/resend-manage-link", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": clientIp },
    body: JSON.stringify({ email }),
  });
}

async function registerAttendee(): Promise<{
  confirmationToken: string;
  registrationId: string;
  email: string;
  manageToken: string;
}> {
  const response = await createRegistration(
    createContext(
      env,
      new Request("https://app.test/api/v1/events/pqc-2026/registrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName: "Test",
          lastName: "User",
          email: "resendtest@pkic.org",
          attendanceType: "virtual",
          sourceType: "direct",
          consents: [
            { termKey: "privacy-policy", version: "v1" },
            { termKey: "code-of-conduct", version: "v1" },
          ],
        }),
      }),
      { eventSlug: "pqc-2026" },
    ),
  );

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
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
    await seedWorkflowEmailTemplates(env.DB, admin.id);

    const { confirmationToken, registrationId } = await registerAttendee();

    const response = await confirmInfo(
      createContext(
        env,
        new Request(
          `https://app.test/api/v1/events/pqc-2026/registrations/confirm-info?token=${encodeURIComponent(confirmationToken)}&id=${encodeURIComponent(registrationId)}`,
        ),
        { eventSlug: "pqc-2026" },
      ),
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

  it("returns null values for an invalid/unknown token", async () => {
    await seedEventAndAdmin(env.DB);

    const response = await confirmInfo(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations/confirm-info?token=invalid-goes-here"),
        { eventSlug: "pqc-2026" },
      ),
    );

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

    const response = await confirmInfo(
      createContext(env, new Request("https://app.test/api/v1/events/pqc-2026/registrations/confirm-info"), {
        eventSlug: "pqc-2026",
      }),
    );

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
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
    await seedWorkflowEmailTemplates(env.DB, admin.id);

    const { confirmationToken, registrationId } = await registerAttendee();

    const response = await resendConfirmation(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations/resend-confirmation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: registrationId, token: confirmationToken }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

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

    const originalInfoResponse = await confirmInfo(
      createContext(
        env,
        new Request(
          `https://app.test/api/v1/events/pqc-2026/registrations/confirm-info?token=${encodeURIComponent(confirmationToken)}&id=${encodeURIComponent(registrationId)}`,
        ),
        { eventSlug: "pqc-2026" },
      ),
    );
    const originalInfo = (await originalInfoResponse.json()) as {
      email: string | null;
      expired: boolean;
      recoverable: boolean;
    };
    expect(originalInfo.email).toBe("resendtest@pkic.org");
    expect(originalInfo.expired).toBe(false);
    expect(originalInfo.recoverable).toBe(false);

    const freshInfoResponse = await confirmInfo(
      createContext(
        env,
        new Request(
          `https://app.test/api/v1/events/pqc-2026/registrations/confirm-info?token=${encodeURIComponent(freshToken)}&id=${encodeURIComponent(registrationId)}`,
        ),
        { eventSlug: "pqc-2026" },
      ),
    );
    expect((await freshInfoResponse.json()) as { email: string | null }).toMatchObject({
      email: "resendtest@pkic.org",
    });

    const staleResponse = await resendConfirmation(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations/resend-confirmation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: registrationId, token: confirmationToken }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );
    expect(staleResponse.status).toBe(200);
  });

  it("reactivates a cancelled registration when the attendee registers again", async () => {
    await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
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

    const response = await createRegistration(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: "Test",
            lastName: "User",
            email: "resendtest@pkic.org",
            attendanceType: "virtual",
            sourceType: "direct",
            consents: [
              { termKey: "privacy-policy", version: "v1" },
              { termKey: "code-of-conduct", version: "v1" },
            ],
          }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

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
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
    await seedWorkflowEmailTemplates(env.DB, admin.id);

    const { registrationId } = await registerAttendee();
    const queuedBefore = (await queryAll<{ count: number }>(env.DB, "SELECT COUNT(*) AS count FROM email_outbox"))[0]
      .count;

    await expect(
      resendConfirmation(
        createContext(
          env,
          new Request("https://app.test/api/v1/events/pqc-2026/registrations/resend-confirmation", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: registrationId, token: "bogus-nonexistent-token" }),
          }),
          { eventSlug: "pqc-2026" },
        ),
      ),
    ).rejects.toMatchObject({ code: "RESEND_TOKEN_INVALID" });
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

  it("sends a fresh manage link without invalidating the earlier link", async () => {
    await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
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
