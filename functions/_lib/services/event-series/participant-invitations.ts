/**
 * Sending every participant of a meeting their own link to it.
 *
 * The consortium wanted each member to receive a link that is theirs rather
 * than one address forwarded around a company (#6): who actually came to a
 * meeting is the measurement everything else rests on. A signed personal
 * locator names the invitee; it does not authenticate a new browser.
 *
 * Recipients are the group's active participants, addressed at the identity
 * they hold there — somebody representing two organizations in one group is
 * written to once per seat, at the address that seat acts under, because
 * those are two participations and each is a different person to the record.
 */
import { prepareBulkQueueEmailChunkStatements } from "../../email/outbox";
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLogAfterOneChange } from "../audit";
import { buildOccurrenceCalendarPayload } from "./invite-calendar";
import { commitEventResourceManagementBatch } from "./management";
import {
  occurrenceOrganizerAddress,
  PARTICIPANT_INVITATION_TEMPLATE_KEY,
  type OccurrenceNotificationOptions,
} from "./occurrence-notifications";
import { getManagedSeriesOccurrence } from "./occurrences";
import { memberMeetingLinkUrl, memberMeetingLinkUrls } from "./personal-entry-links";

/**
 * The largest group this may be sent to in one request.
 *
 * A round is one D1 batch; the recipients go in as a handful of JSON chunk
 * inserts (`prepareBulkQueueEmailChunkStatements`), not one statement each,
 * so a group of thousands is a few statements rather than thousands. What
 * still bounds a round is the request that reads the roster and the batch's
 * own byte budget, hence a cap far above any group the consortium has.
 * Refusing past it is deliberate: silently writing to the first N
 * participants would leave the rest waiting for an invitation that a manager
 * believes they sent (#100).
 */
export const MAX_PARTICIPANTS_PER_ROUND = 10_000;

interface ParticipantRow {
  user_id: string;
  recipient_email: string;
  recipient_name: string;
}

/**
 * The group's live seats, at the address each acts under.
 *
 * A seat whose identity names a verified secondary address is written to
 * there; everybody else is written to at their account address. Inactive
 * accounts and lapsed Members are not participants any more and are not
 * written to, which is the same predicate the roster itself uses.
 */
function listParticipants(db: DatabaseLike, groupId: string): Promise<ParticipantRow[]> {
  return all<ParticipantRow>(
    db,
    `SELECT membership.user_id,
            COALESCE(seat_email.email, participant.email) AS recipient_email,
            COALESCE(
              NULLIF(TRIM(COALESCE(participant.preferred_name, '')), ''),
              NULLIF(TRIM(COALESCE(participant.first_name, '') || ' ' || COALESCE(participant.last_name, '')), ''),
              participant.email
            ) AS recipient_name
       FROM group_memberships membership
       JOIN users participant ON participant.id = membership.user_id AND participant.active = 1
       JOIN members member ON member.id = membership.member_id AND member.status = 'active'
       JOIN identities identity ON identity.id = membership.identity_id
        AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
       LEFT JOIN user_emails seat_email
         ON seat_email.id = identity.email_id
        AND seat_email.user_id = membership.user_id
        AND seat_email.verified_at IS NOT NULL
      WHERE membership.group_id = ?
        AND membership.left_at IS NULL
        AND participant.pii_redacted_at IS NULL
        AND participant.merged_into_user_id IS NULL
      ORDER BY membership.id`,
    [groupId],
  );
}

export interface SendMeetingParticipantInvitationsResult {
  round: number;
  recipientCount: number;
  sentAt: string;
}

export async function sendMeetingParticipantInvitations(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  occurrenceId: string,
  appBaseUrl: string,
  /** Signs the organizer address; without it the invitation carries no RSVP route. */
  calendar: Pick<OccurrenceNotificationOptions, "signingSecret" | "rsvpEmail"> = {},
): Promise<SendMeetingParticipantInvitationsResult> {
  const { context, series, occurrence } = await getManagedSeriesOccurrence(
    db,
    actor,
    groupIdOrSlug,
    seriesId,
    occurrenceId,
  );
  if (occurrence.status !== "scheduled") {
    throw new AppError(
      409,
      "EVENT_OCCURRENCE_NOT_SCHEDULED",
      "This meeting is not scheduled, so there is nothing to invite anyone to",
    );
  }
  const sentAt = nowIso();
  if (occurrence.endsAt <= sentAt) {
    throw new AppError(409, "EVENT_OCCURRENCE_ALREADY_ENDED", "This meeting has already ended");
  }

  const participants = await listParticipants(db, series.ownerGroupId);
  if (participants.length === 0) {
    throw new AppError(
      409,
      "EVENT_OCCURRENCE_NO_PARTICIPANTS",
      "This meeting's group has no participants to send links to",
    );
  }
  if (participants.length > MAX_PARTICIPANTS_PER_ROUND) {
    throw new AppError(
      422,
      "EVENT_OCCURRENCE_TOO_MANY_PARTICIPANTS",
      `This group has ${String(participants.length)} participants, more than the ${String(
        MAX_PARTICIPANTS_PER_ROUND,
      )} one round may write to`,
    );
  }

  const round = occurrence.invitationsRound + 1;
  if (!calendar.signingSecret) {
    throw new AppError(503, "MEETING_SECURITY_CONFIG_UNAVAILABLE", "Personal meeting links are not configured");
  }
  const personalLinks = await memberMeetingLinkUrls(
    db,
    seriesId,
    occurrenceId,
    participants.map((participant) => ({ userId: participant.user_id, email: participant.recipient_email })),
    appBaseUrl,
    calendar.signingSecret,
  );
  // The invitation is a calendar entry as well as a link (#126): it lands on
  // the recipient's calendar, and the accept or decline their calendar sends
  // back reaches the occurrence through the signed organizer address.
  const organizerEmail = await occurrenceOrganizerAddress(occurrenceId, calendar);
  const deliveries = prepareBulkQueueEmailChunkStatements(
    db,
    participants.map((participant) => ({
      outboxId: uuid(),
      idempotencyKey: `${PARTICIPANT_INVITATION_TEMPLATE_KEY}:${occurrenceId}:${participant.user_id}:${String(round)}`,
      templateKey: PARTICIPANT_INVITATION_TEMPLATE_KEY,
      eventId: series.eventId,
      recipientUserId: participant.user_id,
      recipientEmail: participant.recipient_email,
      // The template carries the subject; the row's own is only the fallback
      // the outbox uses when a template has none.
      subject: null,
      messageType: "transactional",
      data: {
        recipientName: participant.recipient_name,
        eventName: series.eventName,
        startsAt: occurrence.startsAt,
        joinUrl: memberMeetingLinkUrl(personalLinks, participant.user_id, participant.recipient_email),
      },
      capabilityLinkValues: [memberMeetingLinkUrl(personalLinks, participant.user_id, participant.recipient_email)],
      calendar: buildOccurrenceCalendarPayload(
        {
          occurrenceId,
          eventId: series.eventId,
          eventName: series.eventName,
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
          location: occurrence.location,
          joinUrl: memberMeetingLinkUrl(personalLinks, participant.user_id, participant.recipient_email),
          sequence: occurrence.calendarSequence,
          organizerEmail,
          attendeeEmail: participant.recipient_email,
        },
        "REQUEST",
      ),
      bounceAddress: organizerEmail,
    })),
    sentAt,
  );
  const statements: StatementLike[] = [
    /*
     * The round is claimed before anything is queued, against the round this
     * request read. Two managers pressing send at the same time therefore
     * produce one round, not two identical mailings: the second batch fails
     * its own guard and takes its outbox rows down with it.
     */
    db
      .prepare(
        `UPDATE event_occurrences
            SET invitations_round = ?, invitations_sent_at = ?, updated_at = ?
          WHERE id = ? AND invitations_round = ?`,
      )
      .bind(round, sentAt, sentAt, occurrenceId, occurrence.invitationsRound),
    /*
     * Immediately after the claim, because its `changes()` guard reads the
     * statement before it: a claim that matched nothing writes a NULL action
     * into a NOT NULL column and takes the whole batch — every queued
     * message with it — down with it. That is the compare-and-set boundary,
     * so the audit record is not a note about the send, it is what makes the
     * send atomic.
     */
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "group", id: series.ownerGroupId },
      "admin",
      actor.id,
      "meeting_participant_invitations_sent",
      "event_occurrence",
      occurrenceId,
      { round, recipientCount: participants.length, groupId: series.ownerGroupId },
      sentAt,
    ),
    ...deliveries.map((delivery) => delivery.statement),
  ];

  await commitEventResourceManagementBatch(db, actor, context, "manage", statements);
  return { round, recipientCount: participants.length, sentAt };
}
