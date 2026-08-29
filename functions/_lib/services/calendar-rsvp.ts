import type { z } from "zod";
import {
  calendarRsvpEventInputSchema,
  calendarRsvpIngestSchema,
  type CalendarRsvpEventInput,
} from "../../../assets/shared/schemas/calendar-rsvp";
import { run } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

type CalendarRsvpInput = z.infer<typeof calendarRsvpIngestSchema>;

const REGISTRATION_ID_PREFIX = /^([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})(?:$|[-@])/i;
const DAY_DATE_SUFFIX = /^(\d{4}-\d{2}-\d{2})(?:@|$)/;

function registrationIdFromUid(uid: string): string {
  const match = uid.match(REGISTRATION_ID_PREFIX);
  if (!match) throw new AppError(400, "INVALID_CALENDAR_UID", "Calendar UID does not identify a registration");
  return match[1].toLowerCase();
}

function eventDayDateFromUid(uid: string, registrationId: string): string | null {
  if (!uid.toLowerCase().startsWith(`${registrationId.toLowerCase()}-`)) return null;
  return uid.slice(registrationId.length + 1).match(DAY_DATE_SUFFIX)?.[1] ?? null;
}

export interface ParsedCalendarRsvp {
  icsUid: string | null;
  attendeeEmail: string;
  responseStatus: "accepted" | "declined" | "tentative";
}

/** Parses the transport-independent RSVP fields shared by webhook and email ingestion. */
export function parseCalendarRsvp(calendarIcs: string, fallbackEmail?: string): ParsedCalendarRsvp {
  const lines = calendarIcs
    .replace(/\r?\n[ \t]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim());
  const uidMatch = lines.map((line) => line.match(/^UID(?:;[^:]*)?:(.+)$/i)).find(Boolean);
  const attendeeLine = lines.find(
    (line) => /^ATTENDEE(?:;|:)/i.test(line) && /(?:^|;)PARTSTAT=(?:ACCEPTED|DECLINED|TENTATIVE)(?:;|:)/i.test(line),
  );
  if (!attendeeLine) {
    throw new AppError(400, "INVALID_CALENDAR", "Calendar reply must contain an attendee PARTSTAT value");
  }
  const statusMatch = attendeeLine.match(/(?:^|;)PARTSTAT=(ACCEPTED|DECLINED|TENTATIVE)(?:;|:)/i);
  const valueSeparator = attendeeLine.indexOf(":");
  const attendeeValue = valueSeparator >= 0 ? attendeeLine.slice(valueSeparator + 1).trim() : "";
  const attendeeEmail = attendeeValue.replace(/^mailto:/i, "") || fallbackEmail || "";
  if (!/^\S+@\S+\.\S+$/.test(attendeeEmail) || attendeeEmail.length > 254) {
    throw new AppError(400, "INVALID_CALENDAR", "Calendar reply must contain a valid attendee email address");
  }
  return {
    icsUid: uidMatch?.[1].trim() || null,
    attendeeEmail: attendeeEmail.toLowerCase(),
    responseStatus: statusMatch![1].toLowerCase() as "accepted" | "declined" | "tentative",
  };
}

/** Converts either supported transport shape into the canonical RSVP event input. */
export function normalizeCalendarRsvp(input: CalendarRsvpInput): CalendarRsvpEventInput {
  let parsed;
  if ("calendarIcs" in input) {
    const calendar = parseCalendarRsvp(input.calendarIcs, input.fromEmail);
    const icsUid = calendar.icsUid;
    if (!icsUid) throw new AppError(400, "INVALID_CALENDAR", "Calendar reply must contain a UID value");
    const registrationId = registrationIdFromUid(icsUid);
    parsed = {
      ...calendar,
      icsUid,
      registrationId,
      eventDayDate: eventDayDateFromUid(icsUid, registrationId),
    };
  } else {
    const registrationId = registrationIdFromUid(input.uid);
    parsed = {
      registrationId,
      eventDayDate: eventDayDateFromUid(input.uid, registrationId),
      icsUid: input.uid,
      attendeeEmail: input.attendeeEmail,
      responseStatus: input.partstat.toLowerCase() as "accepted" | "declined" | "tentative",
    };
  }
  return {
    ...parsed,
    provider: input.provider,
    sourceMessageId: input.sourceMessageId,
    receivedAt: input.receivedAt,
  };
}

/** Idempotently records one RSVP, rejecting UIDs for registrations that do not exist. */
export async function recordCalendarRsvpEvent(db: DatabaseLike, input: CalendarRsvpEventInput): Promise<void> {
  const parsed = calendarRsvpEventInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError(400, "INVALID_RSVP_EVENT", "Invalid calendar RSVP event");
  const event = parsed.data;
  const registration = await db
    .prepare(
      `SELECT r.id,
              CASE
                WHEN ? IS NOT NULL THEN (
                  SELECT ed.id
                  FROM event_days ed
                  WHERE ed.event_id = r.event_id AND ed.day_date = ?
                  LIMIT 1
                )
                ELSE COALESCE(
                  (
                    SELECT MIN(rda.event_day_id)
                    FROM registration_day_attendance rda
                    WHERE rda.registration_id = r.id
                      AND rda.attendance_type IN ('in_person', 'virtual')
                    HAVING COUNT(*) = 1
                  ),
                  (
                    SELECT MIN(ed.id)
                    FROM event_days ed
                    WHERE ed.event_id = r.event_id
                    HAVING COUNT(*) = 1
                  )
                )
              END AS event_day_id
       FROM registrations r
       WHERE r.id = ?
       LIMIT 1`,
    )
    .bind(event.eventDayDate ?? null, event.eventDayDate ?? null, event.registrationId)
    .first<{ id: string; event_day_id: string | null }>();
  if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  if (event.eventDayDate && !registration.event_day_id) {
    throw new AppError(400, "EVENT_DAY_NOT_FOUND", "Calendar RSVP day is not configured for this event");
  }
  const dedupeKey = JSON.stringify(
    event.dedupeByCalendarUid
      ? [event.provider, event.registrationId, event.icsUid, event.sourceMessageId]
      : [event.provider, event.registrationId, event.sourceMessageId],
  );
  const receivedAt = event.receivedAt ?? new Date().toISOString();
  const { changes } = await run(
    db,
    `INSERT INTO calendar_rsvp_events
       (id, registration_id, event_day_id, ics_uid, attendee_email, response_status, provider,
        source_message_id, dedupe_key, raw_payload_json, received_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(dedupe_key) DO UPDATE SET
       event_day_id = COALESCE(excluded.event_day_id, calendar_rsvp_events.event_day_id),
       response_status = excluded.response_status,
       raw_payload_json = COALESCE(excluded.raw_payload_json, calendar_rsvp_events.raw_payload_json),
       received_at = excluded.received_at,
       warning_sent_at = CASE
         WHEN calendar_rsvp_events.response_status = excluded.response_status
          AND calendar_rsvp_events.event_day_id IS COALESCE(excluded.event_day_id, calendar_rsvp_events.event_day_id)
         THEN calendar_rsvp_events.warning_sent_at ELSE NULL END,
       action_due_at = CASE
         WHEN calendar_rsvp_events.response_status = excluded.response_status
          AND calendar_rsvp_events.event_day_id IS COALESCE(excluded.event_day_id, calendar_rsvp_events.event_day_id)
         THEN calendar_rsvp_events.action_due_at ELSE NULL END,
       action_executed_at = CASE
         WHEN calendar_rsvp_events.response_status = excluded.response_status
          AND calendar_rsvp_events.event_day_id IS COALESCE(excluded.event_day_id, calendar_rsvp_events.event_day_id)
         THEN calendar_rsvp_events.action_executed_at ELSE NULL END,
       action_taken = CASE
         WHEN calendar_rsvp_events.response_status = excluded.response_status
          AND calendar_rsvp_events.event_day_id IS COALESCE(excluded.event_day_id, calendar_rsvp_events.event_day_id)
         THEN calendar_rsvp_events.action_taken ELSE NULL END,
       updated_at = datetime('now')`,
    [
      crypto.randomUUID(),
      event.registrationId,
      registration.event_day_id,
      event.icsUid,
      event.attendeeEmail,
      event.responseStatus,
      event.provider,
      event.sourceMessageId,
      dedupeKey,
      event.rawPayloadJson ?? null,
      receivedAt,
    ],
  );
  if (changes !== 1) throw new AppError(500, "RSVP_NOT_RECORDED", "Calendar RSVP could not be recorded");
}
