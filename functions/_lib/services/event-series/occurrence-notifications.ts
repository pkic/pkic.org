/**
 * Telling the invited when a meeting moves or is called off (#126).
 *
 * Whoever holds an invitation to an occurrence — from a manager's round or
 * from the automatic reconciliation — is written to again when it changes:
 * an updated REQUEST under the same UID with a higher SEQUENCE when it moves
 * or is put back on, a CANCEL when it is called off. The recipients are read
 * from the outbox rather than from the roster, because the roster says who
 * is in the group today and the question is who was told about this meeting.
 */
import { generateSignedRsvpAddress } from "../../email/rsvp";
import { prepareBulkQueueEmailChunkStatements } from "../../email/outbox";
import { all } from "../../db/queries";
import type { BulkEmailQueueRow } from "../../email/outbox-queue";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { buildOccurrenceCalendarPayload, type OccurrenceInvite } from "./invite-calendar";

export const PARTICIPANT_INVITATION_TEMPLATE_KEY = "meeting-participant-invitation";
export const OCCURRENCE_UPDATED_TEMPLATE_KEY = "meeting-occurrence-updated";
export const OCCURRENCE_CANCELLED_TEMPLATE_KEY = "meeting-occurrence-cancelled";

export type OccurrenceChange = "updated" | "cancelled";

export interface OccurrenceNotificationOptions {
  appBaseUrl: string;
  /** Signs the organizer address replies are routed to; without it no RSVP can come back. */
  signingSecret?: string;
  rsvpEmail?: string;
}

export interface InvitedRecipient {
  user_id: string | null;
  recipient_email: string;
  recipient_name: string;
}

/** Everyone who was sent an invitation to this occurrence, once each, at the address it went to. */
export function listInvitedRecipients(db: DatabaseLike, occurrenceId: string): Promise<InvitedRecipient[]> {
  return all<InvitedRecipient>(
    db,
    `SELECT invited.recipient_user_id AS user_id, invited.recipient_email,
            COALESCE(json_extract(invited.payload_json, '$.recipientName'), invited.recipient_email) AS recipient_name
       FROM email_outbox invited
      WHERE instr(invited.idempotency_key, ?) = 1
      GROUP BY invited.recipient_email
      ORDER BY invited.recipient_email`,
    // A prefix test rather than LIKE: D1 refuses a LIKE pattern this long.
    [invitationKeyPrefix(occurrenceId)],
  );
}

/** The idempotency-key prefix every invitation to the occurrence shares, whichever round or pass sent it. */
export function invitationKeyPrefix(occurrenceId: string): string {
  return `${PARTICIPANT_INVITATION_TEMPLATE_KEY}:${occurrenceId}:`;
}

export function occurrenceJoinUrl(appBaseUrl: string, occurrenceId: string): string {
  return `${appBaseUrl}/meetings/join/?occurrence=${encodeURIComponent(occurrenceId)}`;
}

/** The organizer address a recipient's calendar answers to, when signing is configured. */
export async function occurrenceOrganizerAddress(
  occurrenceId: string,
  options: Pick<OccurrenceNotificationOptions, "signingSecret" | "rsvpEmail">,
): Promise<string | undefined> {
  if (!options.signingSecret) return undefined;
  return generateSignedRsvpAddress(occurrenceId, options.signingSecret, options.rsvpEmail);
}

export interface OccurrenceInviteSubject {
  occurrenceId: string;
  eventId: string;
  eventName: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  sequence: number;
  previousStartsAt?: string;
  previousEndsAt?: string;
  previousLocation?: string | null;
  restored?: boolean;
  seriesCancelled?: boolean;
}

/**
 * The outbox statements that tell every invited person about the change.
 * Nothing is queued while nobody has been invited.
 */
export async function prepareOccurrenceChangeNotifications(
  db: DatabaseLike,
  subject: OccurrenceInviteSubject,
  change: OccurrenceChange,
  options: OccurrenceNotificationOptions,
): Promise<StatementLike[]> {
  const recipients = await listInvitedRecipients(db, subject.occurrenceId);
  const rows = await buildOccurrenceChangeEmails(subject, change, options, recipients);
  return prepareBulkQueueEmailChunkStatements(db, rows, nowIso()).map((chunk) => chunk.statement);
}

async function buildOccurrenceChangeEmails(
  subject: OccurrenceInviteSubject,
  change: OccurrenceChange,
  options: OccurrenceNotificationOptions,
  recipients: InvitedRecipient[],
): Promise<BulkEmailQueueRow[]> {
  if (!recipients.length) return [];
  const organizerEmail = await occurrenceOrganizerAddress(subject.occurrenceId, options);
  const joinUrl = occurrenceJoinUrl(options.appBaseUrl, subject.occurrenceId);
  const method = change === "cancelled" ? "CANCEL" : "REQUEST";
  const templateKey = change === "cancelled" ? OCCURRENCE_CANCELLED_TEMPLATE_KEY : OCCURRENCE_UPDATED_TEMPLATE_KEY;
  return recipients.map((recipient) => {
    const invite: OccurrenceInvite = {
      ...subject,
      joinUrl,
      organizerEmail,
      attendeeEmail: recipient.recipient_email,
    };
    return {
      outboxId: uuid(),
      // Keyed by the sequence the calendars will hold, so a retried save
      // of the same change writes to nobody twice.
      idempotencyKey: `meeting-occurrence-${change}:${subject.occurrenceId}:${recipient.recipient_email}:${String(
        subject.sequence,
      )}`,
      templateKey,
      eventId: subject.eventId,
      recipientUserId: recipient.user_id,
      recipientEmail: recipient.recipient_email,
      subject: null,
      messageType: "transactional" as const,
      data: {
        recipientName: recipient.recipient_name,
        eventName: subject.eventName,
        previousStartsAt: subject.previousStartsAt,
        previousEndsAt: subject.previousEndsAt,
        previousLocation: subject.previousLocation,
        timeChanged: Boolean(
          subject.previousStartsAt &&
          (subject.previousStartsAt !== subject.startsAt || subject.previousEndsAt !== subject.endsAt),
        ),
        locationChanged: subject.previousLocation !== undefined && subject.previousLocation !== subject.location,
        restored: subject.restored,
        seriesCancelled: subject.seriesCancelled,
        startsAt: subject.startsAt,
        endsAt: subject.endsAt,
        location: subject.location ?? "",
        joinUrl,
      },
      capabilityLinkValues: [joinUrl],
      calendar: buildOccurrenceCalendarPayload(invite, method),
      bounceAddress: organizerEmail,
    };
  });
}

/** Resolve individual invitations in one bounded read when canceling a whole series. */
export async function prepareSeriesCancellationNotifications(
  db: DatabaseLike,
  seriesId: string,
  eventId: string,
  eventName: string,
  now: string,
  options: OccurrenceNotificationOptions,
): Promise<StatementLike[]> {
  const rows = await all<InvitedRecipient & OccurrenceInviteSubject>(
    db,
    `SELECT occurrence.id AS occurrenceId, occurrence.starts_at AS startsAt,
       occurrence.ends_at AS endsAt, occurrence.calendar_sequence + 1 AS sequence,
       COALESCE(occurrence.location_override, series.location) AS location,
       invited.recipient_user_id AS user_id, invited.recipient_email,
       COALESCE(json_extract(invited.payload_json, '$.recipientName'), invited.recipient_email) AS recipient_name
     FROM event_occurrences occurrence JOIN event_series series ON series.id = occurrence.series_id
     JOIN email_outbox invited ON instr(invited.idempotency_key, 'meeting-participant-invitation:' || occurrence.id || ':') = 1
     WHERE occurrence.series_id = ? AND occurrence.status = 'scheduled' AND occurrence.ends_at > ?
     GROUP BY occurrence.id, invited.recipient_email ORDER BY occurrence.id, invited.recipient_email LIMIT 1001`,
    [seriesId, now],
  );
  if (rows.length > 1000)
    throw new AppError(
      422,
      "MEETING_CANCELLATION_TOO_LARGE",
      "This series has too many individual invitations to cancel at once; cancel its occurrences separately",
    );
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const recipients = grouped.get(row.occurrenceId) ?? [];
    recipients.push(row);
    grouped.set(row.occurrenceId, recipients);
  }
  const emails: BulkEmailQueueRow[] = [];
  for (const recipients of grouped.values()) {
    emails.push(
      ...(await buildOccurrenceChangeEmails(
        { ...recipients[0], eventId, eventName, seriesCancelled: true },
        "cancelled",
        options,
        recipients,
      )),
    );
  }
  return prepareBulkQueueEmailChunkStatements(db, emails, now).map((chunk) => chunk.statement);
}
