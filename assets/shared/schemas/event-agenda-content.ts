import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import {
  agendaSessionKindSchema,
  agendaSessionTrackSchema,
  agendaRevisionSchema,
  agendaSnapshotSchema,
  agendaCreditRoleSchema,
} from "./event-agenda";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { sessionProposalRepresentationSchema } from "./event-session-history";
import { agendaHistoricalMetadataReviewSchema } from "./event-agenda-historical-review";
export const agendaContentFieldsSchema = z.object({
  speakerRoles: z.record(databaseIdSchema, agendaCreditRoleSchema).default({}),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(20000).default(""),
  kind: agendaSessionKindSchema.default("session"),
  track: agendaSessionTrackSchema.nullable().optional(),
  speakerUserIds: z
    .array(databaseIdSchema)
    .max(30)
    .refine((ids) => new Set(ids).size === ids.length, "Choose each person once"),
});
export const agendaContentSchema = agendaContentFieldsSchema.extend({
  id: databaseIdSchema,
  eventId: databaseIdSchema,
  sourceKey: z.string().nullable(),
  review: z
    .object({
      reason: z.enum(["source_changed", "source_withdrawn", "local_edits"]),
      incoming: agendaContentFieldsSchema.nullable(),
      incomingProposalRepresentations: z.array(sessionProposalRepresentationSchema).max(30).optional(),
      incomingHistoricalMetadata: z.array(agendaHistoricalMetadataReviewSchema).max(100).optional(),
    })
    .nullable(),
  occurrenceCount: z.number().int().nonnegative(),
});
export const agendaContentQuerySchema = listQuerySchema(["title"] as const);
export const agendaContentsResponseSchema = paginatedResponseSchema("contents", agendaContentSchema);
export const agendaContentCreateSchema = agendaRevisionSchema.extend({ content: agendaContentFieldsSchema });
export const agendaContentPatchSchema = agendaRevisionSchema.extend({
  content: agendaContentFieldsSchema,
  resolveSourceReview: z.boolean().default(false),
});
export const agendaContentPlacementSchema = agendaRevisionSchema.extend({ copyAsNew: z.boolean().default(false) });
export const agendaContentCopySchema = agendaRevisionSchema.extend({
  sourceEventSlug: z.string().min(1).max(200),
  sourceContentId: databaseIdSchema,
});

export const agendaContentPlacementResponseSchema = z.object({
  agenda: agendaSnapshotSchema,
  occurrenceId: databaseIdSchema,
  contentId: databaseIdSchema,
});
