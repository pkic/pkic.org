import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { DatabaseLike, StatementLike } from "../functions/_lib/types";
import { recoverInviteLinksByEmail } from "../functions/_lib/services/invite-link-recovery";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

const recipientEmail = "bounded-recovery@example.test";

function eventInsert(eventId: string, index: number): StatementLike {
  return env.DB.prepare(
    `INSERT INTO events (
       id, slug, name, timezone, starts_at, ends_at, capacity_in_person,
       registration_mode, invite_limit_attendee, settings_json, created_at, updated_at
     ) VALUES (?, ?, ?, 'UTC', NULL, NULL, NULL, 'invite_or_open', 5, '{}', datetime('now'), datetime('now'))`,
  ).bind(eventId, `recovery-event-${index}`, `Recovery Event ${index}`);
}

function inviteInsert(
  inviteId: string,
  eventId: string,
  createdAt: string,
  status: "sent" | "expired" = "expired",
): StatementLike {
  return env.DB.prepare(
    `INSERT INTO invites (
       id, event_id, invitee_email, invite_type, link_secret, status, source_type,
       expires_at, last_communication_at, created_at
     ) VALUES (?, ?, ?, 'attendee', ?, ?, 'test', ?, ?, ?)`,
  ).bind(inviteId, eventId, recipientEmail, crypto.randomUUID(), status, createdAt, createdAt, createdAt);
}

describe("invite link recovery service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(async () => {
    await env.DB.prepare("DROP TRIGGER IF EXISTS fail_invite_recovery_outbox").run();
  });

  it("recovers twenty invitations with four prepared D1 statements", async () => {
    const statements: StatementLike[] = [];
    for (let index = 0; index < 20; index += 1) {
      const eventId = crypto.randomUUID();
      statements.push(eventInsert(eventId, index));
      statements.push(
        inviteInsert(crypto.randomUUID(), eventId, `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`),
      );
    }
    await env.DB.batch(statements);

    let prepareCount = 0;
    const countedDb: DatabaseLike = {
      prepare(query) {
        prepareCount += 1;
        return env.DB.prepare(query);
      },
      batch(batchStatements) {
        return env.DB.batch(batchStatements);
      },
    };

    const outboxIds = await recoverInviteLinksByEmail(countedDb, recipientEmail, "https://app.test");

    expect(outboxIds).toHaveLength(20);
    expect(prepareCount).toBe(4);
    await expect(
      queryAll<{ count: number }>(env.DB, "SELECT COUNT(*) AS count FROM invites WHERE status = 'sent'"),
    ).resolves.toEqual([{ count: 20 }]);
    await expect(
      queryAll<{ count: number }>(env.DB, "SELECT COUNT(*) AS count FROM email_outbox WHERE recipient_email = ?", [
        recipientEmail,
      ]),
    ).resolves.toEqual([{ count: 20 }]);
    const payloads = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE recipient_email = ?",
      [recipientEmail],
    );
    expect(payloads.every(({ payload_json }) => !("__subjectOverride" in JSON.parse(payload_json)))).toBe(true);
  });

  it("recovers only the newest expired invitation for one event and type", async () => {
    const eventId = crypto.randomUUID();
    const olderId = crypto.randomUUID();
    const newerId = crypto.randomUUID();
    await env.DB.batch([
      eventInsert(eventId, 1),
      inviteInsert(olderId, eventId, "2026-01-01T00:00:00.000Z"),
      inviteInsert(newerId, eventId, "2026-02-01T00:00:00.000Z"),
    ]);

    const outboxIds = await recoverInviteLinksByEmail(env.DB, recipientEmail, "https://app.test");

    expect(outboxIds).toHaveLength(1);
    await expect(
      queryAll<{ id: string; status: string }>(env.DB, "SELECT id, status FROM invites ORDER BY created_at"),
    ).resolves.toEqual([
      { id: olderId, status: "expired" },
      { id: newerId, status: "sent" },
    ]);
  });

  it("rolls back invitation state when the durable email intent cannot commit", async () => {
    const eventId = crypto.randomUUID();
    const inviteId = crypto.randomUUID();
    await env.DB.batch([eventInsert(eventId, 1), inviteInsert(inviteId, eventId, "2026-01-01T00:00:00.000Z")]);
    await env.DB.prepare(
      `CREATE TRIGGER fail_invite_recovery_outbox
       BEFORE INSERT ON email_outbox
       WHEN NEW.recipient_email = '${recipientEmail}'
       BEGIN
         SELECT RAISE(ABORT, 'forced invite recovery outbox failure');
       END`,
    ).run();

    await expect(recoverInviteLinksByEmail(env.DB, recipientEmail, "https://app.test")).rejects.toThrow(
      "forced invite recovery outbox failure",
    );
    await expect(
      queryAll<{ status: string; last_communication_at: string }>(
        env.DB,
        "SELECT status, last_communication_at FROM invites WHERE id = ?",
        [inviteId],
      ),
    ).resolves.toEqual([{ status: "expired", last_communication_at: "2026-01-01T00:00:00.000Z" }]);
    await expect(queryAll(env.DB, "SELECT id FROM email_outbox")).resolves.toHaveLength(0);
  });

  it("suppresses stale recovery fallout when acceptance wins the race", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const inviteId = crypto.randomUUID();
    await env.DB.batch([inviteInsert(inviteId, eventId, "2026-01-01T00:00:00.000Z", "sent")]);
    let injectedAcceptance = false;
    const racingDb: DatabaseLike = {
      prepare(query) {
        return env.DB.prepare(query);
      },
      async batch(statements) {
        if (!injectedAcceptance) {
          injectedAcceptance = true;
          await env.DB.prepare("UPDATE invites SET status = 'accepted', accepted_at = ? WHERE id = ?")
            .bind("2026-03-01T00:00:00.000Z", inviteId)
            .run();
        }
        return env.DB.batch(statements);
      },
    };

    await expect(recoverInviteLinksByEmail(racingDb, recipientEmail, "https://app.test")).resolves.toEqual([]);
    await expect(
      queryAll<{ status: string }>(env.DB, "SELECT status FROM invites WHERE id = ?", [inviteId]),
    ).resolves.toEqual([{ status: "accepted" }]);
    await expect(queryAll(env.DB, "SELECT id FROM email_outbox")).resolves.toHaveLength(0);
  });
});
