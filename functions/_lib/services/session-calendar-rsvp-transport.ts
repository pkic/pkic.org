import { z } from "zod";
import { calendarRsvpEventInputSchema, calendarRsvpIngestSchema } from "../../../assets/shared/schemas/calendar-rsvp";
import { agendaOccurrenceFromCalendarUid } from "../../../assets/shared/event-agenda-calendar-identity";
import { verifySignedRsvpAddressFull } from "../email/rsvp";
import { AppError } from "../errors";
import { normalizeCalendarRsvp, parseCalendarRsvp } from "./calendar-rsvp";
/** HTTP already verifies its transport HMAC; stable session UIDs additionally bind a signed recipient target. */
export async function normalizeSignedCalendarRsvp(
  input: z.infer<typeof calendarRsvpIngestSchema>,
  secret: string | undefined,
  baseEmail?: string,
) {
  const parsed =
    "calendarIcs" in input
      ? parseCalendarRsvp(input.calendarIcs, input.fromEmail)
      : {
          icsUid: input.uid,
          attendeeEmail: input.attendeeEmail,
          responseStatus: input.partstat.toLowerCase(),
          invitationSequence: input.invitationSequence,
          claimedReplyAt: input.claimedReplyAt,
          organizerEmail: input.organizerEmail,
        };
  if (!parsed.icsUid || !agendaOccurrenceFromCalendarUid(parsed.icsUid)) return normalizeCalendarRsvp(input);
  if (!secret || !parsed.organizerEmail)
    throw new AppError(
      401,
      "INVALID_SESSION_RSVP_TARGET",
      "A signed recipient invitation target is required. Calendar subscription access cannot authorize replies.",
    );
  const target = await verifySignedRsvpAddressFull(parsed.organizerEmail, secret, baseEmail);
  if (!target || target.dayDate)
    throw new AppError(401, "INVALID_SESSION_RSVP_TARGET", "The recipient invitation signature is invalid.");
  return calendarRsvpEventInputSchema.parse({
    ...parsed,
    registrationId: target.registrationId,
    provider: input.provider,
    sourceMessageId: input.sourceMessageId,
    receivedAt: input.receivedAt,
  });
}
