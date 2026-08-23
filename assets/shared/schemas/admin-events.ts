import { z } from "zod";
import {
  eventIdSchema,
  eventSlugParamsSchema,
  emailMessageTypeSchema,
  frontendPathPattern,
  slugPattern,
  successResponseSchema,
  termKeyPattern,
  trimmedString,
  versionPattern,
} from "./api-common";
import {
  listQuerySchema,
  paginatedResponseSchema,
  searchableListQuerySchema,
  sortColumnSchema,
  sortColumnSchemaWithDefault,
} from "./pagination";
import { attendanceTypeSchema, dayDateSchema, inviteeSchema } from "./registration";
import { sourceTypeSchema } from "./source";
import { addDuplicateStringIssues } from "./refinements";
import { proposalRecommendationSchema } from "./proposal-reviews";
import { proposalAdminStatusFilterSchema } from "./proposal-status";
import { proposalSessionTypesSchema } from "./proposal-management";
import { httpOrSameOriginUrlSchema, httpUrlSchema } from "./urls";
import { adminRegistrationRecordContextSchema } from "./admin-registration-detail";
import { eventSummarySchema } from "./event-read-models";

export const EVENT_PROPOSALS_SORT_COLUMNS = [
  "submittedAt",
  "score",
  "reviews",
  "title",
  "proposer",
  "type",
  "status",
  "decision",
  "recommendations",
] as const;

export const adminEventProposalsQuerySchema = listQuerySchema(EVENT_PROPOSALS_SORT_COLUMNS).extend({
  sort: sortColumnSchemaWithDefault(EVENT_PROPOSALS_SORT_COLUMNS, "-submittedAt"),
  status: proposalAdminStatusFilterSchema.optional(),
  recommendation: proposalRecommendationSchema.optional(),
  deleted: z.literal("1").optional(),
});
export type AdminEventProposalsQuery = z.infer<typeof adminEventProposalsQuerySchema>;

export const EVENTS_LIST_SORT_COLUMNS = ["name", "starts_at", "registration_mode", "total_registrations"] as const;
export const eventsListSortValueSchema = sortColumnSchema(EVENTS_LIST_SORT_COLUMNS);
export const adminEventsListQuerySchema = searchableListQuerySchema(eventsListSortValueSchema);
export type AdminEventsListQuery = z.infer<typeof adminEventsListQuerySchema>;

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
export const adminEventDetailSchema = z.object({
  id: eventIdSchema,
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  registration_mode: z.string(),
  invite_limit_attendee: z.number(),
  base_path: z.string().nullable(),
  user_retention_days: z.number().nullable(),
  venue: z.string().nullable(),
  virtual_url: z.string().nullable(),
  hero_image_url: z.string().nullable(),
  location: z.string().nullable(),
  session_types: z.array(z.object({ label: z.string(), requiresPresentation: z.boolean() })).nullable(),
  settings: z.record(z.string(), z.unknown()),
});
export type AdminEventDetail = z.infer<typeof adminEventDetailSchema>;
export const adminEventDetailResponseSchema = z.object({ event: adminEventDetailSchema });
export const adminEventCreateResponseSchema = adminEventDetailResponseSchema;
export const adminEventUpdateResponseSchema = successResponseSchema.extend({ event: adminEventDetailSchema });
export const adminEventEmailSupportDaysResponseSchema = z.object({
  days: z.array(
    z.object({ day_date: z.string().optional(), date: z.string().optional(), label: z.string().nullable().optional() }),
  ),
});
export type AdminEventSummary = z.infer<typeof adminEventSummarySchema>;
export const adminEventsListResponseSchema = paginatedResponseSchema("events", adminEventSummarySchema);

export const EVENT_TEAM_SORT_COLUMNS = ["user_email", "role_id", "created_at", "expires_at"] as const;
export const eventTeamSortValueSchema = sortColumnSchema(EVENT_TEAM_SORT_COLUMNS);
export const adminEventTeamListQuerySchema = searchableListQuerySchema(eventTeamSortValueSchema, { limit: 100 });
export type AdminEventTeamListQuery = z.infer<typeof adminEventTeamListQuerySchema>;
/** Stable event-team permission vocabulary shared by API contracts and RBAC persistence. */
export const EVENT_TEAM_PERMISSIONS = ["organizer", "program_committee", "moderator", "volunteer"] as const;
export const eventTeamPermissionSchema = z.enum(EVENT_TEAM_PERMISSIONS);
export type EventTeamPermission = z.infer<typeof eventTeamPermissionSchema>;
/**
 * The event-team grants are persisted as ordinary context-scoped `user_roles` rows.
 * Keep this as the single permission-to-role vocabulary so services cannot drift in
 * their forward mapping, reverse mapping, or SQL role allowlists.
 */
export const EVENT_TEAM_PERMISSION_ROLE_IDS = {
  organizer: "role-event_organizer",
  program_committee: "role-program_committee",
  moderator: "role-event_moderator",
  volunteer: "role-event_volunteer",
} as const satisfies Record<EventTeamPermission, string>;
export type EventTeamRoleId = (typeof EVENT_TEAM_PERMISSION_ROLE_IDS)[EventTeamPermission];
export const adminEventTeamListItemSchema = z.object({
  id: z.string(),
  user_email: z.string(),
  user_id: z.string(),
  permission: eventTeamPermissionSchema,
  granted_by_id: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  granter_email: z.string().nullable(),
});
export type AdminEventTeamListItem = z.infer<typeof adminEventTeamListItemSchema>;
export const adminEventTeamListResponseSchema = paginatedResponseSchema("permissions", adminEventTeamListItemSchema);
export const adminEventTeamPermissionCreateResponseSchema = z.object({
  permission: adminEventTeamListItemSchema.pick({
    id: true,
    user_email: true,
    permission: true,
    expires_at: true,
    created_at: true,
  }),
});

export const EVENT_REGISTRATIONS_SORT_COLUMNS = ["display_name", "status", "attendance_type", "created_at"] as const;
export const ADMIN_EVENT_REGISTRATION_STATUSES = ["registered", "pending_email_confirmation", "cancelled"] as const;
export const ADMIN_EVENT_REGISTRATION_STATUS_FILTERS = ["all", ...ADMIN_EVENT_REGISTRATION_STATUSES] as const;
export const ADMIN_EVENT_REGISTRATION_STATUS_LABELS: Record<AdminEventRegistrationStatus, string> = {
  pending_email_confirmation: "Pending confirmation",
  registered: "Registered",
  cancelled: "Cancelled",
};
export const adminEventRegistrationStatusSchema = z.enum(ADMIN_EVENT_REGISTRATION_STATUSES);
export type AdminEventRegistrationStatus = z.infer<typeof adminEventRegistrationStatusSchema>;
export const adminEventRegistrationStatusFilterSchema = z.enum(ADMIN_EVENT_REGISTRATION_STATUS_FILTERS);
export type AdminEventRegistrationStatusFilter = z.infer<typeof adminEventRegistrationStatusFilterSchema>;
export function adminEventRegistrationStatusLabel(status: AdminEventRegistrationStatus): string {
  return ADMIN_EVENT_REGISTRATION_STATUS_LABELS[status];
}
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

export const adminEventRegistrationAttendanceChangeSchema = z.object({
  changedAt: z.string(),
  transitions: z.array(
    z.object({
      fromType: z.string(),
      toType: z.string(),
      days: z.array(z.object({ dayDate: z.string(), label: z.string().nullable() })),
    }),
  ),
});
export type AdminEventRegistrationAttendanceChange = z.infer<typeof adminEventRegistrationAttendanceChangeSchema>;
export const adminEventRegistrationSummarySchema = adminRegistrationRecordContextSchema.extend({
  id: z.string(),
  user_id: z.string(),
  status: adminEventRegistrationStatusSchema,
  attendance_type: z.string().nullable(),
  source_type: z.string().nullable(),
  rsvp_events_json: z.string().nullable(),
  has_bounced: z.boolean(),
  sponsor_consent: z.boolean(),
  custom_answers_json: z.string().nullable(),
  dayWaitlistSummary: z.string().nullable(),
  dayWaitlistCount: z.number(),
  attendanceChangeHistory: z.array(adminEventRegistrationAttendanceChangeSchema),
  lastAttendanceChange: adminEventRegistrationAttendanceChangeSchema.nullable(),
});
export type AdminEventRegistrationSummary = z.infer<typeof adminEventRegistrationSummarySchema>;
export const adminEventRegistrationsListResponseSchema = paginatedResponseSchema(
  "registrations",
  adminEventRegistrationSummarySchema,
).extend({
  event: eventSummarySchema,
  stats: z.object({
    byAttendanceType: z.record(z.string(), z.number()),
    attendanceStatusByType: z.record(z.string(), z.object({ accepted: z.number(), waitlisted: z.number() })),
    byStatus: z.record(z.string(), z.number()),
    bouncedCount: z.number(),
    consentCount: z.number(),
  }),
});
export type AdminEventRegistrationsListResponse = z.infer<typeof adminEventRegistrationsListResponseSchema>;

export const EVENT_INVITES_SORT_COLUMNS = ["invitee_email", "status", "created_at", "accepted_at"] as const;
export const eventInvitesSortValueSchema = sortColumnSchema(EVENT_INVITES_SORT_COLUMNS);
export const adminEventInvitesListQuerySchema = searchableListQuerySchema(eventInvitesSortValueSchema).extend({
  status: z.enum(["sent", "accepted", "declined", "expired", "revoked"]).optional(),
  type: z.enum(["attendee", "speaker"]).optional(),
});
export type AdminEventInvitesListQuery = z.infer<typeof adminEventInvitesListQuerySchema>;
export const adminEventInviteSummarySchema = z.object({
  id: z.string(),
  invitee_email: z.string(),
  invitee_first_name: z.string().nullable(),
  invitee_last_name: z.string().nullable(),
  invite_type: z.string(),
  status: z.string(),
  decline_reason_code: z.string().nullable(),
  decline_reason_note: z.string().nullable(),
  unsubscribe_future: z.number(),
  reminder_count: z.number(),
  source_type: z.string(),
  expires_at: z.string().nullable(),
  accepted_at: z.string().nullable(),
  declined_at: z.string().nullable(),
  created_at: z.string(),
  inviter_user_id: z.string().nullable(),
  inviter_email: z.string().nullable(),
  inviter_first_name: z.string().nullable(),
  inviter_last_name: z.string().nullable(),
});
export type AdminEventInviteSummary = z.infer<typeof adminEventInviteSummarySchema>;
export const adminEventInvitesListResponseSchema = paginatedResponseSchema("invites", adminEventInviteSummarySchema);

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

export const ADMIN_EVENT_MANAGED_SETTING_KEYS = [
  "forms",
  "heroImageUrl",
  "location",
  "proposal",
  "venue",
  "virtualUrl",
] as const;
const adminEventManagedSettingKeySet = new Set<string>(ADMIN_EVENT_MANAGED_SETTING_KEYS);
const unsafeObjectKeys = new Set(["__proto__", "constructor", "prototype"]);

export function isAdminEventCustomSettingKey(key: string): boolean {
  return !adminEventManagedSettingKeySet.has(key) && !unsafeObjectKeys.has(key);
}

export const adminEventCustomSettingsSchema = z
  .record(z.string().trim().min(1).max(80), z.unknown())
  .refine((settings) => Object.keys(settings).length <= 100, "At most 100 custom settings are allowed")
  .superRefine((settings, ctx) => {
    for (const key of Object.keys(settings)) {
      if (!isAdminEventCustomSettingKey(key)) {
        ctx.addIssue({ code: "custom", path: [key], message: `'${key}' is managed by a dedicated event setting` });
      }
    }
  });

export const adminEventSettingsSchema = z.object({
  name: trimmedString(3, 180).optional(),
  timezone: trimmedString(2, 64).optional(),
  startsAt: z.iso.datetime().nullable().optional(),
  endsAt: z.iso.datetime().nullable().optional(),
  venue: trimmedString(2, 500).nullable().optional(),
  virtualUrl: httpUrlSchema.nullable().optional(),
  heroImageUrl: httpOrSameOriginUrlSchema.nullable().optional(),
  location: trimmedString(2, 200).nullable().optional(),
  sessionTypes: proposalSessionTypesSchema.nullable().optional(),
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
  settings: adminEventCustomSettingsSchema.optional(),
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

export const adminEventDaysResponseSchema = z.object({
  days: z.array(
    z.object({
      id: z.string(),
      date: z.string(),
      label: z.string().nullable(),
      startsAt: z.string().nullable(),
      endsAt: z.string().nullable(),
      sortOrder: z.number(),
      attendanceOptions: z.array(adminAttendanceOptionSchema),
      attendanceCounts: z.record(z.string(), z.number()),
    }),
  ),
});
export const adminEventDaysReplaceResponseSchema = z.object({ skipped: z.array(z.string()).optional() });
export const adminEventTermsResponseSchema = z.object({
  terms: z.object({
    attendee: z.array(
      z.object({
        id: z.string(),
        audience_type: z.string(),
        term_key: z.string(),
        version: z.string(),
        required: z.number(),
        content_ref: z.string().nullable(),
        display_text: z.string().nullable(),
        help_text: z.string().nullable(),
      }),
    ),
    speaker: z.array(
      z.object({
        id: z.string(),
        audience_type: z.string(),
        term_key: z.string(),
        version: z.string(),
        required: z.number(),
        content_ref: z.string().nullable(),
        display_text: z.string().nullable(),
        help_text: z.string().nullable(),
      }),
    ),
    presentation: z.array(
      z.object({
        id: z.string(),
        audience_type: z.string(),
        term_key: z.string(),
        version: z.string(),
        required: z.number(),
        content_ref: z.string().nullable(),
        display_text: z.string().nullable(),
        help_text: z.string().nullable(),
      }),
    ),
  }),
});
export const adminEventEmailPreviewResponseSchema = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  recipientCount: z.number().optional(),
  previewToken: z.string().optional(),
});
export const adminEventEmailSendResponseSchema = z.object({
  queuedRecipients: z.number().optional(),
  queuedBatches: z.number().optional(),
});
export const adminInvitePreviewResponseSchema = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  previewToken: z.string(),
  inviteDigest: z.string(),
});
export const adminEventSponsorTiersResponseSchema = z.object({
  tiers: z.array(z.object({ tierName: z.string(), hasAttendeeDataAccess: z.boolean() })),
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
  virtualUrl: httpUrlSchema.nullable().optional(),
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
const adminBulkInviteResultSchema = z.object({ email: z.email() });
export const adminBulkInviteResponseSchema = successResponseSchema.extend({
  created: z.array(adminBulkInviteResultSchema),
  endorsed: z.array(adminBulkInviteResultSchema),
  skipped: z.array(adminBulkInviteResultSchema),
});
export const adminWaitlistPromotionResponseSchema = successResponseSchema.extend({
  dayRegistrationOffers: z.number().int().nonnegative(),
  affectedRegistrations: z.array(z.string()),
});
export const adminRegistrationAdmitSchema = z.object({
  mode: z.enum(["vip", "capacity_exempt"]).default("vip"),
  reason: trimmedString(3, 1000),
  dayDates: z.array(dayDateSchema).min(1).max(31).optional(),
});

export const adminManageDayAttendanceSchema = z.object({
  action: z.enum(["in_person", "virtual", "on_demand", "remove", "waitlist"]),
  dayDates: z.array(dayDateSchema).min(1).max(31),
});
export type AdminManageDayAttendanceInput = z.infer<typeof adminManageDayAttendanceSchema>;

const campaignFilterSchema = z.object({
  audience: z.enum(["attendees", "speakers"]),
  attendeeStatus: adminEventRegistrationStatusFilterSchema.optional(),
  attendanceType: z.union([z.literal("all"), attendanceTypeSchema]).optional(),
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
