import { MEETING_PERSONAL_CALENDAR_NOTICE } from "../../../../assets/shared/meeting-calendar-policy";
/**
 * A meeting occurrence as a calendar invitation (#126).
 *
 * The participant's link used to arrive as a plain message: nothing landed on
 * their calendar, and when the meeting moved or was called off nobody was
 * told. What goes out now is an iTIP REQUEST addressed to the recipient,
 * with the consortium's signed RSVP address as the organizer — the same
 * arrangement a conference registration uses — so the accept or decline the
 * recipient's calendar sends back is captured against the occurrence.
 *
 * The UID is the occurrence's, the same one the series feed publishes, so a
 * calendar that already holds the entry from the feed updates it rather than
 * growing a duplicate. SEQUENCE is what tells that calendar a later message
 * supersedes an earlier one, and a CANCEL under the same UID removes it.
 */
import type { CalendarPayload } from "../../email/outbox-queue";
import { meetingCalendarFilename } from "./calendar-filename";

export interface OccurrenceInvite {
  occurrenceId: string;
  eventId: string;
  eventName: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  joinUrl: string;
  /** Bumped every time the occurrence is re-sent because it changed. */
  sequence: number;
  /** The signed RSVP address replies are routed to; absent when signing is not configured. */
  organizerEmail?: string;
  attendeeEmail: string;
}

export type OccurrenceInviteMethod = "REQUEST" | "CANCEL";

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function utcTimestamp(value: string): string {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function fold(line: string): string {
  const chunks: string[] = [];
  let remaining = line;
  while (remaining.length > 75) {
    chunks.push(remaining.slice(0, 75));
    remaining = ` ${remaining.slice(75)}`;
  }
  chunks.push(remaining);
  return chunks.join("\r\n");
}

export function occurrenceCalendarUid(occurrenceId: string): string {
  return `${occurrenceId}@pkic.org`;
}

/** The iCalendar text for one recipient's invitation to, or cancellation of, an occurrence. */
export function buildOccurrenceInviteIcs(
  invite: Omit<OccurrenceInvite, "attendeeEmail"> & { attendeeEmail?: string },
  method: OccurrenceInviteMethod | undefined,
  cancelled = method === "CANCEL",
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PKI Consortium//Group Meetings//EN",
    "CALSCALE:GREGORIAN",
    ...(method ? [`METHOD:${method}`] : []),
    "BEGIN:VEVENT",
    `UID:${occurrenceCalendarUid(invite.occurrenceId)}`,
    `SEQUENCE:${String(invite.sequence)}`,
    `DTSTAMP:${utcTimestamp(new Date().toISOString())}`,
    `DTSTART:${utcTimestamp(invite.startsAt)}`,
    `DTEND:${utcTimestamp(invite.endsAt)}`,
    `SUMMARY:${escapeIcs(cancelled ? `Cancelled: ${invite.eventName}` : invite.eventName)}`,
    `DESCRIPTION:${escapeIcs(
      cancelled
        ? `${invite.eventName} has been cancelled.`
        : `Join the meeting: ${invite.joinUrl}\n${MEETING_PERSONAL_CALENDAR_NOTICE}`,
    )}`,
    `URL:${escapeIcs(invite.joinUrl)}`,
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
  ];
  if (invite.location) lines.push(`LOCATION:${escapeIcs(invite.location)}`);
  if (invite.organizerEmail) lines.push(`ORGANIZER;CN=PKI Consortium:mailto:${invite.organizerEmail}`);
  if (invite.attendeeEmail)
    lines.push(`ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${invite.attendeeEmail}`);
  if (!cancelled) {
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "TRIGGER:-PT15M", "END:VALARM");
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** The outbox payload that makes a queued message carry the invitation. */
export function buildOccurrenceCalendarPayload(
  invite: OccurrenceInvite,
  method: OccurrenceInviteMethod,
): CalendarPayload {
  const uid = occurrenceCalendarUid(invite.occurrenceId);
  const content = buildOccurrenceInviteIcs(invite, method);
  return {
    occurrenceId: invite.occurrenceId,
    eventId: invite.eventId,
    icsUid: uid,
    icsFiles: [{ uid, filename: meetingCalendarFilename(invite.eventName), content }],
    inlineContent: content,
    method,
  };
}
