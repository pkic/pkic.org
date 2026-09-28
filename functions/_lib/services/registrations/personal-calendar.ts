import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { first } from "../../db/queries";
import { generateSignedRsvpAddress } from "../../email/rsvp";
import { buildRegistrationIcs } from "../../utils/calendar";
import { getEventBySlug } from "../events";
import { getRegistrationDayAttendance } from "../event-days";

/** Rebuild the same registration calendar that confirmation mail attaches. */
export async function personalEventCalendar(
  db: DatabaseLike,
  eventSlug: string,
  registrationId: string,
  userId: string,
  attendeeEmail: string,
  origin: string,
  signingSecret?: string,
  rsvpEmail?: string,
): Promise<{ content: string; filename: string }> {
  const event = await getEventBySlug(db, eventSlug);
  const registration = await first<{ user_id: string; status: string }>(
    db,
    "SELECT user_id, status FROM registrations WHERE id = ? AND event_id = ?",
    [registrationId, event.id],
  );
  if (!registration || registration.user_id !== userId || registration.status !== "registered") {
    throw new AppError(404, "REGISTRATION_NOT_FOUND", "Active registration not found");
  }
  const manageUrl = `${origin}/portal/#/events/${encodeURIComponent(eventSlug)}/registrations/${encodeURIComponent(registrationId)}`;
  const dayAttendance = await getRegistrationDayAttendance(db, registrationId);
  const organizerEmail = signingSecret
    ? await generateSignedRsvpAddress(registrationId, signingSecret, rsvpEmail)
    : undefined;
  const calendar = await buildRegistrationIcs(
    event,
    registrationId,
    manageUrl,
    dayAttendance,
    origin,
    organizerEmail,
    attendeeEmail,
    signingSecret,
  );
  return { content: calendar.files[0].content, filename: `${eventSlug}-personal.ics` };
}
