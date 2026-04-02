/**
 * invite-accept-info-reminders.test.ts
 *
 * Covers:
 *  - GET  /api/v1/invites/:token/info       (positive, negative, edge cases)
 *  - POST /api/v1/invites/:token/accept      (speaker accept, attendee accept, negative)
 *  - POST /api/v1/invites/:token/reminders   (postpone, resume, unsubscribe)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { createContext, seedEventAndAdmin, queryAll } from "./helpers/context";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";
import { createInvite, declineInvite, acceptInvite } from "../functions/_lib/services/invites";
import { onRequestGet as inviteInfo } from "../functions/api/v1/invites/[token]/info";
import { onRequestPost as inviteAccept } from "../functions/api/v1/invites/[token]/accept";
import { onRequestPost as inviteReminders } from "../functions/api/v1/invites/[token]/reminders";

describe("invite info endpoint", () => {
  beforeEach(async () => { await resetDb(); });

  it("returns invite metadata for a valid pending attendee invite", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const { token } = await createInvite(env.DB, {
      eventId,
      inviteeEmail: "alice@example.test",
      inviteeFirstName: "Alice",
      inviteType: "attendee",
      ttlHours: 48,
    });

    const response = await inviteInfo(
      createContext(env, new Request(`https://app.test/api/v1/invites/${token}/info`), { token }),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      status: string;
      eventName: string | null;
      inviteeFirstName: string | null;
      inviteType: string;
      registrationUrl: string | null;
    };
    expect(body.status).toBe("valid");
    expect(body.eventName).toBe("PQC Conference 2026");
    expect(body.inviteeFirstName).toBe("Alice");
    expect(body.inviteType).toBe("attendee");
    expect(body.registrationUrl).toContain("invite=");
  });

  it("returns invite metadata for a valid pending speaker invite", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const { token } = await createInvite(env.DB, {
      eventId,
      inviteeEmail: "speaker@example.test",
      inviteeFirstName: "Bob",
      inviteType: "speaker",
      ttlHours: 48,
    });

    const response = await inviteInfo(
      createContext(env, new Request(`https://app.test/api/v1/invites/${token}/info`), { token }),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      status: string;
      inviteType: string;
      proposalUrl: string | null;
    };
    expect(body.status).toBe("valid");
    expect(body.inviteType).toBe("speaker");
    expect(body.proposalUrl).toContain("invite=");
  });

  it("returns 'invalid' for a non-existent token", async () => {
    await seedEventAndAdmin(env.DB);

    const response = await inviteInfo(
      createContext(env, new Request("https://app.test/api/v1/invites/bogus-token/info"), { token: "bogus-token" }),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { status: string };
    expect(body.status).toBe("invalid");
  });

  it("returns 'already_processed' for an accepted invite", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const { token, invite } = await createInvite(env.DB, {
      eventId,
      inviteeEmail: "done@example.test",
      inviteType: "attendee",
      ttlHours: 48,
    });

    await acceptInvite(env.DB, invite.id);

    const response = await inviteInfo(
      createContext(env, new Request(`https://app.test/api/v1/invites/${token}/info`), { token }),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { status: string };
    expect(body.status).toBe("already_processed");
  });

  it("returns 'already_processed' for a declined invite", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const { token, invite } = await createInvite(env.DB, {
      eventId,
      inviteeEmail: "declined@example.test",
      inviteType: "attendee",
      ttlHours: 48,
    });

    await declineInvite(env.DB, { inviteId: invite.id, reasonCode: "not_interested" });

    const response = await inviteInfo(
      createContext(env, new Request(`https://app.test/api/v1/invites/${token}/info`), { token }),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { status: string };
    expect(body.status).toBe("already_processed");
  });

  it("returns social-proof inviters list", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    // Create a user to be the inviter
    const inviterUserId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, role, active, created_at, updated_at)
       VALUES (?, 'inviter@example.test', 'inviter@example.test', 'Jane', 'Smith', 'Acme Corp', 'user', 1, datetime('now'), datetime('now'))`,
    ).bind(inviterUserId).run();

    const { token } = await createInvite(env.DB, {
      eventId,
      inviterUserId,
      inviteeEmail: "invitee@example.test",
      inviteeFirstName: "Invitee",
      inviteType: "attendee",
      ttlHours: 48,
    });

    const response = await inviteInfo(
      createContext(env, new Request(`https://app.test/api/v1/invites/${token}/info`), { token }),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      inviters: Array<{ firstName: string; lastName: string }>;
      totalInviters: number;
    };
    expect(body.totalInviters).toBeGreaterThanOrEqual(1);
    expect(body.inviters[0].firstName).toBe("Jane");
    expect(body.inviters[0].lastName).toBe("Smith");
  });
});

describe("invite accept endpoint", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await resetDb();
    fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 202, headers: { "x-message-id": "msg-1" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a speaker invite and returns proposal page URL", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const { token } = await createInvite(env.DB, {
      eventId,
      inviteeEmail: "speaker@example.test",
      inviteType: "speaker",
      ttlHours: 48,
    });

    const response = await inviteAccept(
      createContext(
        env,
        new Request(`https://app.test/api/v1/invites/${token}/accept`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
        { token },
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { success: boolean; inviteType: string; next: string };
    expect(body.success).toBe(true);
    expect(body.inviteType).toBe("speaker");
    expect(body.next).toContain("propose");
  });

  it("accepts an attendee invite with valid consents", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const adminUser = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
    await seedWorkflowEmailTemplates(env.DB, adminUser.id);

    const { token } = await createInvite(env.DB, {
      eventId,
      inviteeEmail: "attendee@example.test",
      inviteeFirstName: "Alice",
      inviteType: "attendee",
      ttlHours: 48,
    });

    const response = await inviteAccept(
      createContext(
        env,
        new Request(`https://app.test/api/v1/invites/${token}/accept`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "attendee@example.test",
            firstName: "Alice",
            lastName: "Test",
            attendanceType: "virtual",
            consents: [
              { termKey: "privacy-policy", version: "v1" },
              { termKey: "code-of-conduct", version: "v1" },
            ],
          }),
        }),
        { token },
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      success: boolean;
      registrationId: string;
      status: string;
      shareUrl: string;
    };
    expect(body.success).toBe(true);
    expect(body.registrationId).toBeTruthy();
    expect(body.shareUrl).toContain("/r/");
  });

  it("rejects attendee accept with mismatched email", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const { token } = await createInvite(env.DB, {
      eventId,
      inviteeEmail: "real@example.test",
      inviteType: "attendee",
      ttlHours: 48,
    });

    const response = await inviteAccept(
      createContext(
        env,
        new Request(`https://app.test/api/v1/invites/${token}/accept`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "wrong@example.test",
            firstName: "Alice",
            lastName: "Test",
            attendanceType: "virtual",
            consents: [
              { termKey: "privacy-policy", version: "v1" },
              { termKey: "code-of-conduct", version: "v1" },
            ],
          }),
        }),
        { token },
      ),
    );

    expect(response.status).toBe(400);
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe("EMAIL_MISMATCH");
  });

  it("rejects accept with invalid/non-existent token", async () => {
    await seedEventAndAdmin(env.DB);

    await expect(
      inviteAccept(
        createContext(
          env,
          new Request("https://app.test/api/v1/invites/bogus-token/accept", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          }),
          { token: "bogus-token" },
        ),
      ),
    ).rejects.toMatchObject({ code: "INVITE_NOT_FOUND" });
  });
});

describe("invite reminders endpoint", () => {
  beforeEach(async () => { await resetDb(); });

  it("postpones reminders for 7 days", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const { token } = await createInvite(env.DB, {
      eventId,
      inviteeEmail: "remind@example.test",
      inviteType: "attendee",
      ttlHours: 48,
    });

    const response = await inviteReminders(
      createContext(
        env,
        new Request(`https://app.test/api/v1/invites/${token}/reminders`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "postpone_7d" }),
        }),
        { token },
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { success: boolean; state: string; pausedUntil: string };
    expect(body.success).toBe(true);
    expect(body.state).toBe("postponed");
    expect(body.pausedUntil).toBeTruthy();
  });

  it("postpones reminders for 30 days", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const { token } = await createInvite(env.DB, {
      eventId,
      inviteeEmail: "remind30@example.test",
      inviteType: "attendee",
      ttlHours: 48,
    });

    const response = await inviteReminders(
      createContext(
        env,
        new Request(`https://app.test/api/v1/invites/${token}/reminders`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "pause_30d" }),
        }),
        { token },
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { success: boolean; state: string };
    expect(body.success).toBe(true);
    expect(body.state).toBe("paused");
  });

  it("resumes reminders after pausing", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const { token } = await createInvite(env.DB, {
      eventId,
      inviteeEmail: "resume@example.test",
      inviteType: "attendee",
      ttlHours: 48,
    });

    // Pause first
    await inviteReminders(
      createContext(
        env,
        new Request(`https://app.test/api/v1/invites/${token}/reminders`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "postpone_7d" }),
        }),
        { token },
      ),
    );

    // Then resume
    const response = await inviteReminders(
      createContext(
        env,
        new Request(`https://app.test/api/v1/invites/${token}/reminders`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "resume" }),
        }),
        { token },
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { success: boolean; state: string };
    expect(body.success).toBe(true);
    expect(body.state).toBe("active");
  });

  it("unsubscribes by declining the invite", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const { token, invite } = await createInvite(env.DB, {
      eventId,
      inviteeEmail: "unsub@example.test",
      inviteType: "attendee",
      ttlHours: 48,
    });

    const response = await inviteReminders(
      createContext(
        env,
        new Request(`https://app.test/api/v1/invites/${token}/reminders`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "unsubscribe" }),
        }),
        { token },
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { success: boolean; state: string };
    expect(body.success).toBe(true);
    expect(body.state).toBe("unsubscribed");

    // Verify invite is declined in DB
    const row = await queryAll<{ status: string }>(env.DB, "SELECT status FROM invites WHERE id = ?", [invite.id]);
    expect(row[0].status).toBe("declined");
  });

  it("rejects with invalid token", async () => {
    await seedEventAndAdmin(env.DB);

    await expect(
      inviteReminders(
        createContext(
          env,
          new Request("https://app.test/api/v1/invites/bad-token/reminders", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "resume" }),
          }),
          { token: "bad-token" },
        ),
      ),
    ).rejects.toMatchObject({ code: "INVITE_NOT_FOUND" });
  });
});
