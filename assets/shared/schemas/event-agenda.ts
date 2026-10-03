import { httpOrSameOriginUrlSchema, sameOriginPathSchema } from "./urls";
import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

const id = z.string().min(1).max(200);
export const agendaAdmissionPolicySchema = z.enum(["preference", "reservation", "approval"]);
export const agendaRoomSchema = z.object({
  id,
  name: z.string().min(1).max(160),
  capacity: z.number().int().min(0).nullable(),
  setupMinutes: z.number().int().min(0).max(120).default(0),
});
export const agendaSpeakerSchema = z.object({ userId: id, displayName: z.string() });
export const agendaOccurrenceFieldsSchema = z.object({
  title: z.string().trim().min(1).max(300),
  presentationUrl: httpOrSameOriginUrlSchema.nullable().optional(),
  recordingUrl: httpOrSameOriginUrlSchema.nullable().optional(),
  description: z.string().max(20000).default(""),
  startAt: utcInstantSchema.nullable(),
  endAt: utcInstantSchema.nullable(),
  roomId: id.nullable(),
  admissionPolicy: agendaAdmissionPolicySchema.default("preference"),
  capacity: z.number().int().min(0).nullable().default(null),
  remoteCapacity: z.number().int().min(0).nullable().default(null),
  visibility: z.enum(["public", "private"]).default("public"),
  kind: z.enum(["session", "break", "plenary"]).default("session"),
});
export const agendaOccurrenceSchema = agendaOccurrenceFieldsSchema.extend({
  id,
  speakers: z.array(agendaSpeakerSchema),
});
export const agendaRoleMemberSchema = z.object({
  userId: id,
  displayName: z.string(),
  roles: z.array(id).min(1),
  availableFrom: utcInstantSchema.nullable(),
  availableUntil: utcInstantSchema.nullable(),
  maxMinutes: z.number().int().positive().nullable(),
  seniority: z.enum(["junior", "senior"]).default("junior"),
  attendanceMode: z.enum(["physical", "remote"]).default("physical"),
});
export const agendaAssignmentSchema = z.object({ blockId: id, role: id, userId: id, pinned: z.boolean() });
export const agendaBlockSchema = z.object({
  id,
  name: z.string().min(1).max(160),
  startAt: utcInstantSchema,
  endAt: utcInstantSchema,
  roomId: id.nullable(),
  roles: z.array(id).min(1).max(10),
  roleRequirements: z
    .array(
      z.object({
        role: id,
        seniority: z.enum(["any", "senior"]).default("any"),
        attendanceMode: z.enum(["any", "physical", "remote"]).default("any"),
      }),
    )
    .max(10)
    .default([]),
});
export const agendaSnapshotSchema = z.object({
  eventSlug: id,
  eventName: z.string().optional(),
  approvedAt: utcInstantSchema.optional(),
  publicAgendaPath: sameOriginPathSchema.optional(),
  timeZone: z.string(),
  eventStartsAt: utcInstantSchema.nullable().optional(),
  eventEndsAt: utcInstantSchema.nullable().optional(),
  revision: z.number().int().min(0),
  travelMinutes: z.number().int().min(0).max(120).default(0),
  publishedRevision: z.number().int().nullable(),
  rooms: z.array(agendaRoomSchema),
  occurrences: z.array(agendaOccurrenceSchema),
  blocks: z.array(agendaBlockSchema),
  roleMembers: z.array(agendaRoleMemberSchema),
  assignments: z.array(agendaAssignmentSchema),
});
export const agendaRevisionSchema = z.object({ expectedRevision: z.number().int().min(0) });
export const agendaRoomCreateSchema = agendaRoomSchema.omit({ id: true }).extend(agendaRevisionSchema.shape);
export const agendaOccurrenceCreateSchema = agendaOccurrenceFieldsSchema.extend({
  ...agendaRevisionSchema.shape,
  speakerUserIds: z
    .array(id)
    .max(30)
    .refine((values) => new Set(values).size === values.length, "Choose each speaker once")
    .default([]),
});
export const agendaOccurrencePatchSchema = agendaOccurrenceFieldsSchema.partial().extend({
  ...agendaRevisionSchema.shape,
  speakerUserIds: z
    .array(id)
    .max(30)
    .refine((values) => new Set(values).size === values.length, "Choose each speaker once")
    .optional(),
});
export const agendaSwapSchema = agendaRevisionSchema.extend({ firstId: id, secondId: id });
export const agendaStaffingSchema = agendaRevisionSchema.extend({
  blocks: z.array(agendaBlockSchema).max(200),
  roleMembers: z.array(agendaRoleMemberSchema).max(200),
  assignments: z.array(agendaAssignmentSchema).max(1000),
});
export const agendaAllocationSchema = agendaRevisionSchema.extend({
  seed: z.string().min(1).max(100),
  strategy: z.enum(["balanced", "random"]).default("balanced"),
});
export const agendaOccurrenceQuerySchema = listQuerySchema(["title", "startAt", "endAt"] as const).extend({
  roomId: id.optional(),
  admissionPolicy: agendaAdmissionPolicySchema.optional(),
  day: z.iso.date().optional(),
});
export const agendaOccurrenceListSchema = paginatedResponseSchema("occurrences", agendaOccurrenceSchema);
export type AgendaSnapshot = z.infer<typeof agendaSnapshotSchema>;
export type AgendaOccurrence = z.infer<typeof agendaOccurrenceSchema>;
export type AgendaBlock = z.infer<typeof agendaBlockSchema>;
export type AgendaAssignment = z.infer<typeof agendaAssignmentSchema>;
export type AgendaRoleMember = z.infer<typeof agendaRoleMemberSchema>;
export const agendaImportSchema = agendaRevisionSchema
  .extend({
    source: z.enum(["accepted_proposals", "legacy"]),
    dryRun: z.boolean().default(true),
    occurrences: z
      .array(
        agendaOccurrenceCreateSchema.omit({ expectedRevision: true }).extend({ sourceKey: z.string().min(1).max(300) }),
      )
      .max(100)
      .default([]),
  })
  .refine((input) => new Set(input.occurrences.map((item) => item.sourceKey)).size === input.occurrences.length, {
    message: "Each import source key must be unique",
    path: ["occurrences"],
  });
export const agendaImportResponseSchema = z.object({
  agenda: agendaSnapshotSchema,
  imported: z.number().int().min(0),
  skipped: z.number().int().min(0),
  dryRun: z.boolean(),
});
export const agendaPeopleQuerySchema = listQuerySchema(["name"] as const);
export const agendaPersonSchema = z.object({
  id: z.string(),
  email: z.string(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
});
export const agendaPeopleListSchema = paginatedResponseSchema("users", agendaPersonSchema);

export const agendaSettingsSchema = agendaRevisionSchema.extend({ travelMinutes: z.number().int().min(0).max(120) });
