import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { materializeQueuedCapabilityLinks } from "../functions/_lib/services/capability-links";
import { createInvite, findInviteByToken } from "../functions/_lib/services/invites";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";
import { resetDb } from "./helpers/reset-db";
import { callApi } from "./helpers/app";

const signingSecret = "invite-resend-test-signing-secret";

function resendInviteLink(testEnv: typeof env, body: unknown): Promise<Response> {
  return callApi(testEnv, "/api/v1/invites/resend-link", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.50" },
    body: JSON.stringify(body),
  });
}

describe("invite resend-link endpoint", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "msg-1" } })),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("queues a fresh pending invitation and invalidates the earlier link generation", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
    await seedWorkflowEmailTemplates(env.DB, admin.id);
    const created = await createInvite(env.DB, {
      eventId,
      inviterUserId: admin.id,
      inviteeEmail: "invite-recovery@example.test",
      inviteeFirstName: "Invite",
      inviteeLastName: "Recovery",
      inviteType: "attendee",
      sourceType: "test",
      signingSecret,
    });
    const testEnv = { ...env, INTERNAL_SIGNING_SECRET: signingSecret };

    const response = await resendInviteLink(testEnv, { email: "invite-recovery@example.test" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    const queued = (
      await queryAll<{ payload_json: string }>(
        env.DB,
        "SELECT payload_json FROM email_outbox WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 1",
        "invite-recovery@example.test",
      )
    )[0];
    const delivered = await materializeQueuedCapabilityLinks(
      env.DB,
      testEnv,
      JSON.parse(queued.payload_json) as Record<string, unknown>,
    );
    const freshToken = new URL(delivered.registrationUrl as string).searchParams.get("invite")!;

    await expect(findInviteByToken(env.DB, created.token, signingSecret, created.invite.id)).rejects.toMatchObject({
      code: "INVITE_NOT_FOUND",
    });
    await expect(findInviteByToken(env.DB, freshToken, signingSecret, created.invite.id)).resolves.toMatchObject({
      id: created.invite.id,
    });
  });

  it("returns the same success response when no invitation matches", async () => {
    const response = await resendInviteLink(
      { ...env, INTERNAL_SIGNING_SECRET: signingSecret },
      {
        email: "missing@example.test",
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("rejects invalid input through the mounted shared route contract", async () => {
    const response = await resendInviteLink({ ...env, INTERNAL_SIGNING_SECRET: signingSecret }, { email: "not-email" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });
});
