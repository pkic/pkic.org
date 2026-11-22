import { SCANNER_EVENT_OFFLINE_MAXIMUM_MS } from "../event-offline-expiry";
import { z } from "zod";
import { eventSlugParamsSchema, utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { enrolledOfflineEligibilityResponseSchema } from "./event-offline-eligibility";
import { scanActionSchema } from "./event-participation-scanning";
import { refineAttendanceCaptureIntent } from "./event-attendance-capture";
import { portalReturnPathSchema } from "./user-auth";

export const scannerOfflineRouteSchema = portalReturnPathSchema.refine(
  (path) =>
    /^\/events\/[^/?#]+\/(?:scanner|leads|sponsors\/[^/?#]+\/scanner)$/u.test(path) ||
    /^\/groups\/[^/?#]+\/events\/[^/?#]+\/scanner$/u.test(path),
  "Use an event scanner route.",
);

/** Local preparation provenance, never portal authentication or a permission grant. */
export const scannerOfflineContextSchema = enrolledOfflineEligibilityResponseSchema
  .pick({
    eventId: true,
    operatorUserId: true,
    deviceId: true,
    epochId: true,
    occurrenceId: true,
    roomId: true,
    publishedRevision: true,
    nativeEventContext: true,
    serverNow: true,
    expiresAt: true,
  })
  .extend({
    slug: eventSlugParamsSchema.shape.eventSlug,
    route: scannerOfflineRouteSchema,
    sessionId: databaseIdSchema,
    contextId: databaseIdSchema.optional(),
    sponsorId: databaseIdSchema.optional(),
    action: scanActionSchema.exclude(["exception"]),
    purpose: z.enum(["scan", "collection"]).optional(),
    targetLabel: z.string().trim().max(200).optional(),
    roomLabel: z.string().trim().max(200).optional(),
    savedAt: utcInstantSchema,
    lastObservedAt: utcInstantSchema,
  })
  .strict()
  .refine((value) => {
    if (value.action === "lead")
      return (
        Boolean(value.sponsorId) &&
        value.purpose === "scan" &&
        value.occurrenceId === null &&
        value.roomId === null &&
        (value.route === `/events/${encodeURIComponent(value.slug)}/leads` ||
          value.route === `/events/${encodeURIComponent(value.slug)}/sponsors/${value.sponsorId}/scanner`)
      );
    return (
      !value.sponsorId &&
      (value.route.startsWith("/groups/")
        ? value.route.split("/")[4] === value.eventId
        : value.route === `/events/${encodeURIComponent(value.slug)}/scanner`)
    );
  }, "Scanner route must match its prepared event.")
  .superRefine((value, context) =>
    refineAttendanceCaptureIntent(
      {
        capturePublicationRevision: value.publishedRevision,
        nativeEventContext: value.nativeEventContext,
        occurrenceId: value.occurrenceId,
        roomId: value.roomId,
      },
      context,
    ),
  )
  .refine((value) => {
    const lifetime = Date.parse(value.expiresAt) - Date.parse(value.serverNow);
    return (
      lifetime > 0 &&
      lifetime <= SCANNER_EVENT_OFFLINE_MAXIMUM_MS &&
      Date.parse(value.lastObservedAt) >= Date.parse(value.savedAt)
    );
  }, "Scanner preparation must retain its bounded original deadline.");
export type ScannerOfflineContext = z.infer<typeof scannerOfflineContextSchema>;
