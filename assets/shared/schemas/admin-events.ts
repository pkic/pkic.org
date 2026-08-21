import { z } from "zod";
import {
  eventIdSchema,
  eventSlugParamsSchema,
  emailMessageTypeSchema,
  frontendPathPattern,
  slugPattern,
  termKeyPattern,
  trimmedString,
  versionPattern,
} from "./api-common";
import { paginatedResponseSchema, searchableListQuerySchema, sortColumnSchema } from "./pagination";
import { dayDateSchema, inviteeSchema } from "./registration";
import { sourceTypeSchema } from "./source";
import { addDuplicateStringIssues } from "./refinements";
import { proposalRecommendationSchema } from "./proposal-reviews";

const eventProposalsSortSchema = z
  .enum([
    "submitted_desc",
    "submitted_asc",
    "score_desc",
    "score_asc",
    "reviews_desc",
    "reviews_asc",
    "title_desc",
    "title_asc",
    "proposer_desc",
    "proposer_asc",
    "type_desc",
    "type_asc",
    "status_desc",
    "status_asc",
    "decision_desc",
    "decision_asc",
    "recommendations_desc",
    "recommendations_asc",
  ])
  .optional();

export const adminEventProposalsQuerySchema = searchableListQuerySchema(eventProposalsSortSchema).extend({
  status: z
    .enum([
      "active",
      "submitted",
      "resubmitted",
      "under_review",
      "accepted",
      "rejected",
      "needs-work",
      "withdrawn",
      "spam",
      "duplicate",
    ])
    .optional(),
  recommendation: proposalRecommendationSchema.optional(),
  deleted: z.literal("1").optional(),
});

export const EVENTS_LIST_SORT_COLUMNS = ["name", "starts_at", "registration_mode", "total_registrations"] as const;
export const eventsListSortValueSchema = sortColumnSchema(EVENTS_LIST_SORT_COLUMNS);
export const adminEventsListQuerySchema = searchableListQuerySchema(eventsListSortValueSchema);

export const adminEventSummarySchema = z.object({
  id: eventIdSchema,
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  registration_mode: z.string(),
  invite_limit_attendee: z.number(),
  confirmed_registrations: z.number(),
  total_registrations: z.number(),
  pending_invites: z.number(),
});
export type AdminEventSummary = z.infer<typeof adminEventSummarySchema>;
export const adminEventsListResponseSchema = paginatedResponseSchema("events", adminEventSummarySchema);

export const EVENT_TEAM_SORT_COLUMNS = ["user_email", "role_id", "created_at", "expires_at"] as const;
export const eventTeamSortValueSchema = sortColumnSchema(EVENT_TEAM_SORT_COLUMNS);
export const adminEventTeamListQuerySchema = searchableListQuerySchema(eventTeamSortValueSchema);
export const eventTeamPermissionSchema = z.enum(["organizer", "program_committee", "moderator", "volunteer"]);
export type EventTeamPermission = z.infer<typeof eventTeamPermissionSchema>;
export const adminEventTeamListItemSchema = z.object({
  id: z.string(),
  user_email: z.string().nullable(),
  user_id: z.string().nullable(),
  permission: eventTeamPermissionSchema,
  granted_by_id: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  granter_email: z.string().nullable(),
});
export type AdminEventTeamListItem = z.infer<typeof adminEventTeamListItemSchema>;
export const adminEventTeamListResponseSchema = paginatedResponseSchema("permissions", adminEventTeamListItemSchema);

export const EVENT_REGISTRATIONS_SORT_COLUMNS = ["display_name", "status", "attendance_type", "created_at"] as const;
export const adminEventRegistrationStatusSchema = z.enum(["registered", "pending_email_confirmation", "cancelled"]);
export const adminEventAttendanceChangeSchema = z.enum(["any", "left_in_person", "joined_in_person"]);
export const booleanQueryValueSchema = z.enum(["true", "false"]);
export const adminEventRegistrationsQuerySchema = searchableListQuerySchema(
  sortColumnSchema(EVENT_REGISTRATIONS_SORT_COLUMNS),
).extend({
  status: adminEventRegistrationStatusSchema.optional(),
  bounced: booleanQueryValueSchema.optional(),
  consent: booleanQueryValueSchema.optional(),
  attendance_change: adminEventAttendanceChangeSchema.optional(),
});
export type AdminEventRegistrationsQuery = z.infer<typeof adminEventRegistrationsQuerySchema>;

export const EVENT_INVITES_SORT_COLUMNS = ["invitee_email", "status", "created_at", "accepted_at"] as const;
export const eventInvitesSortValueSchema = sortColumnSchema(EVENT_INVITES_SORT_COLUMNS);
export const adminEventInvitesListQuerySchema = searchableListQuerySchema(eventInvitesSortValueSchema).extend({
  status: z.enum(["sent", "accepted", "declined", "expired", "revoked"]).optional(),
  type: z.enum(["attendee", "speaker"]).optional(),
});

export const eventPresentationArchiveQuerySchema = z.object({
  versions: z.literal("all").optional(),
});
export const eventPresentationArchiveDownloadRouteSchema = {
  tags: ["Admin events"],
  summary: "Download event presentations",
  request: { params: eventSlugParamsSchema, query: eventPresentationArchiveQuerySchema },
  responses: {
    "200": { description: "ZIP archive of current presentations, or every version when versions=all." },
    "404": { description: "No presentations found." },
    "503": { description: "Presentation storage is not configured." },
  },
};

const termSchema = z.object({
  termKey: z.string().trim().regex(termKeyPattern),
  version: z.string().trim().regex(versionPattern),
  required: z.boolean().optional(),
  contentRef: trimmedString(1, 500).optional(),
  displayText: trimmedString(3, 4000).optional(),
});

const frontendRoutesSchema = z.object({
  registration: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  registrationConfirm: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  proposal: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  registrationManage: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  proposalManage: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  speakerManage: z.string().trim().regex(frontendPathPattern).max(300).optional(),
});

export const adminEventSyncSchema = z.object({
  event: z.object({
    slug: z.string().trim().regex(slugPattern),
    name: trimmedString(3, 180),
    timezone: trimmedString(2, 64),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
    registrationMode: z.enum(["invite_only", "invite_or_open", "open"]).optional(),
    inviteLimitAttendee: z.number().int().positive().max(50).optional(),
    frontend: z.object({ routes: frontendRoutesSchema }).optional(),
    settings: z.record(z.string().trim().min(1).max(80), z.unknown()).optional(),
  }),
  terms: z
    .object({
      attendee: z.array(termSchema).max(40).default([]),
      speaker: z.array(termSchema).max(40).default([]),
    })
    .optional(),
});
export type AdminEventSyncInput = z.infer<typeof adminEventSyncSchema>;

export const adminEventSettingsSchema = z.object({
  name: trimmedString(3, 180).optional(),
  timezone: trimmedString(2, 64).optional(),
  startsAt: z.iso.datetime().nullable().optional(),
  endsAt: z.iso.datetime().nullable().optional(),
  venue: trimmedString(2, 500).nullable().optional(),
  virtualUrl: z.string().trim().url().max(500).nullable().optional(),
  heroImageUrl: trimmedString(2, 500).nullable().optional(),
  location: trimmedString(2, 200).nullable().optional(),
  sessionTypes: z
    .array(z.object({ label: z.string().trim().min(1).max(80), requiresPresentation: z.boolean() }))
    .max(20)
    .nullable()
    .optional(),
  registrationFormKey: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9-]*$/)
    .nullable()
    .optional(),
  proposalFormKey: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9-]*$/)
    .nullable()
    .optional(),
  registrationMode: z.enum(["invite_only", "invite_or_open", "open"]).optional(),
  inviteLimitAttendee: z.number().int().positive().max(50).optional(),
  settings: z.record(z.string().trim().min(1).max(80), z.unknown()).optional(),
  userRetentionDays: z.number().int().positive().max(3650).optional(),
});
export type AdminEventSettingsInput = z.infer<typeof adminEventSettingsSchema>;

export const adminEventTermInputSchema = z.object({
  termKey: z.string().trim().regex(termKeyPattern),
  version: z.string().trim().regex(versionPattern),
  required: z.boolean().default(true),
  contentRef: trimmedString(1, 500).optional(),
  displayText: trimmedString(3, 4000),
  helpText: trimmedString(3, 2000).optional(),
});

export const adminEventTermsReplaceSchema = z
  .object({
    attendee: z.array(adminEventTermInputSchema).max(40).default([]),
    speaker: z.array(adminEventTermInputSchema).max(40).default([]),
    presentation: z.array(adminEventTermInputSchema).max(40).default([]),
  })
  .superRefine((value, ctx) => {
    for (const audience of ["attendee", "speaker", "presentation"] as const) {
      addDuplicateStringIssues(value[audience], ctx, {
        value: (term) => `${term.termKey}:${term.version}`,
        path: (index) => [audience, index, "termKey"],
        label: "Term version",
      });
    }
  });

export const adminAttendanceOptionSchema = z.object({
  value: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z_][a-z0-9_]*$/),
  label: trimmedString(1, 80),
  capacity: z.number().int().positive().nullable().optional(),
});

export const adminEventDayInputSchema = z
  .object({
    date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/),
    label: trimmedString(1, 200).optional(),
    startTime: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    endTime: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    attendanceOptions: z.array(adminAttendanceOptionSchema).max(20).default([]),
  })
  .superRefine((value, ctx) => {
    addDuplicateStringIssues(value.attendanceOptions, ctx, {
      value: (option) => option.value,
      path: (index) => ["attendanceOptions", index, "value"],
      label: "Attendance option",
    });
  });

export const adminEventDaysReplaceSchema = z
  .object({ days: z.array(adminEventDayInputSchema).max(31) })
  .superRefine((value, ctx) => {
    addDuplicateStringIssues(value.days, ctx, {
      value: (day) => day.date,
      path: (index) => ["days", index, "date"],
      label: "Event day",
    });
  });

export const adminCreateEventSchema = z.object({
  slug: z.string().trim().regex(slugPattern),
  name: trimmedString(3, 180),
  timezone: trimmedString(2, 64).default("UTC"),
  startsAt: z.iso.datetime().nullable().optional(),
  endsAt: z.iso.datetime().nullable().optional(),
  registrationMode: z.enum(["invite_only", "invite_or_open", "open"]).default("invite_or_open"),
  inviteLimitAttendee: z.number().int().positive().max(50).default(5),
  venue: trimmedString(2, 500).nullable().optional(),
  virtualUrl: z.string().trim().url().max(500).nullable().optional(),
});

export const adminEventPermissionSchema = z.object({
  userEmail: z.email().trim().toLowerCase(),
  permission: eventTeamPermissionSchema,
  expiresAt: z.iso.datetime().nullable().optional(),
});
export type AdminEventPermissionInput = z.infer<typeof adminEventPermissionSchema>;

const bulkInviteNameSchema = (max: number) => z.string().trim().min(1).max(max).optional();
const bulkInviteeSchema = inviteeSchema.extend({
  firstName: bulkInviteNameSchema(80),
  lastName: bulkInviteNameSchema(120),
  sourceType: sourceTypeSchema.optional(),
});

const adminBulkInvitesSchema = z.object({
  previewToken: z.string().trim().min(16).max(2048),
  inviteDigest: z.string().max(128).optional(),
  invites: z.array(bulkInviteeSchema).min(1).max(2000),
});

const adminBulkInvitesPreviewSchema = z.object({
  invites: z.array(bulkInviteeSchema).min(1).max(50000),
});

export const adminBulkAttendeeInvitesSchema = adminBulkInvitesSchema;
export const adminBulkSpeakerInvitesSchema = adminBulkInvitesSchema;
export const adminBulkAttendeeInvitesPreviewSchema = adminBulkInvitesPreviewSchema;
export const adminBulkSpeakerInvitesPreviewSchema = adminBulkInvitesPreviewSchema;

export const adminRegistrationAdmitSchema = z.object({
  mode: z.enum(["vip", "capacity_exempt"]).default("vip"),
  reason: trimmedString(3, 1000),
  dayDates: z.array(dayDateSchema).min(1).max(31).optional(),
});

export const adminManageDayAttendanceSchema = z.object({
  action: z.enum(["in_person", "virtual", "on_demand", "remove"]),
  dayDates: z.array(dayDateSchema).min(1).max(31),
});
export type AdminManageDayAttendanceInput = z.infer<typeof adminManageDayAttendanceSchema>;

const campaignFilterSchema = z.object({
  audience: z.enum(["attendees", "speakers"]),
  attendeeStatus: z.enum(["all", "registered", "pending_email_confirmation", "cancelled"]).optional(),
  attendanceType: z.enum(["all", "in_person", "virtual", "on_demand"]).optional(),
  dayDate: z.string().trim().max(20).optional(),
  dayWaitlistStatus: z.enum(["all", "active", "waiting", "offered", "accepted", "none"]).optional(),
  speakerStatus: z.enum(["all", "confirmed", "invited", "pending"]).optional(),
});

const campaignBaseSchema = z.object({
  templateKey: z.string().trim().min(1).max(200).optional(),
  subjectOverride: z.string().trim().min(1).max(500).optional(),
  customText: z.string().trim().max(100_000).optional(),
  bodyContent: z.string().trim().max(100_000).optional(),
  messageType: emailMessageTypeSchema.optional(),
  sendMode: z.enum(["personal", "bcc_batch"]),
  batchSize: z.number().int().min(1).max(500).default(50),
  filter: campaignFilterSchema,
});

export const adminEventCampaignPreviewSchema = campaignBaseSchema;
export const adminEventCampaignSendSchema = campaignBaseSchema.extend({
  previewToken: z.string().trim().min(16).max(2048),
});
