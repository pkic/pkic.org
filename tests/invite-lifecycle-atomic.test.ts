import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { acceptInvite, declineInvite } from "../functions/_lib/services/invite-lifecycle";
import { resendInviteByAdmin } from "../functions/_lib/services/invite-resend";
import { getEventBySlug } from "../functions/_lib/services/events";
import { resetDb } from "./helpers/reset-db";
import { queryAll, seedEventAndAdmin } from "./helpers/context";

async function insertInvite(eventId: string, status: "sent" | "declined" = "sent"): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO invites (
       id, event_id, invitee_email, invitee_first_name, invite_type, link_secret,
       status, source_type, decline_reason_code, declined_at, created_at
     ) VALUES (?, ?, 'atomic-invite@example.test', 'Atomic', 'attendee', ?, ?, 'direct', ?, ?, ?)`,
  )
    .bind(
      id,
      eventId,
      crypto.randomUUID(),
      status,
      status === "declined" ? "other" : null,
      status === "declined" ? "2026-01-01T00:00:00.000Z" : null,
      "2026-01-01T00:00:00.000Z",
    )
    .run();
  return id;
}

describe("invite lifecycle aggregate", () => {
  let eventId: string;

  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(env.DB));
  });

  afterEach(async () => {
    await env.DB.prepare("DROP TRIGGER IF EXISTS fail_invite_resend_audit").run();
  });

  it("rolls back manual resend state and outbox when its audit cannot commit", async () => {
    const inviteId = await insertInvite(eventId, "declined");
    await env.DB.prepare(
      `CREATE TRIGGER fail_invite_resend_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'invite_resent'
       BEGIN
         SELECT RAISE(ABORT, 'forced invite resend audit failure');
       END`,
    ).run();

    const event = await getEventBySlug(env.DB, "pqc-2026");
    await expect(
      resendInviteByAdmin(env.DB, {
        event,
        inviteId,
        admin: { identityType: "service", id: "admin", email: "admin@pkic.org", role: "admin" },
        appBaseUrl: "https://app.test",
      }),
    ).rejects.toThrow("forced invite resend audit failure");

    const [invite] = await queryAll<{ status: string; decline_reason_code: string | null }>(
      env.DB,
      "SELECT status, decline_reason_code FROM invites WHERE id = ?",
      inviteId,
    );
    expect(invite).toEqual({ status: "declined", decline_reason_code: "other" });
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email = ?", "atomic-invite@example.test"),
    ).toHaveLength(0);
  });

  it("commits manual resend state, email intent, and audit together", async () => {
    const inviteId = await insertInvite(eventId, "declined");
    const event = await getEventBySlug(env.DB, "pqc-2026");
    await resendInviteByAdmin(env.DB, {
      event,
      inviteId,
      admin: { identityType: "service", id: "admin", email: "admin@pkic.org", role: "admin" },
      appBaseUrl: "https://app.test",
    });

    const [invite] = await queryAll<{ status: string; decline_reason_code: string | null }>(
      env.DB,
      "SELECT status, decline_reason_code FROM invites WHERE id = ?",
      inviteId,
    );
    expect(invite).toEqual({ status: "sent", decline_reason_code: null });
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email = ?", "atomic-invite@example.test"),
    ).toHaveLength(1);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'invite_resent' AND entity_id = ?", inviteId),
    ).toHaveLength(1);
  });

  it("allows only one concurrent terminal transition and never leaks decline fallout", async () => {
    const inviteId = await insertInvite(eventId);
    const results = await Promise.allSettled([
      acceptInvite(env.DB, inviteId),
      declineInvite(env.DB, {
        inviteId,
        reasonCode: "not_interested",
        unsubscribeFuture: true,
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);

    const [invite] = await queryAll<{ status: string }>(env.DB, "SELECT status FROM invites WHERE id = ?", inviteId);
    expect(["accepted", "declined"]).toContain(invite.status);
    const unsubscribes = await queryAll(
      env.DB,
      "SELECT id FROM unsubscribes WHERE email = ?",
      "atomic-invite@example.test",
    );
    expect(unsubscribes).toHaveLength(invite.status === "declined" ? 1 : 0);
  });
});
