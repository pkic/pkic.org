import { agendaOccurrenceCalendarUid } from "../../../../assets/shared/event-agenda-calendar-identity";
import ICAL from "ical.js";
import { generateSignedRsvpAddress } from "../../email/rsvp";
import type { SessionInvitationCalendarContext } from "../../../../assets/shared/schemas/event-session-rsvp";
/** Material identity excludes unrelated publication revisions and mutable room display names. */
export const sessionInvitationContextSql = `json_object('title',s.title,'startAt',s.start_at,'endAt',s.end_at,'timeZone',s.timezone,'roomId',s.room_id,'additionalRoomIds',json(s.additional_room_ids_json),'admissionPolicy',s.admission_policy,'accessPolicy',s.access_policy,'visibility',s.visibility,'bookingOpensAt',s.booking_opens_at,'bookingClosesAt',s.booking_closes_at)`;
export async function prepareSessionInvitationCalendar(input: {
  invitationId: string;
  occurrenceId: string;
  recipientEmail: string;
  sequence: number;
  context: SessionInvitationCalendarContext;
  mode: "physical" | "remote";
  roomName: string | null;
  issuedAt: string;
  secret: string;
  baseEmail?: string;
}) {
  const address = await generateSignedRsvpAddress(input.invitationId, input.secret, input.baseEmail);
  const calendar = new ICAL.Component(["vcalendar", [], []]);
  calendar.updatePropertyWithValue("version", "2.0");
  calendar.updatePropertyWithValue("prodid", "-//PKI Consortium//Session invitations//EN");
  calendar.updatePropertyWithValue("method", "REQUEST");
  const event = new ICAL.Component("vevent");
  event.updatePropertyWithValue("uid", agendaOccurrenceCalendarUid(input.occurrenceId));
  event.updatePropertyWithValue("sequence", input.sequence);
  for (const [name, value] of [
    ["dtstamp", input.issuedAt],
    ["dtstart", input.context.startAt],
    ["dtend", input.context.endAt],
  ])
    event.updatePropertyWithValue(name, ICAL.Time.fromJSDate(new Date(value), true));
  event.updatePropertyWithValue("summary", input.context.title);
  event.updatePropertyWithValue(
    "description",
    input.context.admissionPolicy === "preference"
      ? "Accept to save interest. Admission is first come, first served; no seat is reserved."
      : "Accept to request participation. Event registration, approval and capacity requirements apply.",
  );
  if (input.mode === "physical" && input.roomName) event.updatePropertyWithValue("location", input.roomName);
  event.updatePropertyWithValue("organizer", `mailto:${address}`);
  const attendee = new ICAL.Property("attendee");
  attendee.setValue(`mailto:${input.recipientEmail}`);
  attendee.setParameter("rsvp", "TRUE");
  attendee.setParameter("partstat", "NEEDS-ACTION");
  event.addProperty(attendee);
  calendar.addSubcomponent(event);
  const content = calendar.toString();
  return {
    __replyTo: address,
    __calendarInvite: {
      method: "REQUEST",
      inlineContent: content,
      icsFiles: [{ filename: "session-invitation.ics", content }],
    },
  };
}
