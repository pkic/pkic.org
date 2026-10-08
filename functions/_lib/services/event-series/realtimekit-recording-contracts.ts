import { z } from "zod";
import { utcInstantSchema } from "../../../../assets/shared/schemas/api-common";

export const realtimeKitRecordingStatusSchema = z.enum([
  "INVOKED",
  "RECORDING",
  "UPLOADING",
  "UPLOADED",
  "ERRORED",
  "PAUSED",
]);

export const realtimeKitRecordingConfigurationSchema = z
  .object({
    accountId: z.string().regex(/^[a-f0-9]{32}$/),
    appId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    apiToken: z.string().min(1).max(4096).regex(/^\S+$/),
  })
  .strict();
export type RealtimeKitRecordingConfiguration = z.infer<typeof realtimeKitRecordingConfigurationSchema>;

export const realtimeKitRecordingListInputSchema = z
  .object({
    meetingId: z.uuid(),
    page: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    limit: z.number().int().min(1).max(100),
  })
  .strict();
export type RealtimeKitRecordingListInput = z.infer<typeof realtimeKitRecordingListInputSchema>;

export const realtimeKitRecordingDetailInputSchema = z
  .object({
    recordingId: z.uuid(),
    sessionId: z.uuid(),
  })
  .strict();
export type RealtimeKitRecordingDetailInput = z.infer<typeof realtimeKitRecordingDetailInputSchema>;

export const realtimeKitRecordingMetadataSchema = z
  .object({
    recordingId: z.uuid(),
    sessionId: z.uuid(),
    status: realtimeKitRecordingStatusSchema,
    invokedAt: utcInstantSchema,
    startedAt: utcInstantSchema,
    stoppedAt: utcInstantSchema.optional(),
    fileBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type RealtimeKitRecordingMetadata = z.infer<typeof realtimeKitRecordingMetadataSchema>;

const nonnegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const realtimeKitRecordingPagingSchema = z
  .object({
    startOffset: nonnegativeInteger,
    endOffset: nonnegativeInteger,
    totalCount: nonnegativeInteger,
  })
  .strict();

export const realtimeKitRecordingPageSchema = z
  .object({
    meetingId: z.uuid(),
    rows: z.array(realtimeKitRecordingMetadataSchema).max(100),
    paging: realtimeKitRecordingPagingSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.rows.length === 0 ||
      (value.paging.startOffset <= value.paging.endOffset && value.paging.endOffset <= value.paging.totalCount),
  );
export type RealtimeKitRecordingPage = z.infer<typeof realtimeKitRecordingPageSchema>;

export type RealtimeKitMetadataFailure = {
  kind:
    | "not_configured"
    | "invalid_request"
    | "provider_refused"
    | "not_found"
    | "temporarily_unavailable"
    | "invalid_response"
    | "identity_mismatch";
  status: number | null;
};
export type RealtimeKitMetadataResult<T> = { ok: true; value: T } | { ok: false; error: RealtimeKitMetadataFailure };

// Provider wire objects strip unknown fields before any value leaves this boundary.
const providerInstantSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString())
  .pipe(utcInstantSchema);
export const realtimeKitRecordingWireSchema = z.object({
  id: z.uuid(),
  session_id: z.uuid(),
  status: realtimeKitRecordingStatusSchema,
  invoked_time: providerInstantSchema,
  started_time: providerInstantSchema,
  stopped_time: providerInstantSchema.optional(),
  file_size: nonnegativeInteger,
  meeting: z.object({ id: z.uuid() }).optional(),
});

export const realtimeKitRecordingListWireSchema = z.object({
  success: z.literal(true),
  data: z.array(realtimeKitRecordingWireSchema).max(100),
  paging: z.object({
    start_offset: nonnegativeInteger,
    end_offset: nonnegativeInteger,
    total_count: nonnegativeInteger,
  }),
});
export const realtimeKitRecordingDetailWireSchema = z.object({
  success: z.literal(true),
  data: realtimeKitRecordingWireSchema,
});

export function recordingMetadataFromWire(
  value: z.infer<typeof realtimeKitRecordingWireSchema>,
): RealtimeKitRecordingMetadata {
  return realtimeKitRecordingMetadataSchema.parse({
    recordingId: value.id,
    sessionId: value.session_id,
    status: value.status,
    invokedAt: value.invoked_time,
    startedAt: value.started_time,
    ...(value.stopped_time === undefined ? {} : { stoppedAt: value.stopped_time }),
    fileBytes: value.file_size,
  });
}
