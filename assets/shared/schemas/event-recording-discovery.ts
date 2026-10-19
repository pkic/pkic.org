import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { eventRecordingSourceSchema } from "./event-recordings";
import {
  listQuerySchema,
  paginatedResponseSchema,
  paginationQuerySchemaWithDefaults,
  searchQuerySchema,
} from "./pagination";

export const realtimeKitMeetingStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);
export const eventRecordingProviderMeetingSchema = z.strictObject({
  providerMeetingId: z.uuid(),
  title: z.string().max(512),
  status: realtimeKitMeetingStatusSchema,
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema,
});
export type EventRecordingProviderMeeting = z.infer<typeof eventRecordingProviderMeetingSchema>;

/** Provider meeting search has no documented sort input. Offset selects one provider page. */
export const eventRecordingProviderMeetingsQuerySchema = paginationQuerySchemaWithDefaults({ maxLimit: 100 })
  .merge(searchQuerySchema)
  .extend({ status: realtimeKitMeetingStatusSchema.optional() })
  .strict()
  .refine((query) => query.offset % query.limit === 0, "Offset must select a complete provider page");
export type EventRecordingProviderMeetingsQuery = z.infer<typeof eventRecordingProviderMeetingsQuerySchema>;
export const eventRecordingProviderMeetingsResponseSchema = paginatedResponseSchema(
  "meetings",
  eventRecordingProviderMeetingSchema,
);
export type EventRecordingProviderMeetingsResponse = z.infer<typeof eventRecordingProviderMeetingsResponseSchema>;

/** A manager explicitly establishes this association; provider metadata alone grants no event ownership. */
export const eventRecordingMeetingLinkSchema = z.strictObject({
  providerMeetingId: z.uuid(),
  nativeOccurrenceId: z.uuid().optional(),
});
export type EventRecordingMeetingLink = z.infer<typeof eventRecordingMeetingLinkSchema>;
export const eventRecordingMeetingSchema = eventRecordingSourceSchema
  .pick({ id: true, eventId: true, nativeOccurrenceId: true, provider: true, providerMeetingId: true })
  .extend({ title: z.string().max(512), linkedAt: utcInstantSchema })
  .strict();
export type EventRecordingMeeting = z.infer<typeof eventRecordingMeetingSchema>;
export const eventRecordingMeetingsQuerySchema = listQuerySchema(["title", "linkedAt"] as const)
  .extend({ nativeOccurrenceId: z.uuid().optional() })
  .strict();
export type EventRecordingMeetingsQuery = z.infer<typeof eventRecordingMeetingsQuerySchema>;
export const eventRecordingMeetingsResponseSchema = paginatedResponseSchema("meetings", eventRecordingMeetingSchema);

/** Recording selection preserves the exact fixed page the binding command rechecks. */
export const eventRecordingDiscoveryQuerySchema = paginationQuerySchemaWithDefaults({ limit: 100, maxLimit: 100 })
  .extend({ meetingLinkId: z.uuid() })
  .strict()
  .refine(
    (query) => query.limit === 100 && query.offset % 100 === 0,
    "Discovery uses complete pages of 100 recordings",
  );
export type EventRecordingDiscoveryQuery = z.infer<typeof eventRecordingDiscoveryQuerySchema>;
export const eventRecordingDiscoveredSchema = eventRecordingSourceSchema.pick({
  recordingId: true,
  sessionId: true,
  status: true,
  invokedAt: true,
  startedAt: true,
  stoppedAt: true,
  fileBytes: true,
});
export const eventRecordingDiscoveryResponseSchema = paginatedResponseSchema(
  "recordings",
  eventRecordingDiscoveredSchema,
).extend({ meeting: eventRecordingMeetingSchema });
