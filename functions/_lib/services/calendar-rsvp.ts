import type { z } from "zod";
import {
  calendarRsvpEventInputSchema,
  internalCalendarRsvpIngestSchema,
  type CalendarRsvpEventInput,
} from "../../../assets/shared/schemas/calendar-rsvp";
import { run } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

type InternalRsvpInput = z.infer<typeof internalCalendarRsvpIngestSchema>;

const REGISTRATION_ID_PREFIX = /^([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})(?:$|[-@])/i;

function registrationIdFromUid(uid: string): string {
  const match = uid.match(REGISTRATION_ID_PREFIX);
  if (!match) throw new AppError(400, "INVALID_CALENDAR_UID", "Calendar UID does not identify a registration");
  return match[1].toLowerCase();
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
export function normalizeInternalCalendarRsvp(input: InternalRsvpInput): CalendarRsvpEventInput {
  let parsed;
  if ("calendarIcs" in input) {
    const calendar = parseCalendarRsvp(input.calendarIcs, input.fromEmail);
    const icsUid = calendar.icsUid;
    if (!icsUid) throw new AppError(400, "INVALID_CALENDAR", "Calendar reply must contain a UID value");
    parsed = { ...calendar, icsUid, registrationId: registrationIdFromUid(icsUid) };
  } else {
    parsed = {
      registrationId: registrationIdFromUid(input.uid),
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
  const dedupeKey = JSON.stringify(
    event.dedupeByCalendarUid
      ? [event.registrationId, event.icsUid, event.sourceMessageId]
      : [event.registrationId, event.sourceMessageId],
  );
  const receivedAt = event.receivedAt ?? new Date().toISOString();
  const { changes } = await run(
    db,
    `INSERT INTO calendar_rsvp_events
       (id, registration_id, ics_uid, attendee_email, response_status, provider,
        source_message_id, dedupe_key, raw_payload_json, received_at, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')
     WHERE EXISTS (SELECT 1 FROM registrations WHERE id = ?)
     ON CONFLICT(dedupe_key) DO UPDATE SET
       response_status = excluded.response_status,
       raw_payload_json = COALESCE(excluded.raw_payload_json, calendar_rsvp_events.raw_payload_json),
       received_at = excluded.received_at,
       updated_at = datetime('now')`,
    [
      crypto.randomUUID(),
      event.registrationId,
      event.icsUid,
      event.attendeeEmail,
      event.responseStatus,
      event.provider,
      event.sourceMessageId,
      dedupeKey,
      event.rawPayloadJson ?? null,
      receivedAt,
      event.registrationId,
    ],
  );
  if (changes !== 1) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
}
