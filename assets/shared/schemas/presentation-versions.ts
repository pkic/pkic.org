import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const PRESENTATION_VERSION_SORT_COLUMNS = ["versionNumber", "fileName", "uploadedAt"] as const;
export const presentationVersionsListQuerySchema = listQuerySchema(PRESENTATION_VERSION_SORT_COLUMNS, { limit: 25 });

export const presentationReviewStatusSchema = z.enum(["approved", "rejected", "needs_revision"]);
export type PresentationReviewStatus = z.infer<typeof presentationReviewStatusSchema>;

export const presentationVersionReviewSchema = z.object({
  id: databaseIdSchema,
  versionId: databaseIdSchema,
  reviewedByUserId: databaseIdSchema,
  reviewedAt: z.string(),
  status: presentationReviewStatusSchema,
  note: z.string().nullable(),
});

export const presentationVersionSchema = z.object({
  id: databaseIdSchema,
  proposalId: databaseIdSchema,
  versionNumber: z.number().int().positive(),
  fileName: z.string().nullable(),
  fileSize: z.number().int().nonnegative().nullable(),
  mimeType: z.string().nullable(),
  uploadedByUserId: databaseIdSchema.nullable(),
  uploadedAt: z.string(),
  isCurrent: z.boolean(),
  deletedAt: z.string().nullable(),
  latestReview: presentationVersionReviewSchema.nullable(),
});

export const presentationVersionsResponseSchema = paginatedResponseSchema("versions", presentationVersionSchema);
export const presentationVersionResponseSchema = z.object({ version: presentationVersionSchema });
export const presentationVersionReviewRequestSchema = z.object({
  status: presentationReviewStatusSchema,
  note: z.string().trim().max(4000).nullable().optional(),
});

export type PresentationVersionReview = z.infer<typeof presentationVersionReviewSchema>;
export type PresentationVersion = z.infer<typeof presentationVersionSchema>;
/** Internal representation retained for storage operations; never expose through an API response. */
export type PresentationVersionWithStorageKey = PresentationVersion & { r2Key: string };
export type PresentationVersionReviewRequest = z.infer<typeof presentationVersionReviewRequestSchema>;
export type PresentationVersionsListQuery = z.infer<typeof presentationVersionsListQuerySchema>;
