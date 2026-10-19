import { z } from "zod";
import { eventIdSchema, utcInstantSchema } from "./api-common.ts";
import { listQuerySchema, paginatedResponseSchema } from "./pagination.ts";
import { sessionPresentationDigestSchema } from "./session-presentation-versions.ts";

export const realtimeKitRecordingStatusSchema = z.enum([
  "INVOKED",
  "RECORDING",
  "UPLOADING",
  "UPLOADED",
  "ERRORED",
  "PAUSED",
]);
const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonnegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const eventRecordingSourceBindSchema = z
  .object({
    meetingLinkId: z.uuid(),
    recordingId: z.uuid(),
    discoveryPage: nonnegativeInteger.default(0),
  })
  .strict();
export type EventRecordingSourceBind = z.infer<typeof eventRecordingSourceBindSchema>;

export const eventRecordingSourceRefreshSchema = z.object({ expectedMetadataRevision: positiveInteger }).strict();
export type EventRecordingSourceRefresh = z.infer<typeof eventRecordingSourceRefreshSchema>;

/** Event-management metadata; credentials, download locations and storage keys never appear here. */
export const eventRecordingSourceSchema = z
  .object({
    id: z.uuid(),
    eventId: eventIdSchema,
    meetingLinkId: z.uuid(),
    nativeOccurrenceId: z.uuid().nullable(),
    provider: z.literal("realtimekit"),
    providerMeetingId: z.uuid(),
    recordingId: z.uuid(),
    sessionId: z.uuid(),
    status: realtimeKitRecordingStatusSchema,
    invokedAt: utcInstantSchema,
    startedAt: utcInstantSchema,
    stoppedAt: utcInstantSchema.nullable(),
    fileBytes: nonnegativeInteger,
    metadataRevision: positiveInteger,
    observedAt: utcInstantSchema,
    disabledAt: utcInstantSchema.nullable(),
  })
  .strict();
export type EventRecordingSource = z.infer<typeof eventRecordingSourceSchema>;

export const eventRecordingSourcesQuerySchema = listQuerySchema(["invokedAt", "startedAt", "status"] as const)
  .extend({ status: realtimeKitRecordingStatusSchema.optional(), nativeOccurrenceId: z.uuid().optional() })
  .strict();
export type EventRecordingSourcesQuery = z.infer<typeof eventRecordingSourcesQuerySchema>;
export const eventRecordingSourcesResponseSchema = paginatedResponseSchema("sources", eventRecordingSourceSchema);

export const eventRecordingAcquireSchema = z
  .object({
    operationId: z.uuid(),
    expectedMetadataRevision: positiveInteger,
  })
  .strict();
export type EventRecordingAcquire = z.infer<typeof eventRecordingAcquireSchema>;
export const eventRecordingAcquisitionStatusSchema = z.enum([
  "queued",
  "processing",
  "retrying",
  "completed",
  "failed",
]);
export const eventRecordingAcquisitionFailureSchema = z.enum([
  "metadata_unavailable",
  "source_changed",
  "authority_changed",
  "download_unavailable",
  "integrity_failed",
  "storage_unavailable",
]);
export type EventRecordingAcquisitionFailure = z.infer<typeof eventRecordingAcquisitionFailureSchema>;
export const eventRecordingAcquisitionSchema = z
  .object({
    id: z.uuid(),
    eventId: eventIdSchema,
    sourceId: z.uuid(),
    operationId: z.uuid(),
    expectedMetadataRevision: positiveInteger,
    status: eventRecordingAcquisitionStatusSchema,
    attempts: nonnegativeInteger,
    nextAttemptAt: utcInstantSchema,
    failure: eventRecordingAcquisitionFailureSchema.nullable(),
    providerStatus: z.number().int().min(100).max(599).nullable(),
    versionId: z.uuid().nullable(),
    completedAt: utcInstantSchema.nullable(),
    createdAt: utcInstantSchema,
    updatedAt: utcInstantSchema,
  })
  .strict()
  .refine((value) => (value.versionId === null) === (value.completedAt === null));
export type EventRecordingAcquisition = z.infer<typeof eventRecordingAcquisitionSchema>;

export const eventRecordingMimeTypeSchema = z.enum(["video/mp4", "video/webm"]);
export type EventRecordingMimeType = z.infer<typeof eventRecordingMimeTypeSchema>;

export const eventRecordingVersionSchema = z
  .object({
    id: z.uuid(),
    eventId: eventIdSchema,
    sourceId: z.uuid(),
    version: positiveInteger,
    sourceMetadataRevision: positiveInteger,
    digest: sessionPresentationDigestSchema,
    fileBytes: positiveInteger,
    mimeType: eventRecordingMimeTypeSchema,
    acquiredAt: utcInstantSchema,
    deletedAt: utcInstantSchema.nullable(),
  })
  .strict();
export type EventRecordingVersion = z.infer<typeof eventRecordingVersionSchema>;
export const eventRecordingVersionsQuerySchema = listQuerySchema(["version", "acquiredAt"] as const)
  .extend({ sourceId: z.uuid().optional() })
  .strict();
export const eventRecordingVersionsResponseSchema = paginatedResponseSchema("versions", eventRecordingVersionSchema);
