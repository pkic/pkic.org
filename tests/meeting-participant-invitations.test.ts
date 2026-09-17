import { configureMeetingOccurrence } from "./helpers/meeting-occurrence";
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
  cancelGroupEventSeries,
  createGroupEventSeries,
  listOccurrenceInvitations,
  sendMeetingParticipantInvitations,
  updateSeriesOccurrence,
} from "../functions/_lib/services/event-series";
import { recordCalendarRsvpEvent } from "../functions/_lib/services/calendar-rsvp";
import { verifySignedRsvpAddressFull } from "../functions/_lib/email/rsvp";
import { AppError } from "../functions/_lib/errors";
import type { AuthAdmin, StatementLike } from "../functions/_lib/types";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { runAutomaticMeetingInvitations } from "../functions/_lib/services/event-series/automatic-invitations";
import { buildCreateIndividualMemberStatements } from "../functions/_lib/services/membership/memberships";
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
    const occurrence = await configureMeetingOccurrence(
      env.DB,
      admin,
      GROUP_ID,
      series.id,
      {
        startsAt,
        endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString(),
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

  it("writes a round for a group larger than one statement per recipient could, in a few chunk inserts", async () => {
    // 450 seats: past the 400 the old per-recipient statement shape refused
    // (#100). Seated directly rather than through the capacity helper, which
    // takes several round trips per person.
    const now = new Date().toISOString();
    const statements: StatementLike[] = [];
    for (let index = 0; index < 450; index += 1) {
      const userId = crypto.randomUUID();
      const email = `bulk-${index}@example.test`;
      const member = buildCreateIndividualMemberStatements(env.DB, userId, "H5", now);
      const identity = await buildCreateIdentityStatement(env.DB, {
        userId,
        organizationId: null,
        source: "staff",
        startImmediately: true,
        now,
      });
      statements.push(
        env.DB.prepare(
          `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
           VALUES (?, ?, ?, 'user', 1, ?, ?)`,
        ).bind(userId, email, email, now, now),
        ...member.statements,
        identity.statement,
        env.DB.prepare(
          `INSERT INTO group_memberships (id, group_id, user_id, identity_id, member_id, source, joined_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'staff', ?, ?, ?)`,
        ).bind(crypto.randomUUID(), GROUP_ID, userId, identity.identityId, member.memberId, now, now, now),
      );
    }
    for (let offset = 0; offset < statements.length; offset += 500) {
      await env.DB.batch(statements.slice(offset, offset + 500));
    }

    const result = await sendMeetingParticipantInvitations(
      env.DB,
      admin,
      GROUP_ID,
      seriesId,
      occurrenceId,
      APP_BASE_URL,
    );

    expect(result).toMatchObject({ round: 1, recipientCount: 450 });
    expect((await outboxRows()).length).toBe(450);
  });

  it("invites every group member to an automatic meeting once, and a newcomer when they join", async () => {
    const first = await seatParticipant("auto-first@example.test");
    const startsAt = new Date(Date.now() + 86_400_000).toISOString();
    const automatic = await createGroupEventSeries(env.DB, admin, GROUP_ID, {
      eventName: "Automatic standing call",
      eventSlug: `automatic-${crypto.randomUUID()}`,
      profileKey: "meeting",
      policy: { registrationPolicy: "automatic", memberEligibility: "owner_group", guestPolicy: "none" },
      startsAt,
      recurrenceRule: "FREQ=WEEKLY;COUNT=2",
      timezone: "UTC",
      durationMinutes: 60,
      location: "Online",
      providerType: "external_url",
    });
    await configureMeetingOccurrence(
      env.DB,
      admin,
      GROUP_ID,
      automatic.id,
      {
        startsAt,
        endsAt: new Date(Date.now() + 90_000_000).toISOString(),
        providerJoinUrl: "https://meet.example.test/auto",
      },
      ENCRYPTION_SECRET,
    );

    // The reconciliation pass owes the seated participant one link; running
    // it again owes nothing (#103).
    expect(
      await runAutomaticMeetingInvitations(env.DB, APP_BASE_URL, 20, undefined, {
        signingSecret: "test-signing-secret",
      }),
    ).toEqual({ queued: 1 });
    expect(
      await runAutomaticMeetingInvitations(env.DB, APP_BASE_URL, 20, undefined, {
        signingSecret: "test-signing-secret",
      }),
    ).toEqual({ queued: 0 });
    const links = await queryAll<{ recipient_email: string; idempotency_key: string; payload_json: string }>(
      env.DB,
      `SELECT recipient_email, idempotency_key, payload_json FROM email_outbox
        WHERE template_key = 'meeting-series-invitation'`,
    );
    expect(links.map((row) => row.recipient_email)).toEqual(["auto-first@example.test"]);
    expect(links[0].idempotency_key).toMatch(
      new RegExp(`^meeting-series-invitation:${automatic.id}:auto-first@example.test:`),
    );
    expect(JSON.parse(links[0].payload_json).joinUrl).toBe(
      `${APP_BASE_URL}/portal/#/groups/${GROUP_ID}/meetings/${automatic.id}`,
    );

    // A member who joins the group later is owed the upcoming meeting's link.
    await seatParticipant("auto-late@example.test");
    expect(
      await runAutomaticMeetingInvitations(env.DB, APP_BASE_URL, 20, undefined, {
        signingSecret: "test-signing-secret",
      }),
    ).toEqual({ queued: 1 });
    // The explicit-registration meeting from the fixture never enters the pass.
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE idempotency_key = ?", [
        `meeting-participant-invitation:${occurrenceId}:${first}:auto`,
      ]),
    ).toHaveLength(0);
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

  /*
   * The invitation is a calendar entry as well as a link (#126): it lands on
   * the recipient's calendar, and what the calendar answers comes back to
   * the occurrence through the signed organizer address.
   */
  describe("as a calendar invitation", () => {
    const SIGNING_SECRET = "meeting-rsvp-signing-secret";
    const NOTIFY = { appBaseUrl: APP_BASE_URL, signingSecret: SIGNING_SECRET, rsvpEmail: "rsvp@mail.test" };

    function calendarOf(row: OutboxRow): { method?: string; icsFiles: Array<{ content: string }> } {
      const calendar = JSON.parse(row.payload_json).__calendarInvite;
      // Long lines are folded on the wire (RFC 5545); read them unfolded.
      return {
        ...calendar,
        icsFiles: calendar.icsFiles.map((file: { content: string }) => ({
          ...file,
          content: file.content.replace(/\r\n[ \t]/g, ""),
        })),
      };
    }

    it("carries an iCalendar request addressed to the recipient, answered through a signed organizer", async () => {
      await seatParticipant("calendar@example.test");
      await sendMeetingParticipantInvitations(env.DB, admin, GROUP_ID, seriesId, occurrenceId, APP_BASE_URL, {
        signingSecret: SIGNING_SECRET,
        rsvpEmail: "rsvp@mail.test",
      });

      const [row] = await outboxRows();
      const calendar = calendarOf(row);
      expect(calendar.method).toBe("REQUEST");
      const ics = calendar.icsFiles[0].content;
      expect(ics).toContain("METHOD:REQUEST");
      // The same UID the series feed publishes, so a calendar holding the
      // feed's entry updates it rather than growing a duplicate.
      expect(ics).toContain(`UID:${occurrenceId}@pkic.org`);
      expect(ics).toContain("SEQUENCE:0");
      expect(ics).toContain(
        "ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:calendar@example.test",
      );
      const organizer = ics.match(/ORGANIZER;CN=PKI Consortium:mailto:(\S+)/)?.[1];
      expect(organizer).toBeTruthy();
      // The organizer address is signed over the occurrence, the way a
      // registration's is signed over the registration.
      expect(await verifySignedRsvpAddressFull(organizer!, SIGNING_SECRET, "rsvp@mail.test")).toEqual({
        registrationId: occurrenceId,
        dayDate: null,
      });
    });

    it("records what an invited calendar answers, against the occurrence, and lists it", async () => {
      await seatParticipant("answers@example.test");
      await sendMeetingParticipantInvitations(env.DB, admin, GROUP_ID, seriesId, occurrenceId, APP_BASE_URL, NOTIFY);

      // The reply names the occurrence by the id its organizer address was
      // signed over; the recorder tells a meeting from a registration by it.
      await recordCalendarRsvpEvent(env.DB, {
        registrationId: occurrenceId,
        icsUid: `${occurrenceId}@pkic.org`,
        attendeeEmail: "answers@example.test",
        responseStatus: "tentative",
        provider: "test",
        sourceMessageId: "reply-1",
        receivedAt: "2026-01-01T00:00:00.000Z",
      });
      await recordCalendarRsvpEvent(env.DB, {
        registrationId: occurrenceId,
        icsUid: `${occurrenceId}@pkic.org`,
        attendeeEmail: "answers@example.test",
        responseStatus: "accepted",
        provider: "test",
        sourceMessageId: "reply-2",
        receivedAt: "2026-01-02T00:00:00.000Z",
      });

      const listed = await listOccurrenceInvitations(env.DB, admin, GROUP_ID, seriesId, occurrenceId, {
        limit: 50,
        offset: 0,
      });
      expect(listed.total).toBe(1);
      expect(listed.invitations[0]).toMatchObject({
        email: "answers@example.test",
        response: "accepted",
        respondedAt: "2026-01-02T00:00:00.000Z",
      });
      // The occurrence itself tallies the answers, for the record's header.
      const occurrence = await updateSeriesOccurrence(
        env.DB,
        admin,
        GROUP_ID,
        seriesId,
        occurrenceId,
        { expectedUpdatedAt: listed.invitations[0] ? await currentUpdatedAt() : "", locationOverride: "Room 1" },
        ENCRYPTION_SECRET,
      );
      expect(occurrence.rsvp).toEqual({ accepted: 1, declined: 0, tentative: 0 });
      expect(occurrence.invitedCount).toBe(1);
    });

    it("tells everyone invited when the meeting moves, with a superseding calendar entry", async () => {
      await seatParticipant("moved@example.test");
      await sendMeetingParticipantInvitations(env.DB, admin, GROUP_ID, seriesId, occurrenceId, APP_BASE_URL, NOTIFY);

      const movedStart = new Date(Date.now() + 10_800_000).toISOString();
      const movedEnd = new Date(Date.now() + 14_400_000).toISOString();
      const moved = await updateSeriesOccurrence(
        env.DB,
        admin,
        GROUP_ID,
        seriesId,
        occurrenceId,
        { expectedUpdatedAt: await currentUpdatedAt(), startsAt: movedStart, endsAt: movedEnd },
        ENCRYPTION_SECRET,
        NOTIFY,
      );
      expect(moved.calendarSequence).toBe(1);

      const updates = await queryAll<OutboxRow>(
        env.DB,
        "SELECT recipient_email, idempotency_key, payload_json FROM email_outbox WHERE template_key = 'meeting-occurrence-updated'",
      );
      expect(updates.map((row) => row.recipient_email)).toEqual(["moved@example.test"]);
      const ics = calendarOf(updates[0]).icsFiles[0].content;
      expect(ics).toContain("METHOD:REQUEST");
      expect(ics).toContain(`UID:${occurrenceId}@pkic.org`);
      expect(ics).toContain("SEQUENCE:1");
      expect(JSON.parse(updates[0].payload_json).startsAt).toBe(movedStart);

      // A change that alters nothing a calendar shows — the provider link —
      // is not announced.
      await updateSeriesOccurrence(
        env.DB,
        admin,
        GROUP_ID,
        seriesId,
        occurrenceId,
        { expectedUpdatedAt: moved.updatedAt, providerJoinUrl: "https://meet.example.test/new-room" },
        ENCRYPTION_SECRET,
        NOTIFY,
      );
      expect(
        await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'meeting-occurrence-updated'"),
      ).toHaveLength(1);
    });

    it("tells everyone invited when the occurrence is cancelled, with a calendar cancellation", async () => {
      await seatParticipant("cancelled@example.test");
      await sendMeetingParticipantInvitations(env.DB, admin, GROUP_ID, seriesId, occurrenceId, APP_BASE_URL, NOTIFY);

      const cancelled = await updateSeriesOccurrence(
        env.DB,
        admin,
        GROUP_ID,
        seriesId,
        occurrenceId,
        { expectedUpdatedAt: await currentUpdatedAt(), status: "cancelled" },
        ENCRYPTION_SECRET,
        NOTIFY,
      );
      expect(cancelled.status).toBe("cancelled");

      const notices = await queryAll<OutboxRow>(
        env.DB,
        "SELECT recipient_email, idempotency_key, payload_json FROM email_outbox WHERE template_key = 'meeting-occurrence-cancelled'",
      );
      expect(notices.map((row) => row.recipient_email)).toEqual(["cancelled@example.test"]);
      const calendar = calendarOf(notices[0]);
      expect(calendar.method).toBe("CANCEL");
      expect(calendar.icsFiles[0].content).toContain("METHOD:CANCEL");
      expect(calendar.icsFiles[0].content).toContain("STATUS:CANCELLED");
      expect(calendar.icsFiles[0].content).toContain("SEQUENCE:1");
    });

    it("cancels the meeting: every upcoming occurrence, its invitations, and the series", async () => {
      await seatParticipant("series-cancel@example.test");
      await sendMeetingParticipantInvitations(env.DB, admin, GROUP_ID, seriesId, occurrenceId, APP_BASE_URL, NOTIFY);
      const series = await queryAll<{ updated_at: string }>(
        env.DB,
        `SELECT MAX(series.updated_at, event.updated_at) AS updated_at
           FROM event_series series JOIN events event ON event.id = series.event_id WHERE series.id = ?`,
        seriesId,
      );

      const result = await cancelGroupEventSeries(env.DB, admin, GROUP_ID, seriesId, series[0].updated_at, NOTIFY);
      expect(result.cancelledOccurrences).toBe(2);
      expect(result.series.active).toBe(false);
      expect(
        await queryAll<{ status: string }>(env.DB, "SELECT status FROM event_occurrences WHERE id = ?", occurrenceId),
      ).toEqual([{ status: "cancelled" }]);
      expect(
        await queryAll<{ recipient_email: string }>(
          env.DB,
          "SELECT recipient_email FROM email_outbox WHERE template_key = 'meeting-occurrence-cancelled'",
        ),
      ).toEqual([{ recipient_email: "series-cancel@example.test" }]);
      // A stale revision is refused rather than cancelling on top of a change.
      await expect(
        cancelGroupEventSeries(env.DB, admin, GROUP_ID, seriesId, series[0].updated_at, NOTIFY),
      ).rejects.toMatchObject({ code: "EVENT_SERIES_CHANGED" });
    });
  });

  async function currentUpdatedAt(): Promise<string> {
    const [row] = await queryAll<{ updated_at: string }>(
      env.DB,
      "SELECT updated_at FROM event_occurrences WHERE id = ?",
      occurrenceId,
    );
    return row.updated_at;
  }
});
