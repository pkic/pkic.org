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
import { onRequestPost as resendManageLink } from "../functions/api/v1/events/[eventSlug]/registrations/resend-manage-link";
import { sha256Hex } from "../functions/_lib/utils/crypto";

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

  // Get the confirmation token from the outbox
  const outbox = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_confirm_email' ORDER BY created_at DESC LIMIT 1",
  );
  const emailPayload = JSON.parse(outbox[0].payload_json) as { confirmationUrl: string };
  const confirmUrl = new URL(emailPayload.confirmationUrl);
  const registrationId = confirmUrl.searchParams.get("id") as string;
  const confirmationToken = confirmUrl.searchParams.get("token") as string;

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

  it("queues a fresh non-expiring confirmation email", async () => {
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
    const confirmationUrl = new URL(
      (JSON.parse(latestPayload.payload_json) as { confirmationUrl: string }).confirmationUrl,
    );
    const freshToken = confirmationUrl.searchParams.get("token") as string;
    const freshHash = await sha256Hex(freshToken);
    const registration = (
      await queryAll<{ confirmation_token_expires_at: string | null }>(
        env.DB,
        "SELECT confirmation_token_expires_at FROM registrations WHERE confirmation_token_hash = ? LIMIT 1",
        [freshHash],
      )
    )[0];
    expect(registration.confirmation_token_expires_at).toBeNull();

    const staleInfoResponse = await confirmInfo(
      createContext(
        env,
        new Request(
          `https://app.test/api/v1/events/pqc-2026/registrations/confirm-info?token=${encodeURIComponent(confirmationToken)}&id=${encodeURIComponent(registrationId)}`,
        ),
        { eventSlug: "pqc-2026" },
      ),
    );
    const staleInfo = (await staleInfoResponse.json()) as {
      email: string | null;
      expired: boolean;
      recoverable: boolean;
    };
    expect(staleInfo.email).toBeNull();
    expect(staleInfo.expired).toBe(true);
    expect(staleInfo.recoverable).toBe(true);

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

  it("rejects with an invalid token", async () => {
    await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
    await seedWorkflowEmailTemplates(env.DB, admin.id);

    await expect(
      resendConfirmation(
        createContext(
          env,
          new Request("https://app.test/api/v1/events/pqc-2026/registrations/resend-confirmation", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: "bogus-nonexistent-token" }),
          }),
          { eventSlug: "pqc-2026" },
        ),
      ),
    ).rejects.toMatchObject({ code: "RESEND_TOKEN_INVALID" });
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

  it("succeeds and rotates the manage token for a known registered email", async () => {
    await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
    await seedWorkflowEmailTemplates(env.DB, admin.id);

    // Register + confirm
    const { confirmationToken, email } = await registerAttendee();

    // Confirm the registration to make it "registered"
    const tokenHash = await sha256Hex(confirmationToken);
    const reg = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM registrations WHERE confirmation_token_hash = ? LIMIT 1",
      [tokenHash],
    );
    await env.DB.prepare("UPDATE registrations SET status = 'registered', confirmation_token_hash = NULL WHERE id = ?")
      .bind(reg[0].id)
      .run();

    const response = await resendManageLink(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations/resend-manage-link", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it("returns success even for non-existent email (prevents enumeration)", async () => {
    await seedEventAndAdmin(env.DB);

    const response = await resendManageLink(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations/resend-manage-link", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "nobody@example.test" }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it("rejects with invalid email format", async () => {
    await seedEventAndAdmin(env.DB);

    await expect(
      resendManageLink(
        createContext(
          env,
          new Request("https://app.test/api/v1/events/pqc-2026/registrations/resend-manage-link", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: "not-an-email" }),
          }),
          { eventSlug: "pqc-2026" },
        ),
      ),
    ).rejects.toBeTruthy();
  });

  it("rate-limits repeated manage-link resends for the same email", async () => {
    await seedEventAndAdmin(env.DB);
    const limitedEnv = {
      ...env,
      EMAIL_RATE_LIMITER: createTestRateLimiter(3),
      IP_RATE_LIMITER: createTestRateLimiter(20),
    };
    const email = `rate-limit-${crypto.randomUUID()}@example.test`;

    const makeRequest = () =>
      resendManageLink(
        createContext(
          limitedEnv,
          new Request("https://app.test/api/v1/events/pqc-2026/registrations/resend-manage-link", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "cf-connecting-ip": "203.0.113.20",
            },
            body: JSON.stringify({ email }),
          }),
          { eventSlug: "pqc-2026" },
        ),
      );

    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(200);
    await expect(makeRequest()).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
  });
});
