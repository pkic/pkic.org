import { z } from "zod";
import { agendaRevisionSchema, agendaSnapshotSchema, agendaSpeakerProfileCandidateSchema } from "./event-agenda";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const speakerProfileReviewQuerySchema = listQuerySchema(["displayName"] as const).extend({
  status: z.enum(["pending", "approved", "all"]).default("pending"),
});
export const speakerProfileReviewSchema = agendaSpeakerProfileCandidateSchema.extend({
  userId: databaseIdSchema,
  displayName: z.string(),
  organizationId: databaseIdSchema.nullable(),
  profileDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  sessionCount: z.number().int().positive(),
  available: z.boolean(),
  reviewedAt: utcInstantSchema.nullable(),
});
export type SpeakerProfileReview = z.infer<typeof speakerProfileReviewSchema>;
export const speakerProfileReviewsResponseSchema = paginatedResponseSchema(
  "profiles",
  speakerProfileReviewSchema,
).extend({
  canReview: z.boolean(),
});
export const speakerProfileApprovalSchema = agendaRevisionSchema.extend({
  userId: databaseIdSchema,
  identityId: databaseIdSchema,
  profileDigest: speakerProfileReviewSchema.shape.profileDigest,
});
export const speakerProfileApprovalResponseSchema = z.object({ agenda: agendaSnapshotSchema });
