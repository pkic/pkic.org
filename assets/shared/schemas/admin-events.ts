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
import { attendanceTypeSchema, inviteeSchema } from "./registration";
import { sourceTypeSchema } from "./source";
import { eventSourceModeSchema } from "./event-series";
import { groupIdSchema } from "./groups";
import { proposalRecommendationSchema } from "./proposal-reviews";
import { proposalAdminStatusFilterSchema } from "./proposal-status";
import {
  eventCreateSchema,
  eventCustomSettingsSchema,
  eventSettingsSchema,
  isEventCustomSettingKey,
  type EventCreateInput,
  type EventSettingsInput,
} from "./event-management";
import {
  EVENT_REGISTRATIONS_SORT_COLUMNS,
  EVENT_REGISTRATION_STATUSES,
  EVENT_REGISTRATION_STATUS_FILTERS,
  EVENT_REGISTRATION_STATUS_LABELS,
  booleanQueryValueSchema,
  eventRegistrationAttendanceChangeFilterSchema,
  eventRegistrationAttendanceChangeSchema,
  eventRegistrationStatusFilterSchema,
  eventRegistrationStatusLabel,
  eventRegistrationStatusSchema,
  eventRegistrationSummarySchema,
  eventRegistrationsListResponseSchema,
  eventRegistrationsQuerySchema,
  eventRegistrationsStatsSchema,
  type EventRegistrationAttendanceChange,
  type EventRegistrationStatus,
  type EventRegistrationStatusFilter,
  type EventRegistrationSummary,
  type EventRegistrationsListResponse,
  type EventRegistrationsQuery,
  type EventRegistrationsStats,
} from "./event-registrations";
import { eventRegistrationAdmitSchema } from "./event-registration-detail";

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
  /** Source and ownership determine which portal or admin surface owns authoring. */
  ownerGroupId: groupIdSchema.nullable().default(null),
  sourceMode: eventSourceModeSchema.nullable().default(null),
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

/** @deprecated Import from event-registrations instead. */
export {
  EVENT_REGISTRATIONS_SORT_COLUMNS,
  booleanQueryValueSchema,
  eventRegistrationSummarySchema,
  eventRegistrationsListResponseSchema,
  eventRegistrationsQuerySchema,
  eventRegistrationsStatsSchema,
};
/** @deprecated Import from event-registrations instead. */
export type {
  EventRegistrationSummary,
  EventRegistrationsListResponse,
  EventRegistrationsQuery,
  EventRegistrationsStats,
};
/** @deprecated Use eventRegistrationStatusSchema from event-registrations. */
export const adminEventRegistrationStatusSchema = eventRegistrationStatusSchema;
export type AdminEventRegistrationStatus = EventRegistrationStatus;
/** @deprecated Use eventRegistrationStatusFilterSchema from event-registrations. */
export const adminEventRegistrationStatusFilterSchema = eventRegistrationStatusFilterSchema;
export type AdminEventRegistrationStatusFilter = EventRegistrationStatusFilter;
/** @deprecated Use eventRegistrationStatusLabel from event-registrations. */
export const adminEventRegistrationStatusLabel = eventRegistrationStatusLabel;
/** @deprecated Use EVENT_REGISTRATION_STATUSES from event-registrations. */
export const ADMIN_EVENT_REGISTRATION_STATUSES = EVENT_REGISTRATION_STATUSES;
/** @deprecated Use EVENT_REGISTRATION_STATUS_FILTERS from event-registrations. */
export const ADMIN_EVENT_REGISTRATION_STATUS_FILTERS = EVENT_REGISTRATION_STATUS_FILTERS;
/** @deprecated Use EVENT_REGISTRATION_STATUS_LABELS from event-registrations. */
export const ADMIN_EVENT_REGISTRATION_STATUS_LABELS = EVENT_REGISTRATION_STATUS_LABELS;
/** @deprecated Use eventRegistrationAttendanceChangeFilterSchema from event-registrations. */
export const adminEventAttendanceChangeSchema = eventRegistrationAttendanceChangeFilterSchema;
/** @deprecated Use eventRegistrationAttendanceChangeSchema from event-registrations. */
export const adminEventRegistrationAttendanceChangeSchema = eventRegistrationAttendanceChangeSchema;
export type AdminEventRegistrationAttendanceChange = EventRegistrationAttendanceChange;
/** @deprecated Use eventRegistrationsQuerySchema from event-registrations. */
export const adminEventRegistrationsQuerySchema = eventRegistrationsQuerySchema;
export type AdminEventRegistrationsQuery = EventRegistrationsQuery;
/** @deprecated Use eventRegistrationSummarySchema from event-registrations. */
export const adminEventRegistrationSummarySchema = eventRegistrationSummarySchema;
export type AdminEventRegistrationSummary = EventRegistrationSummary;
/** @deprecated Use eventRegistrationsStatsSchema from event-registrations. */
export const adminEventRegistrationsStatsSchema = eventRegistrationsStatsSchema;
export type AdminEventRegistrationsStats = EventRegistrationsStats;
/** @deprecated Use eventRegistrationsListResponseSchema from event-registrations. */
export const adminEventRegistrationsListResponseSchema = eventRegistrationsListResponseSchema;
export type AdminEventRegistrationsListResponse = EventRegistrationsListResponse;

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

/** @deprecated Import from event-management instead. */
export { eventCreateSchema, eventCustomSettingsSchema, eventSettingsSchema, isEventCustomSettingKey };
/** @deprecated Import from event-management instead. */
export type { EventCreateInput, EventSettingsInput };
/** @deprecated Use the event-management module instead. */
export const adminEventSettingsSchema = eventSettingsSchema;
/** @deprecated Use EventSettingsInput from event-management. */
export type AdminEventSettingsInput = EventSettingsInput;
/** @deprecated Use isEventCustomSettingKey from event-management. */
export const isAdminEventCustomSettingKey = isEventCustomSettingKey;
/** @deprecated Use eventCustomSettingsSchema from event-management. */
export const adminEventCustomSettingsSchema = eventCustomSettingsSchema;

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

/** @deprecated Use the domain-neutral eventCreateSchema. */
export const adminCreateEventSchema = eventCreateSchema;

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
/** @deprecated Use eventRegistrationAdmitSchema from event-registration-detail. */
export const adminRegistrationAdmitSchema = eventRegistrationAdmitSchema;

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
