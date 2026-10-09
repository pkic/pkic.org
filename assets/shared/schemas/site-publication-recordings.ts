import { z } from "zod";
import { databaseIdSchema } from "./identifiers.ts";
import { utcInstantSchema } from "./api-common.ts";
import { eventRecordingMimeTypeSchema } from "./event-recordings.ts";
import { sessionRecordingReleaseParamsSchema } from "../session-recording-public-url.ts";

export const publicationDocumentGrantIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const publicationRecordingEffectSchema = sessionRecordingReleaseParamsSchema
  .extend({
    kind: z.literal("recording"),
    eventId: databaseIdSchema,
    grantId: publicationDocumentGrantIdSchema,
  })
  .strict();
export const publicationRecordingAllowSchema = publicationRecordingEffectSchema
  .extend({
    version: z.literal(1),
    r2Key: z.string().min(1).max(1024),
    versionNumber: z.number().int().positive(),
    fileSize: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    mimeType: eventRecordingMimeTypeSchema,
    objectEtag: z.string().min(1).max(200),
    approvedAt: utcInstantSchema,
    approvalNonce: z.uuid().nullable(),
  })
  .strict();
export const publicationRecordingDenialSchema = publicationRecordingEffectSchema
  .extend({ version: z.literal(1) })
  .strict();
export type PublicationRecordingAllow = z.infer<typeof publicationRecordingAllowSchema>;
