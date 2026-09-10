/**
 * Sending every participant of a meeting their own link to it (#6).
 *
 * The consortium wanted to know who actually comes to a meeting, and a link
 * that one person forwards to a colleague cannot answer that. What goes out
 * is the occurrence's own join page: personal not because it carries a secret
 * but because entering it needs the recipient's session, so the attendance it
 * writes is theirs and a forwarded copy admits nobody.
 *
 * Sending again is a numbered round, which is what lets a reminder exist
 * without becoming a duplicate — and what stops two managers pressing send at
 * the same moment from mailing the group twice.
 */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createGroupEventSeries,
  createSeriesOccurrence,
  sendMeetingParticipantInvitations,
} from "../functions/_lib/services/event-series";
import { AppError } from "../functions/_lib/errors";
import type { AuthAdmin } from "../functions/_lib/types";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { ensureGroupMembershipCapacity } from "./helpers/group-leadership";
import { insertUser } from "./helpers/membership";
import { queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

const GROUP_ID = "20000000-0000-4000-8000-000000000003";
const ENCRYPTION_SECRET = "meeting-participant-invitation-encryption-secret-0";
const APP_BASE_URL = "https://app.test";

interface OutboxRow {
  recipient_email: string;
  idempotency_key: string;
  payload_json: string;
}

function outboxRows(): Promise<OutboxRow[]> {
  return queryAll<OutboxRow>(
    env.DB,
    `SELECT recipient_email, idempotency_key, payload_json
       FROM email_outbox
      WHERE template_key = 'meeting-participant-invitation'
      ORDER BY recipient_email`,
  );
}

describe("meeting participant invitations", () => {
  let admin: AuthAdmin;
  let seriesId: string;
  let occurrenceId: string;

  async function seatParticipant(email: string): Promise<string> {
    const userId = await insertUser(env.DB, email);
    await ensureGroupMembershipCapacity(env.DB, GROUP_ID, userId);
    return userId;
  }

  beforeEach(async () => {
    await resetDb();
    const adminId = await insertUser(env.DB, `meeting-round-admin-${crypto.randomUUID()}@example.test`);
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(adminId).run();
    admin = { identityType: "user", id: adminId, email: "meeting-round-admin@example.test", role: "admin" };

    const startsAt = new Date(Date.now() + 3_600_000).toISOString();
    const series = await createGroupEventSeries(env.DB, admin, GROUP_ID, {
      eventName: "Quarterly working session",
      eventSlug: `participant-links-${crypto.randomUUID()}`,
      profileKey: "meeting",
      policy: {
        registrationPolicy: "no_registration",
        memberEligibility: "owner_group",
        guestPolicy: "occurrence_invitation",
      },
      startsAt,
      recurrenceRule: "FREQ=WEEKLY;COUNT=2",
      timezone: "UTC",
      durationMinutes: 60,
      location: "Online",
      providerType: "external_url",
    });
    seriesId = series.id;
    const occurrence = await createSeriesOccurrence(
      env.DB,
      admin,
      GROUP_ID,
      series.id,
      {
        startsAt,
        endsAt: new Date(Date.now() + 7_200_000).toISOString(),
        providerJoinUrl: "https://meet.example.test/quarterly-room",
      },
      ENCRYPTION_SECRET,
    );
    occurrenceId = occurrence.id;
  });

  it("queues one link per participant, and the link is the occurrence's join page", async () => {
    await seatParticipant("first-participant@example.test");
    await seatParticipant("second-participant@example.test");

    const result = await sendMeetingParticipantInvitations(
      env.DB,
      admin,
      GROUP_ID,
      seriesId,
      occurrenceId,
      APP_BASE_URL,
    );

    expect(result).toMatchObject({ round: 1, recipientCount: 2 });
    const queued = await outboxRows();
    expect(queued.map((row) => row.recipient_email)).toEqual([
      "first-participant@example.test",
      "second-participant@example.test",
    ]);
    /*
     * The same address for everybody, deliberately. A per-person secret in a
     * mailbox is the thing that gets forwarded; this one is only usable by
     * whoever can sign in, and the sign-in is what names the attendee.
     */
    for (const row of queued) {
      expect(JSON.parse(row.payload_json).joinUrl).toBe(
        `${APP_BASE_URL}/meetings/join/?occurrence=${encodeURIComponent(occurrenceId)}`,
      );
    }
    // Recorded on the occurrence, so the surface can say when a round went.
    expect(
      await queryAll<{ invitations_round: number; invitations_sent_at: string | null }>(
        env.DB,
        "SELECT invitations_round, invitations_sent_at FROM event_occurrences WHERE id = ?",
        occurrenceId,
      ),
    ).toEqual([{ invitations_round: 1, invitations_sent_at: result.sentAt }]);
  });

  it("sends a reminder as a second round rather than as a duplicate of the first", async () => {
    const userId = await seatParticipant("reminded@example.test");

    const first = await sendMeetingParticipantInvitations(
      env.DB,
      admin,
      GROUP_ID,
      seriesId,
      occurrenceId,
      APP_BASE_URL,
    );
    const second = await sendMeetingParticipantInvitations(
      env.DB,
      admin,
      GROUP_ID,
      seriesId,
      occurrenceId,
      APP_BASE_URL,
    );

    expect([first.round, second.round]).toEqual([1, 2]);
    // Two messages, each keyed to its own round: the outbox deduplicates a
    // retried request, not a deliberate reminder.
    expect((await outboxRows()).map((row) => row.idempotency_key)).toEqual([
      `meeting-participant-invitation:${occurrenceId}:${userId}:1`,
      `meeting-participant-invitation:${occurrenceId}:${userId}:2`,
    ]);
  });

  it("mails the group once when two managers send the same round at the same moment", async () => {
    await seatParticipant("concurrent@example.test");

    const outcomes = await Promise.allSettled([
      sendMeetingParticipantInvitations(env.DB, admin, GROUP_ID, seriesId, occurrenceId, APP_BASE_URL),
      sendMeetingParticipantInvitations(env.DB, admin, GROUP_ID, seriesId, occurrenceId, APP_BASE_URL),
    ]);

    /*
     * Both read round 0 and both try to claim round 1; only one claim can
     * match, and the batch that loses takes its queued messages with it. So
     * the participant is written to once, never twice for the same round.
     */
    const rounds = outcomes
      .filter((outcome) => outcome.status === "fulfilled")
      .map((outcome) => (outcome as PromiseFulfilledResult<{ round: number }>).value.round);
    expect(new Set(rounds).size).toBe(rounds.length);
    const keys = (await outboxRows()).map((row) => row.idempotency_key);
    expect(keys).toEqual(rounds.map((round) => expect.stringMatching(new RegExp(`:${String(round)}$`))));
    expect(new Set(keys).size).toBe(keys.length);
    // Whatever survived is what the occurrence records.
    expect(
      await queryAll<{ invitations_round: number }>(
        env.DB,
        "SELECT invitations_round FROM event_occurrences WHERE id = ?",
        occurrenceId,
      ),
    ).toEqual([{ invitations_round: Math.max(...rounds) }]);
  });

  it("queues nothing when the round it read was claimed while it was preparing", async () => {
    await seatParticipant("raced@example.test");
    const gate = gateNextBatch(env.DB);

    const racing = sendMeetingParticipantInvitations(gate.db, admin, GROUP_ID, seriesId, occurrenceId, APP_BASE_URL);
    await gate.reached;
    // Somebody else's round lands between this one's read and its write.
    await sendMeetingParticipantInvitations(env.DB, admin, GROUP_ID, seriesId, occurrenceId, APP_BASE_URL);
    gate.release();

    // The claim no longer matches, so the whole batch goes — including every
    // message it had queued. Nobody is written to twice for one round.
    await expect(racing).rejects.toThrow();
    const queued = await outboxRows();
    expect(queued).toHaveLength(1);
    expect(queued[0].idempotency_key).toBe(
      `meeting-participant-invitation:${occurrenceId}:${
        (
          await queryAll<{ id: string }>(
            env.DB,
            "SELECT id FROM users WHERE normalized_email = ?",
            "raced@example.test",
          )
        )[0].id
      }:1`,
    );
    expect(
      await queryAll<{ invitations_round: number }>(
        env.DB,
        "SELECT invitations_round FROM event_occurrences WHERE id = ?",
        occurrenceId,
      ),
    ).toEqual([{ invitations_round: 1 }]);
  });

  it("refuses a meeting nobody participates in, rather than reporting an empty send", async () => {
    await expect(
      sendMeetingParticipantInvitations(env.DB, admin, GROUP_ID, seriesId, occurrenceId, APP_BASE_URL),
    ).rejects.toMatchObject({ status: 409, code: "EVENT_OCCURRENCE_NO_PARTICIPANTS" });
    expect(await outboxRows()).toEqual([]);
  });

  it("refuses a cancelled meeting", async () => {
    await seatParticipant("cancelled-meeting@example.test");
    await env.DB.prepare("UPDATE event_occurrences SET status = 'cancelled' WHERE id = ?").bind(occurrenceId).run();

    const failure = await sendMeetingParticipantInvitations(
      env.DB,
      admin,
      GROUP_ID,
      seriesId,
      occurrenceId,
      APP_BASE_URL,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ status: 409, code: "EVENT_OCCURRENCE_NOT_SCHEDULED" });
    expect(await outboxRows()).toEqual([]);
  });

  it("refuses a meeting that has already ended", async () => {
    await seatParticipant("past-meeting@example.test");
    await env.DB.prepare("UPDATE event_occurrences SET starts_at = ?, ends_at = ? WHERE id = ?")
      .bind(
        new Date(Date.now() - 7_200_000).toISOString(),
        new Date(Date.now() - 3_600_000).toISOString(),
        occurrenceId,
      )
      .run();

    await expect(
      sendMeetingParticipantInvitations(env.DB, admin, GROUP_ID, seriesId, occurrenceId, APP_BASE_URL),
    ).rejects.toMatchObject({ status: 409, code: "EVENT_OCCURRENCE_ALREADY_ENDED" });
    expect(await outboxRows()).toEqual([]);
  });

  it("does not write to somebody who has left the group", async () => {
    await seatParticipant("still-here@example.test");
    const departedId = await seatParticipant("moved-on@example.test");
    await env.DB.prepare("UPDATE group_memberships SET left_at = datetime('now') WHERE group_id = ? AND user_id = ?")
      .bind(GROUP_ID, departedId)
      .run();

    const result = await sendMeetingParticipantInvitations(
      env.DB,
      admin,
      GROUP_ID,
      seriesId,
      occurrenceId,
      APP_BASE_URL,
    );

    expect(result.recipientCount).toBe(1);
    expect((await outboxRows()).map((row) => row.recipient_email)).toEqual(["still-here@example.test"]);
  });
});
