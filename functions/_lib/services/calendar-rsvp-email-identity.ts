import { addressParser, type Email } from "postal-mime";
import { normalizedEmailSchema } from "../../../assets/shared/schemas/api-common";
import type { CalendarRsvpEventInput } from "../../../assets/shared/schemas/calendar-rsvp";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { verifiedAddressesJsonSql } from "./user-emails";

/** Envelope senders identify transport hops; an implicit reply names its author in From. */
export function calendarRsvpEmailAuthor(email: Email): string {
  const headers = email.headers.filter((header) => header.key === "from");
  const authors = headers.length === 1 ? addressParser(headers[0]!.value) : [];
  if (authors.length !== 1 || !authors[0]!.address)
    throw new AppError(400, "RSVP_EMAIL_AUTHOR_INVALID", "The reply must name one author.");
  return parseAttendeeEmail(authors[0]!.address);
}

export function parseAttendeeEmail(value: unknown): string {
  const parsed = normalizedEmailSchema.safeParse(value);
  if (!parsed.success)
    throw new AppError(400, "RSVP_EMAIL_ATTENDEE_INVALID", "The reply must name a valid attendee.", {
      validationIssues: parsed.error.issues.map((issue) => ({ field: "attendeeEmail", code: issue.code })),
    });
  return parsed.data;
}

/** A signed target and a claimed address must identify the same invited recipient. */
export async function requireCalendarRsvpEmailRecipient(
  db: DatabaseLike,
  targetId: string,
  email: string,
  responseStatus: CalendarRsvpEventInput["responseStatus"],
) {
  const invited = await first<{ invited: number }>(
    db,
    `SELECT 1 AS invited WHERE EXISTS (
      SELECT 1 FROM registrations registration
      WHERE registration.id=? AND ? IN (
        SELECT LOWER(value) FROM json_each(${verifiedAddressesJsonSql("registration.user_id")})
      )
    ) OR EXISTS (
      SELECT 1 FROM agenda_session_invitations invitation JOIN users person ON person.id=invitation.user_id
      WHERE invitation.id=? AND person.normalized_email=? AND invitation.revoked_at IS NULL AND person.active=1
    ) OR EXISTS (
      SELECT 1 FROM event_series_calendar_deliveries delivery
      WHERE delivery.series_id=? AND delivery.recipient_email=? AND (delivery.cancelled=0 OR ?='bounced')
    ) OR EXISTS (
      SELECT 1 FROM meeting_occurrence_invitations invitation
      WHERE invitation.occurrence_id=? AND invitation.recipient_email=?
    )`,
    [targetId, email, targetId, email, targetId, email, responseStatus, targetId, email],
  );
  if (!invited)
    throw new AppError(403, "RSVP_EMAIL_RECIPIENT_MISMATCH", "The reply does not match an invited recipient.");
}
