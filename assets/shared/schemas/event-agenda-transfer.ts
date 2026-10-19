import { pageInfoSchema } from "./pagination";
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
import { historicalRetainedSourceEvidenceSchema } from "./event-agenda-historical-review";
import { publicSessionMediaUrlSchema, sessionHistoryMetadataSchema } from "./event-session-history";
import { presentationByteCountSchema } from "./event-agenda-legacy-fragments";
import {
  agendaSnapshotSchema,
  agendaOccurrenceFieldsSchema,
  agendaCreditRoleSchema,
  agendaPublicAnchorSchema,
} from "./event-agenda";
const reference = z.string().trim().min(1).max(300);
const anchor = agendaPublicAnchorSchema;
export const transferPersonSchema = z.object({
  ref: reference,
  label: z.string().max(200),
  canonicalUserId: databaseIdSchema.nullable(),
  actingIdentityId: databaseIdSchema.nullable(),
  role: agendaCreditRoleSchema,
});
export const transferRoomSchema = z.object({
  ref: reference,
  label: z.string().max(160),
  canonicalRoomId: databaseIdSchema.nullable(),
});
export const transferTimingSchema = z.object({
  timeZone: z.string().min(1).max(100),
  authoredDate: z.string().nullable(),
  authoredStart: z.string().nullable(),
  startAt: utcInstantSchema.nullable(),
  endAt: utcInstantSchema.nullable(),
  endSource: z.enum(["explicit", "duration", "next_start", "unresolved"]),
  transitionMinutes: z.number().int().min(0).max(120),
  transitionSource: z.enum(["explicit", "default", "none"]),
});
export const transferMediaSchema = z.object({
  kind: z.enum(["presentation", "recording"]),
  authoredReference: reference,
  publicUrl: publicSessionMediaUrlSchema.nullable(),
  sourceDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  bytes: presentationByteCountSchema.nullable().default(null),
});
export const transferOccurrenceSchema = z.object({
  ref: reference,
  sourceKey: reference,
  sourceAnchor: anchor.nullable(),
  sourcePath: z.string().max(1000),
  sourceDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  fields: agendaOccurrenceFieldsSchema.omit({ roomId: true, additionalRoomIds: true, startAt: true, endAt: true }),
  timing: transferTimingSchema,
  roomRefs: z.array(reference).max(20),
  retainedSourceEvidence: historicalRetainedSourceEvidenceSchema,
  personRefs: z.array(reference).max(30),
  personRoles: z
    .record(reference, agendaCreditRoleSchema)
    .refine((roles) => Object.keys(roles).length <= 30, "An occurrence supports at most 30 credit roles.")
    .default({}),
  media: z.array(transferMediaSchema).max(2),
  archive: sessionHistoryMetadataSchema.nullable(),
});
export const agendaTransferSchema = z.object({
  page: pageInfoSchema.optional(),
  format: z.literal("pkic-agenda"),
  version: z.literal(1),
  source: z.object({
    kind: z.enum(["hugo", "portable"]),
    eventRef: reference,
    exportedAt: utcInstantSchema,
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  people: z.array(transferPersonSchema).max(3000),
  rooms: z.array(transferRoomSchema).max(200),
  occurrences: z.array(transferOccurrenceSchema).max(100),
});
export const transferResolutionSchema = z.object({
  people: z.record(reference, z.object({ userId: databaseIdSchema, actingIdentityId: databaseIdSchema.nullable() })),
  rooms: z.record(reference, databaseIdSchema),
  media: z.record(reference, publicSessionMediaUrlSchema),
  rows: z.record(reference, z.enum(["import", "skip", "retain_local", "review_source"])),
});
export const transferFindingSchema = z.object({
  rowRef: reference.nullable(),
  field: z.string().max(100),
  code: z.enum([
    "person_unresolved",
    "historical_credit_unlinked",
    "person_ambiguous",
    "identity_invalid",
    "room_unresolved",
    "format_unresolved",
    "media_unresolved",
    "timing_unresolved",
    "timing_inferred",
    "source_not_recorded",
    "anchor_collision",
    "schedule_collision",
    "source_changed",
    "local_edits",
    "duplicate_source",
    "invalid_reference",
  ]),
  severity: z.enum(["blocking", "review", "information"]),
  message: z.string().max(1000),
});
/**
 * archive: a past program with its historical attribution; current: an authored program for an
 * upcoming or running event, imported as its live agenda; copy_as_new: an unscheduled private template.
 */
export const agendaTransferModeSchema = z.enum(["archive", "current", "copy_as_new"]);
export type AgendaTransferMode = z.infer<typeof agendaTransferModeSchema>;
export const transferPrepareSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  mode: agendaTransferModeSchema,
  document: agendaTransferSchema,
  resolutions: transferResolutionSchema,
});
export const transferReviewSchema = z.object({
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedRevision: z.number().int().nonnegative(),
  findings: z.array(transferFindingSchema).max(5000),
  ready: z.boolean(),
  imported: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export const transferApplySchema = transferPrepareSchema.extend({
  reviewDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  acknowledgeInferredTiming: z.boolean(),
  acknowledgeArchiveRepresentation: z.boolean(),
});

export const transferApplyResponseSchema = z.object({
  agenda: agendaSnapshotSchema,
  imported: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  reviewRequired: z.number().int().nonnegative().optional(),
  reviewSourceKeys: z.array(reference).max(100).optional(),
});
