import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
import { sessionAppearanceSchema } from "./event-session-history";
import { agendaRevisionSchema, agendaSnapshotSchema } from "./event-agenda";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
export const appearanceOverrideDecisionSchema = z.enum(["approved", "rejected"]);
export const appearanceOverrideRequestSchema = agendaRevisionSchema.extend({
  appearance: sessionAppearanceSchema,
  reason: z.string().trim().min(10).max(2000),
  evidence: z.string().trim().min(10).max(5000),
});
export const appearanceOverrideReviewSchema = agendaRevisionSchema.extend({
  decision: appearanceOverrideDecisionSchema,
  reason: z.string().trim().min(10).max(2000),
});
export const appearanceOverrideSchema = z.object({
  id: databaseIdSchema,
  occurrenceId: databaseIdSchema,
  appearance: sessionAppearanceSchema,
  reason: z.string(),
  evidence: z.string(),
  requestedBy: databaseIdSchema,
  requestedAt: utcInstantSchema,
  decision: appearanceOverrideDecisionSchema.nullable(),
  reviewedBy: databaseIdSchema.nullable(),
  reviewedAt: utcInstantSchema.nullable(),
  reviewReason: z.string().nullable(),
});
export const appearanceOverridesQuerySchema = listQuerySchema(["requestedAt"] as const);
export const appearanceOverridesResponseSchema = paginatedResponseSchema("overrides", appearanceOverrideSchema).extend({
  canReview: z.boolean().default(false),
});
export const appearanceOverrideReviewResponseSchema = z.object({
  override: appearanceOverrideSchema,
  agenda: agendaSnapshotSchema,
});
