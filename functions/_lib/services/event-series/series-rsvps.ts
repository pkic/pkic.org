import type { CalendarRsvpEventInput } from "../../../../assets/shared/schemas/calendar-rsvp";
import { first, run } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { recordOccurrenceRsvp } from "./rsvps";

/** A reply to the recurring master applies to future occurrences; an exception targets its original start. */
export async function recordSeriesRsvp(db: DatabaseLike, event: CalendarRsvpEventInput): Promise<boolean> {
  const series = await first<{ id: string }>(db, "SELECT id FROM event_series WHERE id = ?", [event.registrationId]);
  if (!series) return false;
  const invited = await first<{ user_id: string | null }>(
    db,
    "SELECT user_id FROM event_series_calendar_deliveries WHERE series_id = ? AND recipient_email = ?",
    [series.id, event.attendeeEmail],
  );
  if (!invited) throw new AppError(400, "MEETING_RSVP_NOT_INVITED", "The reply does not match an invited address");
  if (event.recurrenceId) {
    const occurrence = await first<{ id: string }>(
      db,
      "SELECT id FROM event_occurrences WHERE series_id = ? AND strftime('%Y-%m-%dT%H:%M:%SZ', COALESCE(recurrence_id, starts_at)) = strftime('%Y-%m-%dT%H:%M:%SZ', ?)",
      [series.id, event.recurrenceId],
    );
    if (!occurrence)
      throw new AppError(400, "MEETING_RSVP_OCCURRENCE_NOT_FOUND", "The reply does not identify a meeting occurrence");
    await recordOccurrenceRsvp(db, { ...event, occurrenceId: occurrence.id });
  } else {
    const at = event.receivedAt ?? nowIso();
    await run(
      db,
      `INSERT INTO event_series_rsvps (series_id, attendee_email, response_status, provider, source_message_id, received_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(series_id, attendee_email) DO UPDATE SET
      response_status = excluded.response_status, provider = excluded.provider, source_message_id = excluded.source_message_id,
      received_at = excluded.received_at WHERE excluded.received_at >= event_series_rsvps.received_at`,
      [series.id, event.attendeeEmail, event.responseStatus, event.provider, event.sourceMessageId, at],
    );
  }
  return true;
}
