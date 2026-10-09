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
import { proposalTypeSchema } from "./proposal-management";

const id = z.string().min(1).max(200);
export const agendaAdmissionPolicySchema = z.enum(["preference", "optional_reservation", "reservation", "approval"]);
export type AgendaAdmissionPolicy = z.infer<typeof agendaAdmissionPolicySchema>;
export const agendaAccessPolicySchema = z.enum(["open", "invitation"]);
export const agendaPublicationStatusSchema = z.enum(["published", "changed", "unpublished"]);
export const agendaVisibilitySchema = z.enum(["public", "private"]);
export const agendaSessionKindSchema = z.enum(["session", "break", "plenary"]);
/** Authored subject/program grouping, independent of physical rooms and agenda item type. */
export const agendaSessionTrackSchema = z.string().trim().min(1).max(160);
/** Session format (talk, panel, …): one of the owning event's configured session type labels, checked by the service. */
export const agendaSessionFormatSchema = proposalTypeSchema;
/** A configured session format offered for agenda authoring and public labelling. */
export const agendaSessionFormatOptionSchema = z.object({
  id: agendaSessionFormatSchema,
  label: z.string().trim().min(1).max(80),
});
export type AgendaSessionFormatOption = z.infer<typeof agendaSessionFormatOptionSchema>;
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
  /** Default virtual-room destination for sessions held here; private like a session's own link. */
  virtualRoomUrl: httpUrlSchema.nullable().optional(),
});
/** A session's own recording and live-streaming plan, replacing its primary location's planned media. */
export const agendaPlannedMediaSchema = z.object({ recording: z.boolean(), liveStreaming: z.boolean() });
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
  /**
   * Null or omitted: the session follows its primary location's planned media and virtual-room link.
   * An object overrides the location for this session; its virtual-room link is then `virtualRoomUrl` alone.
   */
  plannedMedia: agendaPlannedMediaSchema.nullable().optional(),
  admissionPolicy: agendaAdmissionPolicySchema.default("preference"),
  accessPolicy: agendaAccessPolicySchema.optional(),
  bookingOpensAt: utcInstantSchema.nullable().optional(),
  bookingClosesAt: utcInstantSchema.nullable().optional(),
  capacity: z.number().int().min(0).nullable().default(null),
  remoteCapacity: z.number().int().min(0).nullable().default(null),
  visibility: agendaVisibilitySchema.default("public"),
  kind: agendaSessionKindSchema.default("session"),
  track: agendaSessionTrackSchema.nullable().optional(),
  format: agendaSessionFormatSchema.nullable().optional(),
  /** Reserved slot whose content is still to be announced; omitted means false. */
  placeholder: z.boolean().optional(),
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
export const agendaShiftSchema = z
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
  .superRefine((shift, context) => {
    if (new Set(shift.roles).size !== shift.roles.length)
      context.addIssue({ code: "custom", path: ["roles"], message: "Choose each duty once" });
    const pairs = new Set<string>();
    for (const [index, pair] of (shift.compatibleRolePairs ?? []).entries()) {
      const key = JSON.stringify([...pair].sort());
      if (pair[0] === pair[1] || pair.some((role) => !shift.roles.includes(role)) || pairs.has(key))
        context.addIssue({
          code: "custom",
          path: ["compatibleRolePairs", index],
          message: "Choose one unique pair of different duties in this shift",
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
        shiftId: id,
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
      shiftId: id,
      role: id,
      positionId: id.optional(),
      postId: id.nullable().optional(),
      reasons: z.array(agendaStaffingReasonCountSchema).default([]),
      eligiblePeople: z.number().int().min(0).default(0),
    }),
  ),
  boundaryChanges: z.array(z.object({ shiftId: id, boundary: z.enum(["start", "end"]), occurrenceId: id })),
});
export const agendaDisplayRoleShiftSchema = z.object({
  id,
  name: z.string(),
  startAt: utcInstantSchema,
  endAt: utcInstantSchema,
  locationId: id.nullable(),
  track: agendaSessionTrackSchema.optional(),
  duties: z.array(z.object({ role: id, displayName: z.string() })),
});
/** Live organization of a credited acting identity; its logo is the organization's own public R2 mark. */
export const agendaSpeakerOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  logoUrl: httpOrSameOriginUrlSchema.nullable(),
});
export type AgendaSpeakerOrganization = z.infer<typeof agendaSpeakerOrganizationSchema>;
export const agendaSnapshotSchema = z.object({
  eventSlug: id,
  eventName: z.string().optional(),
  approvedAt: utcInstantSchema.optional(),
  /** Captured by approval from owning-event visibility, never an authoring input. */
  calendarPublic: z.boolean().optional(),
  publicAgendaPath: sameOriginPathSchema.optional(),
  displayRoles: z.array(agendaDisplayRoleShiftSchema).optional(),
  timeZone: z.string(),
  /** The owning event's configured session formats, captured with the agenda for authoring and labels. */
  formats: z.array(agendaSessionFormatOptionSchema).max(20).optional(),
  eventStartsAt: utcInstantSchema.nullable().optional(),
  eventEndsAt: utcInstantSchema.nullable().optional(),
  revision: z.number().int().min(0),
  travelMinutes: z.number().int().min(0).max(120).default(0),
  durationRules: agendaDurationRulesSchema.optional(),
  publishedRevision: z.number().int().nullable(),
  rooms: z.array(agendaRoomSchema),
  occurrences: z.array(agendaOccurrenceSchema),
  /** Keyed by credited acting identity ID; projected from live organization records, never frozen in a credit. */
  speakerOrganizations: z.record(id, agendaSpeakerOrganizationSchema).optional(),
  shifts: z.array(agendaShiftSchema),
  roleMembers: z.array(agendaRoleMemberSchema),
  staffingRoles: z.array(agendaStaffingRoleSchema).max(100).default([]),
  staffingPosts: z.array(agendaStaffingPostSchema).max(200).default([]),
  staffingRequirements: z.array(agendaStaffingRequirementSchema).max(1000).default([]),
  staffingPositions: z.array(agendaStaffingPositionSchema).max(2000).default([]),
  assignments: z.array(agendaAssignmentSchema),
  staffingReport: agendaStaffingReportSchema.optional(),
});
export const agendaRevisionSchema = z.object({ expectedRevision: z.number().int().min(0) });
export const agendaPublicationSchema = agendaRevisionSchema.extend({
  acknowledgeArchiveRepresentation: z.boolean().default(false),
});
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
    shifts: z.array(agendaShiftSchema).max(200),
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
    if (!parsed.success) {
      const fields = {
        roles: "staffingRoles",
        posts: "staffingPosts",
        requirements: "staffingRequirements",
        positions: "staffingPositions",
        assignments: "assignments",
      };
      for (const issue of parsed.error.issues) {
        const [first, ...remaining] = issue.path;
        const field =
          typeof first === "string" && Object.hasOwn(fields, first) ? fields[first as keyof typeof fields] : first;
        context.addIssue({
          code: "custom",
          path: field === undefined ? [] : [field, ...remaining],
          message: issue.message,
        });
      }
    }
    for (const requirement of input.staffingRequirements)
      if (!input.shifts.some((shift) => shift.id === requirement.shiftId))
        context.addIssue({
          code: "custom",
          path: ["staffingRequirements"],
          message: "Choose a staffing shift in this event",
        });
  });
export const agendaAllocationDiagnosticsSchema = z.object({
  uncovered: z.array(
    z.object({
      shiftId: id,
      role: id,
      reasons: z.array(agendaStaffingReasonCountSchema),
    }),
  ),
});
export const agendaAllocationSchema = agendaRevisionSchema.extend({
  shiftIds: z
    .array(id)
    .min(1)
    .max(200)
    .refine((values) => new Set(values).size === values.length, "Choose each shift once")
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
export type AgendaShift = z.infer<typeof agendaShiftSchema>;
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
