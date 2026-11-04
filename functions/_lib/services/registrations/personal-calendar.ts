import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { first } from "../../db/queries";
import { generateSignedRsvpAddress } from "../../email/rsvp";
import { buildRegistrationIcs, calendarConfirmedDays } from "../../utils/calendar";
import { getEventBySlug } from "../events";
import { listDayWaitlistForRegistration } from "./day-waitlist-queries";
import { getRegistrationDayAttendance } from "../event-days";
import { registrationPortalPageUrl } from "../frontend-links";

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
  const registrationUrl = registrationPortalPageUrl(origin, { slug: eventSlug }, registrationId);
  const dayAttendance = await getRegistrationDayAttendance(db, registrationId);
  const organizerEmail = signingSecret
    ? await generateSignedRsvpAddress(registrationId, signingSecret, rsvpEmail)
    : undefined;
  const calendar = await buildRegistrationIcs(
    event,
    registrationId,
    registrationUrl,
    calendarConfirmedDays(dayAttendance, await listDayWaitlistForRegistration(db, registrationId)),
    origin,
    organizerEmail,
    attendeeEmail,
    signingSecret,
  );
  if (!calendar.files.length)
    throw new AppError(
      404,
      "CALENDAR_NOT_AVAILABLE",
      "No confirmed live attendance days are available for this registration",
    );
  return { content: calendar.files[0].content, filename: `${eventSlug}-personal.ics` };
}
