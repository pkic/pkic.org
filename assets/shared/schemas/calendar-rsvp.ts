import { z } from "zod";
import { normalizedEmailSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";

const calendarRsvpSourceSchema = z.object({
  provider: z.string().trim().min(2).max(80).default("cloudflare_email_route"),
  sourceMessageId: z.string().trim().min(1).max(500),
  receivedAt: z.iso.datetime().optional(),
});

/** Canonical request contract for the signed internal RSVP endpoint. */
export const internalCalendarRsvpIngestSchema = z.union([
  calendarRsvpSourceSchema.extend({
    calendarIcs: z.string().min(1).max(300_000),
    fromEmail: normalizedEmailSchema.optional(),
  }),
  calendarRsvpSourceSchema.extend({
    uid: z.string().trim().min(1).max(500),
    partstat: z.enum(["ACCEPTED", "DECLINED", "TENTATIVE"]),
    attendeeEmail: normalizedEmailSchema,
  }),
]);

export const calendarRsvpStatusSchema = z.enum(["accepted", "declined", "tentative", "bounced"]);

/** Shared persistence contract used by webhook and Cloudflare Email ingestion. */
export const calendarRsvpEventInputSchema = z.object({
  registrationId: databaseIdSchema,
  icsUid: z.string().trim().min(1).max(500),
  attendeeEmail: normalizedEmailSchema,
  responseStatus: calendarRsvpStatusSchema,
  provider: z.string().trim().min(2).max(80),
  sourceMessageId: z.string().trim().min(1).max(500),
  receivedAt: z.iso.datetime().optional(),
  rawPayloadJson: z.string().max(10_000).optional(),
  dedupeByCalendarUid: z.boolean().optional(),
});

export type CalendarRsvpEventInput = z.infer<typeof calendarRsvpEventInputSchema>;
