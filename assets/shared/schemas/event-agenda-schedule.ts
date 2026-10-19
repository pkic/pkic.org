import { z } from "zod";
import {
  agendaOccurrenceSchema,
  agendaRevisionSchema,
  agendaSnapshotSchema,
  agendaSpeakerPlacementSchema,
} from "./event-agenda";
import { eventSlugParamsSchema } from "./api-common";
import { ok, authErrors, requiresPermissions } from "./route-contract";
export const agendaScheduleSwapSelectionSchema = agendaRevisionSchema
  .extend({ firstId: agendaOccurrenceSchema.shape.id, secondId: agendaOccurrenceSchema.shape.id })
  .refine((value) => value.firstId !== value.secondId, { path: ["secondId"], message: "Choose a different session" });
export const AGENDA_SCHEDULE_BATCH_LIMIT = 100;
/** Requested owned resources only; another event's conflicting commitments stay private. */
export const agendaScheduleConflictProposalSchema = z.object({
  timeZone: agendaSnapshotSchema.shape.timeZone,
  occurrences: z
    .array(
      agendaOccurrenceSchema.pick({
        id: true,
        title: true,
        startAt: true,
        endAt: true,
        roomId: true,
        additionalRoomIds: true,
      }),
    )
    .min(1)
    .max(AGENDA_SCHEDULE_BATCH_LIMIT),
});
export const agendaScheduleConflictDetailsSchema = z.object({
  conflicts: z.array(z.string().min(1)).min(1),
  proposal: agendaScheduleConflictProposalSchema.optional(),
});
export type AgendaScheduleConflictProposal = z.infer<typeof agendaScheduleConflictProposalSchema>;
export const agendaScheduleChangeSchema = agendaOccurrenceSchema
  .pick({
    id: true,
    startAt: true,
    endAt: true,
    roomId: true,
    additionalRoomIds: true,
  })
  .extend({
    speakerPlacements: z
      .record(agendaOccurrenceSchema.shape.id, agendaSpeakerPlacementSchema)
      .refine((value) => Object.keys(value).length <= 30, "Choose at most 30 speaker placements")
      .optional(),
  });
export const agendaScheduleProposalSchema = agendaRevisionSchema.extend({
  changes: z
    .array(agendaScheduleChangeSchema)
    .min(1)
    .max(AGENDA_SCHEDULE_BATCH_LIMIT)
    .refine(
      (changes) => new Set(changes.map((change) => change.id)).size === changes.length,
      "Choose each session once",
    ),
});
export const agendaScheduleReviewSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/u),
  affected: z
    .array(
      z.object({
        before: agendaOccurrenceSchema,
        after: agendaOccurrenceSchema,
        beforeOrder: z.number().int().positive().nullable(),
        afterOrder: z.number().int().positive().nullable(),
      }),
    )
    .min(1)
    .max(AGENDA_SCHEDULE_BATCH_LIMIT),
});
export const agendaScheduleApplySchema = agendaScheduleProposalSchema.extend({
  reviewHash: agendaScheduleReviewSchema.shape.reviewHash,
});
export type AgendaScheduleProposal = z.infer<typeof agendaScheduleProposalSchema>;
export type AgendaScheduleReview = z.infer<typeof agendaScheduleReviewSchema>;
const route = {
  ...requiresPermissions("agenda:write"),
  tags: ["Events"],
  request: { params: eventSlugParamsSchema },
  responses: authErrors({
    badRequest: "Invalid schedule proposal",
    conflict: "Schedule or revision conflict",
    notFound: "Session not found",
  }),
};
export const agendaScheduleReviewRouteSchema = {
  ...route,
  summary: "Preview a guarded schedule change",
  request: { ...route.request, body: { content: { "application/json": { schema: agendaScheduleProposalSchema } } } },
  responses: { ...route.responses, ...ok("Canonical schedule preview", agendaScheduleReviewSchema) },
};
export const agendaScheduleApplyRouteSchema = {
  ...route,
  summary: "Apply a reviewed schedule change atomically",
  request: { ...route.request, body: { content: { "application/json": { schema: agendaScheduleApplySchema } } } },
  responses: { ...route.responses, ...ok("Updated agenda", agendaSnapshotSchema) },
};
