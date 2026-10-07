import { agendaDurationRulesSchema } from "./event-agenda-duration";
import { agendaSponsorIdsSchema, agendaBreakSponsorDisplaySchema } from "./event-agenda-sponsors";
import { agendaCreditRoleSchema } from "./agenda-credit-role";
import {
  agendaStaffingRoleSchema,
  agendaStaffingPostSchema,
  agendaStaffingRequirementSchema,
  agendaStaffingPositionSchema,
  agendaStaffingPositionAssignmentSchema,
  agendaStaffingPositionPlanSchema,
} from "./event-agenda-staffing-positions";
import { promotionCopySchema } from "./event-promotion-kit";
import { sessionHistoryMetadataSchema, publicSessionPortraitUrlSchema } from "./event-session-history";
import { sessionDemandSchema } from "./event-session-demand";
import { httpOrSameOriginUrlSchema, httpUrlSchema, sameOriginPathSchema } from "./urls";
import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

const id = z.string().min(1).max(200);
export const agendaAdmissionPolicySchema = z.enum(["preference", "reservation", "approval"]);
export const agendaAccessPolicySchema = z.enum(["open", "invitation"]);
export const agendaPublicationStatusSchema = z.enum(["published", "changed", "unpublished"]);
export const agendaVisibilitySchema = z.enum(["public", "private"]);
export const agendaSessionKindSchema = z.enum(["session", "break", "plenary"]);
/** Authored subject/program grouping, independent of physical rooms and agenda item type. */
export const agendaSessionTrackSchema = z.string().trim().min(1).max(160);
export const agendaEquipmentSchema = z
  .array(z.string().trim().toLowerCase().min(1).max(80))
  .max(50)
  .refine((values) => new Set(values).size === values.length, "Choose each equipment item once");
export const agendaRoomAvailabilitySchema = z
  .array(
    z.object({ startAt: utcInstantSchema, endAt: utcInstantSchema }).refine((period) => period.startAt < period.endAt, {
      message: "Closing time must follow opening time",
      path: ["endAt"],
    }),
  )
  .max(100);
export const agendaRoomSchema = z.object({
  id,
  name: z.string().min(1).max(160),
  capacity: z.number().int().min(0).nullable(),
  setupMinutes: z.number().int().min(0).max(120).default(0),
  equipment: agendaEquipmentSchema.optional(),
  availablePeriods: agendaRoomAvailabilitySchema.optional(),
});
export { agendaCreditRoleSchema } from "./agenda-credit-role";
export const agendaSpeakerPlacementSchema = z.object({
  attendanceMode: z.enum(["physical", "remote"]),
  roomId: id.nullable(),
});
/** Available intrinsic person information for authorized draft review, never an approved appearance. */
export const agendaSpeakerProfileCandidateSchema = z.object({
  biography: z.string().nullable(),
  photoUrl: publicSessionPortraitUrlSchema.nullable(),
});
export const agendaSpeakerSchema = z.object({
  userId: id,
  displayName: z.string(),
  role: agendaCreditRoleSchema.optional(),
  attendanceMode: z.enum(["physical", "remote"]).optional(),
  roomId: id.nullable().optional(),
  profileCandidate: agendaSpeakerProfileCandidateSchema.optional(),
});
export const agendaOccurrenceFieldsSchema = z.object({
  title: z.string().trim().min(1).max(300),
  presentationUrl: httpOrSameOriginUrlSchema.nullable().optional(),
  recordingUrl: httpOrSameOriginUrlSchema.nullable().optional(),
  virtualRoomUrl: httpUrlSchema.nullable().optional(),
  sponsorIds: agendaSponsorIdsSchema.optional(),
  description: z.string().max(20000).default(""),
  startAt: utcInstantSchema.nullable(),
  endAt: utcInstantSchema.nullable(),
  roomId: id.nullable(),
  additionalRoomIds: z
    .array(id)
    .max(19)
    .refine((values) => new Set(values).size === values.length, "Choose each additional room once")
    .optional(),
  requiredEquipment: agendaEquipmentSchema.optional(),
  admissionPolicy: agendaAdmissionPolicySchema.default("preference"),
  accessPolicy: agendaAccessPolicySchema.optional(),
  bookingOpensAt: utcInstantSchema.nullable().optional(),
  bookingClosesAt: utcInstantSchema.nullable().optional(),
  capacity: z.number().int().min(0).nullable().default(null),
  remoteCapacity: z.number().int().min(0).nullable().default(null),
  visibility: agendaVisibilitySchema.default("public"),
  kind: agendaSessionKindSchema.default("session"),
  track: agendaSessionTrackSchema.nullable().optional(),
});
export const agendaPublicAnchorSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/u);
export const agendaOccurrenceSchema = agendaOccurrenceFieldsSchema.extend({
  /** Branding captured from the existing public event sponsor records. */
  sponsors: z.array(agendaBreakSponsorDisplaySchema).max(10).optional(),
  /** Public availability hint only; the attendee endpoint rechecks entitlement before releasing a destination. */
  onlineAccessAvailable: z.boolean().optional(),
  /** Read-only label from the original accepted proposal; independent of agenda kind. */
  sourceProposalType: z.string().nullable().optional(),
  publicAnchor: agendaPublicAnchorSchema.nullable().optional(),
  id,
  contentId: id.nullable().optional(),
  history: sessionHistoryMetadataSchema.optional(),
  promotionCopy: promotionCopySchema.optional(),
  publicationStatus: agendaPublicationStatusSchema.optional(),
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
export const agendaAssignmentSchema = agendaStaffingPositionAssignmentSchema;
export const agendaBlockSchema = z
  .object({
    id,
    name: z.string().min(1).max(160),
    startAt: utcInstantSchema,
    endAt: utcInstantSchema,
    roomId: id.nullable(),
    track: agendaSessionTrackSchema.nullable().optional(),
    roles: z.array(id).max(10),
    compatibleRolePairs: z
      .array(z.tuple([id, id]))
      .max(45)
      .optional(),
    boundaries: z
      .object({ startOccurrenceId: id.nullable().optional(), endOccurrenceId: id.nullable().optional() })
      .optional(),
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
  })
  .superRefine((block, context) => {
    if (new Set(block.roles).size !== block.roles.length)
      context.addIssue({ code: "custom", path: ["roles"], message: "Choose each duty once" });
    const pairs = new Set<string>();
    for (const [index, pair] of (block.compatibleRolePairs ?? []).entries()) {
      const key = JSON.stringify([...pair].sort());
      if (pair[0] === pair[1] || pair.some((role) => !block.roles.includes(role)) || pairs.has(key))
        context.addIssue({
          code: "custom",
          path: ["compatibleRolePairs", index],
          message: "Choose one unique pair of different duties in this block",
        });
      pairs.add(key);
    }
  });
export const agendaStaffingReasonCountSchema = z.object({
  reason: z.enum(["role", "experience", "attendance", "availability", "workload", "conflict", "external_conflict"]),
  people: z.number().int().min(0),
});
export const agendaStaffingReportSchema = z.object({
  people: z.array(
    z.object({
      userId: id,
      displayName: z.string(),
      minutes: z.number(),
      pinnedCount: z.number(),
      manualCount: z.number(),
      roles: z.array(z.object({ role: id, minutes: z.number() })),
    }),
  ),
  coverage: z
    .array(
      z.object({
        requirementId: id,
        blockId: id,
        role: id,
        postId: id.nullable(),
        idealCount: z.number().int(),
        assignedCount: z.number().int(),
        missingCount: z.number().int(),
      }),
    )
    .default([]),
  uncovered: z.array(
    z.object({
      blockId: id,
      role: id,
      positionId: id.optional(),
      postId: id.nullable().optional(),
      reasons: z.array(agendaStaffingReasonCountSchema).default([]),
      eligiblePeople: z.number().int().min(0).default(0),
    }),
  ),
  boundaryChanges: z.array(z.object({ blockId: id, boundary: z.enum(["start", "end"]), occurrenceId: id })),
});
export const agendaDisplayRoleBlockSchema = z.object({
  id,
  name: z.string(),
  startAt: utcInstantSchema,
  endAt: utcInstantSchema,
  locationId: id.nullable(),
  track: agendaSessionTrackSchema.optional(),
  duties: z.array(z.object({ role: id, displayName: z.string() })),
});
export const agendaSnapshotSchema = z.object({
  eventSlug: id,
  eventName: z.string().optional(),
  approvedAt: utcInstantSchema.optional(),
  /** Captured by approval from owning-event visibility, never an authoring input. */
  calendarPublic: z.boolean().optional(),
  publicAgendaPath: sameOriginPathSchema.optional(),
  displayRoles: z.array(agendaDisplayRoleBlockSchema).optional(),
  timeZone: z.string(),
  eventStartsAt: utcInstantSchema.nullable().optional(),
  eventEndsAt: utcInstantSchema.nullable().optional(),
  revision: z.number().int().min(0),
  travelMinutes: z.number().int().min(0).max(120).default(0),
  durationRules: agendaDurationRulesSchema.optional(),
  publishedRevision: z.number().int().nullable(),
  rooms: z.array(agendaRoomSchema),
  occurrences: z.array(agendaOccurrenceSchema),
  blocks: z.array(agendaBlockSchema),
  roleMembers: z.array(agendaRoleMemberSchema),
  staffingRoles: z.array(agendaStaffingRoleSchema).max(100).default([]),
  staffingPosts: z.array(agendaStaffingPostSchema).max(200).default([]),
  staffingRequirements: z.array(agendaStaffingRequirementSchema).max(1000).default([]),
  staffingPositions: z.array(agendaStaffingPositionSchema).max(2000).default([]),
  assignments: z.array(agendaAssignmentSchema),
  staffingReport: agendaStaffingReportSchema.optional(),
});
export const agendaRevisionSchema = z.object({ expectedRevision: z.number().int().min(0) });
export const agendaRoomCreateSchema = agendaRoomSchema.omit({ id: true }).extend(agendaRevisionSchema.shape);
export const agendaOccurrenceCreateSchema = agendaOccurrenceFieldsSchema.extend({
  ...agendaRevisionSchema.shape,
  speakerRoles: z.record(id, agendaCreditRoleSchema).optional(),
  speakerPlacements: z.record(id, agendaSpeakerPlacementSchema).optional(),
  speakerUserIds: z
    .array(id)
    .max(30)
    .refine((values) => new Set(values).size === values.length, "Choose each speaker once")
    .default([]),
});
export const agendaOccurrencePatchSchema = agendaOccurrenceFieldsSchema.partial().extend({
  ...agendaRevisionSchema.shape,
  // Omitted PATCH fields must not inherit defaults intended for newly created occurrences.
  description: agendaOccurrenceFieldsSchema.shape.description.unwrap().optional(),
  admissionPolicy: agendaOccurrenceFieldsSchema.shape.admissionPolicy.unwrap().optional(),
  capacity: agendaOccurrenceFieldsSchema.shape.capacity.unwrap().optional(),
  remoteCapacity: agendaOccurrenceFieldsSchema.shape.remoteCapacity.unwrap().optional(),
  visibility: agendaOccurrenceFieldsSchema.shape.visibility.unwrap().optional(),
  kind: agendaOccurrenceFieldsSchema.shape.kind.unwrap().optional(),
  speakerRoles: z.record(id, agendaCreditRoleSchema).optional(),
  speakerPlacements: z.record(id, agendaSpeakerPlacementSchema).optional(),
  speakerUserIds: z
    .array(id)
    .max(30)
    .refine((values) => new Set(values).size === values.length, "Choose each speaker once")
    .optional(),
});
export const agendaStaffingSchema = agendaRevisionSchema
  .extend({
    blocks: z.array(agendaBlockSchema).max(200),
    roleMembers: z.array(agendaRoleMemberSchema).max(200),
    staffingRoles: z.array(agendaStaffingRoleSchema).max(100).default([]),
    staffingPosts: z.array(agendaStaffingPostSchema).max(200).default([]),
    staffingRequirements: z.array(agendaStaffingRequirementSchema).max(1000).default([]),
    staffingPositions: z.array(agendaStaffingPositionSchema).max(2000).default([]),
    assignments: z.array(agendaAssignmentSchema).max(2000),
  })
  .superRefine((input, context) => {
    const parsed = agendaStaffingPositionPlanSchema.safeParse({
      roles: input.staffingRoles,
      posts: input.staffingPosts,
      requirements: input.staffingRequirements,
      positions: input.staffingPositions,
      assignments: input.assignments,
    });
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        context.addIssue({ code: "custom", path: issue.path, message: issue.message });
    for (const requirement of input.staffingRequirements)
      if (!input.blocks.some((block) => block.id === requirement.blockId))
        context.addIssue({
          code: "custom",
          path: ["staffingRequirements"],
          message: "Choose a staffing block in this event",
        });
  });
export const agendaAllocationDiagnosticsSchema = z.object({
  uncovered: z.array(
    z.object({
      blockId: id,
      role: id,
      reasons: z.array(agendaStaffingReasonCountSchema),
    }),
  ),
});
export const agendaAllocationSchema = agendaRevisionSchema.extend({
  blockIds: z
    .array(id)
    .min(1)
    .max(200)
    .refine((values) => new Set(values).size === values.length, "Choose each block once")
    .optional(),
  seed: z.string().min(1).max(100),
  strategy: z.enum(["balanced", "random"]).default("balanced"),
});
export const agendaOccurrenceQuerySchema = listQuerySchema(["title", "startAt", "endAt"] as const).extend({
  roomId: id.optional(),
  admissionPolicy: agendaAdmissionPolicySchema.optional(),
  accessPolicy: agendaAccessPolicySchema.optional(),
  speakerUserId: id.optional(),
  publicationStatus: agendaPublicationStatusSchema.optional(),
  day: z.iso.date().optional(),
  visibility: agendaVisibilitySchema.optional(),
  kind: agendaSessionKindSchema.optional(),
  track: agendaSessionTrackSchema.optional(),
  conflict: z.enum(["all", "conflicted", "clear", "incomplete"]).default("all"),
});
export const agendaConflictCategorySchema = z.enum([
  "room_overlap",
  "room_setup",
  "room_unavailable",
  "speaker_conflict",
  "speaker_duty_conflict",
  "speaker_meeting_conflict",
]);
export const agendaConflictCoverageSchema = z.enum(["complete", "incomplete", "not_scheduled"]);
export const agendaOccurrenceListItemSchema = agendaOccurrenceSchema.extend({
  demand: sessionDemandSchema,
  conflicts: z.object({
    hasConflict: z.boolean(),
    categories: z.array(agendaConflictCategorySchema).max(6),
    coverage: agendaConflictCoverageSchema.default("complete"),
  }),
});
export const agendaOccurrenceListSchema = paginatedResponseSchema("occurrences", agendaOccurrenceListItemSchema);
export type AgendaSnapshot = z.infer<typeof agendaSnapshotSchema>;
export type AgendaOccurrence = z.infer<typeof agendaOccurrenceSchema>;
export type AgendaBlock = z.infer<typeof agendaBlockSchema>;
export type AgendaAssignment = z.infer<typeof agendaAssignmentSchema>;
export type AgendaRoleMember = z.infer<typeof agendaRoleMemberSchema>;
export const agendaPlacementFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const agendaProposalPlacementSchema = z
  .object({
    proposalId: id,
    startAt: utcInstantSchema,
    endAt: utcInstantSchema,
    roomId: id,
    additionalRoomIds: agendaOccurrenceFieldsSchema.shape.additionalRoomIds.default([]),
  })
  .refine((input) => input.startAt < input.endAt, { path: ["endAt"], message: "End must follow start" })
  .refine((input) => !input.additionalRoomIds.includes(input.roomId), {
    path: ["additionalRoomIds"],
    message: "Choose each room once",
  });
export const agendaImportSchema = agendaRevisionSchema
  .extend({
    source: z.enum(["accepted_proposals", "legacy"]),
    proposalPlacement: agendaProposalPlacementSchema.optional(),
    expectedPlacementFingerprint: agendaPlacementFingerprintSchema.optional(),
    proposalIds: z
      .array(id)
      .min(1)
      .max(100)
      .refine((values) => new Set(values).size === values.length, "Choose each proposal once")
      .optional(),
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
  })
  .refine((input) => input.source === "accepted_proposals" || !input.proposalIds, {
    path: ["proposalIds"],
    message: "Choose proposal IDs only for an accepted-proposal import",
  })
  .refine(
    (input) =>
      !input.proposalPlacement ||
      (input.source === "accepted_proposals" &&
        input.proposalIds?.length === 1 &&
        input.proposalIds[0] === input.proposalPlacement.proposalId),
    { path: ["proposalPlacement"], message: "Place exactly the selected accepted proposal" },
  )
  .refine((input) => !input.proposalPlacement || input.dryRun || Boolean(input.expectedPlacementFingerprint), {
    path: ["expectedPlacementFingerprint"],
    message: "Review this placement before applying it",
  });
export const agendaPlacementPreviewSchema = agendaOccurrenceFieldsSchema
  .pick({ title: true, description: true })
  .extend({ speakerCount: z.number().int().min(0).max(30) });
export const agendaImportResponseSchema = z.object({
  agenda: agendaSnapshotSchema,
  imported: z.number().int().min(0),
  skipped: z.number().int().min(0),
  dryRun: z.boolean(),
  reviewRequired: z.number().int().nonnegative().optional(),
  reviewSourceKeys: z.array(z.string().min(1).max(300)).max(2000).optional(),
  placementFingerprint: agendaPlacementFingerprintSchema.optional(),
  placementPreview: agendaPlacementPreviewSchema.optional(),
});
export const agendaPeopleQuerySchema = listQuerySchema(["name"] as const);
export const agendaPersonSchema = z.object({
  id: z.string(),
  email: z.string(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
});
export const agendaPeopleListSchema = paginatedResponseSchema("users", agendaPersonSchema);

export const agendaSettingsSchema = agendaRevisionSchema.extend({
  travelMinutes: z.number().int().min(0).max(120),
  durationRules: agendaDurationRulesSchema.optional(),
});
