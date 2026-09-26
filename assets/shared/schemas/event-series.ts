/** Shared event-profile, recurrence, occurrence, guest, and meeting-entry contracts. */
import { z } from "zod";
import { isMeetingLocationUrl } from "../meeting-calendar-policy";
import {
  booleanQueryFlagSchema,
  eventIdSchema,
  jsonErrorResponse,
  normalizedEmailSchema,
  trimmedString,
  utcInstantSchema,
} from "./api-common";
import { groupIdSchema, groupReferenceSchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { httpsCapabilityUrlSchema } from "./urls";
import { eventGroupGrantSchemas } from "./resource-grants";
import { eventInviteValiditySchema, eventInviteWindowSchema } from "./event-invite-validity";
import { requiresSession } from "./route-contract";
import { DEFAULT_MEETING_ENTRY_POLICY, meetingEntryPolicySchema } from "./meeting-entry-policy";

export const EVENT_PROFILE_KEYS = ["meeting", "board_meeting", "conference", "workshop", "tutorial"] as const;
export const eventProfileKeySchema = z.enum(EVENT_PROFILE_KEYS);
export type EventProfileKey = z.infer<typeof eventProfileKeySchema>;
/**
 * Standalone events are not meeting series. Meetings and board meetings must
 * be created through the meeting-series workflow so occurrences remain the
 * source of truth.
 */
export const STANDALONE_EVENT_PROFILE_KEYS = ["conference", "workshop", "tutorial"] as const;
export const standaloneEventProfileKeySchema = z.enum(STANDALONE_EVENT_PROFILE_KEYS);
export type StandaloneEventProfileKey = z.infer<typeof standaloneEventProfileKeySchema>;
export const EVENT_PROFILE_LABELS: Record<EventProfileKey, string> = {
  meeting: "Meeting",
  board_meeting: "Board meeting",
  conference: "Conference",
  workshop: "Workshop",
  tutorial: "Tutorial",
};
export const EVENT_SOURCE_MODES = ["hugo", "portal", "integration"] as const;
export const eventSourceModeSchema = z.enum(EVENT_SOURCE_MODES);
export type EventSourceMode = z.infer<typeof eventSourceModeSchema>;
/** Where an event is authored, in product language rather than schema keys. */
export const EVENT_SOURCE_MODE_LABELS = {
  hugo: "Website content",
  portal: "Portal",
  integration: "Integration",
} as const satisfies Record<EventSourceMode, string>;

export const EVENT_VISIBILITIES = ["invitation_only", "group_members", "all_members", "public"] as const;
export const eventVisibilitySchema = z.enum(EVENT_VISIBILITIES);
export type EventVisibility = z.infer<typeof eventVisibilitySchema>;
export const EVENT_VISIBILITY_LABELS = {
  invitation_only: "Invited participants only",
  group_members: "Members of this group and of the groups it is shared with",
  all_members: "All consortium members",
  public: "Public",
} as const satisfies Record<EventVisibility, string>;

export const EVENT_REGISTRATION_POLICIES = [
  "no_registration",
  "automatic",
  "optional",
  "invitation_only",
  "required",
  "public",
] as const;
export const eventRegistrationPolicySchema = z.enum(EVENT_REGISTRATION_POLICIES);
export type EventRegistrationPolicy = z.infer<typeof eventRegistrationPolicySchema>;
export const EVENT_REGISTRATION_POLICY_LABELS = {
  no_registration: "No registration",
  automatic: "Automatic for group members (opt-out)",
  optional: "Optional registration",
  invitation_only: "Invitation only",
  required: "Registration required",
  public: "Public registration",
} as const satisfies Record<EventRegistrationPolicy, string>;
/**
 * What each policy means, in the words the form shows beside it. "Automatic"
 * is the mailing-list model (#103): every member of the group is invited to
 * each scheduled occurrence without registering, and somebody who joins the
 * group later is invited to the upcoming ones as they join.
 */
export const EVENT_REGISTRATION_POLICY_HELP = {
  no_registration: "Nobody registers; managers send join links by hand.",
  automatic:
    "Every group member receives one recurring calendar invitation. New members receive the current calendar; changed or canceled meetings send updates. Calendar accept and decline responses are recorded.",
  optional: "Members may register, but attending does not require it.",
  invitation_only: "Only people with an invitation may register.",
  required: "Attending requires a registration.",
  public: "Anyone may register, member or not.",
} as const satisfies Record<EventRegistrationPolicy, string>;
/** The policies a standalone event may use: automatic invitation is a meeting's, since it needs a group roster. */
export const STANDALONE_EVENT_REGISTRATION_POLICIES = EVENT_REGISTRATION_POLICIES.filter(
  (policy) => policy !== "automatic",
);
export const EVENT_GUEST_POLICIES = ["none", "occurrence_invitation", "public_registration"] as const;
export const eventGuestPolicySchema = z.enum(EVENT_GUEST_POLICIES);
export type EventGuestPolicy = z.infer<typeof eventGuestPolicySchema>;

export const EVENT_MEMBER_ELIGIBILITIES = ["owner_group", "shared_groups", "public"] as const;
export const eventMemberEligibilitySchema = z.enum(EVENT_MEMBER_ELIGIBILITIES);
export type EventMemberEligibility = z.infer<typeof eventMemberEligibilitySchema>;

export const eventProfilePolicySchema = z.object({
  registrationPolicy: eventRegistrationPolicySchema,
  visibility: eventVisibilitySchema.default("group_members"),
  memberEligibility: eventMemberEligibilitySchema,
  guestPolicy: eventGuestPolicySchema,
  meetingEntryPolicy: meetingEntryPolicySchema.default(DEFAULT_MEETING_ENTRY_POLICY),
});

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(isValidTimeZone, "Unknown IANA time zone")
  .refine(
    (value) => value === "UTC" || value.includes("/"),
    "Use an IANA time zone identifier such as Europe/Amsterdam, not an abbreviation",
  );
export const recurrenceRuleSchema = z
  .string()
  .trim()
  .min(6)
  .max(1024)
  .refine((value) => /(?:^|;)FREQ=(?:DAILY|WEEKLY|MONTHLY|YEARLY)(?:;|$)/.test(value), "Invalid recurrence rule");

export const EVENT_PROVIDER_TYPES = ["external_url", "microsoft_graph", "cloudflare_meet"] as const;
export const eventProviderTypeSchema = z.enum(EVENT_PROVIDER_TYPES);
export type EventProviderType = z.infer<typeof eventProviderTypeSchema>;

export const eventSeriesSchema = z.object({
  id: databaseIdSchema,
  eventId: eventIdSchema,
  ownerGroupId: groupIdSchema,
  eventName: z.string(),
  eventSlug: z.string(),
  profileKey: eventProfileKeySchema,
  registrationPolicy: eventRegistrationPolicySchema,
  visibility: eventVisibilitySchema,
  memberEligibility: eventProfilePolicySchema.shape.memberEligibility.optional(),
  guestPolicy: eventGuestPolicySchema.optional(),
  meetingEntryPolicy: meetingEntryPolicySchema,
  startsAt: utcInstantSchema,
  recurrenceRule: recurrenceRuleSchema,
  timezone: timeZoneSchema,
  durationMinutes: z
    .number()
    .int()
    .min(1)
    .max(7 * 24 * 60),
  location: z.string().nullable(),
  providerType: eventProviderTypeSchema.nullable(),
  providerConfigured: z.boolean(),
  active: z.boolean(),
  inviteWindow: eventInviteWindowSchema,
  nextOccurrenceAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EventSeries = z.infer<typeof eventSeriesSchema>;

/** Group-context projection with live effective resource capabilities. */
export const groupEventSeriesSchema = eventSeriesSchema.extend({
  capabilities: z.array(eventGroupGrantSchemas.capabilitySchema).max(eventGroupGrantSchemas.capabilities.length),
  occurrenceCount: z.number().int().min(0),
});
export type GroupEventSeries = z.infer<typeof groupEventSeriesSchema>;

export const eventSeriesCreateSchema = z.object({
  existingEventId: eventIdSchema.optional(),
  eventName: trimmedString(1, 200),
  eventSlug: z.string().trim().min(1).max(200),
  profileKey: eventProfileKeySchema.default("meeting"),
  policy: eventProfilePolicySchema,
  startsAt: utcInstantSchema,
  recurrenceRule: recurrenceRuleSchema,
  timezone: timeZoneSchema,
  durationMinutes: z
    .number()
    .int()
    .min(1)
    .max(7 * 24 * 60),
  location: trimmedString(0, 500)
    .nullable()
    .refine((value) => !isMeetingLocationUrl(value), "Use the private meeting destination field for URLs")
    .optional(),
  providerType: eventProviderTypeSchema.nullable().optional(),
  providerJoinUrl: httpsCapabilityUrlSchema.nullable().optional(),
});
export const eventSeriesUpdateSchema = eventSeriesCreateSchema
  .omit({ eventSlug: true, existingEventId: true })
  .partial()
  .extend({
    // `partial()` preserves Zod defaults. A PATCH that omitted profileKey
    // must not silently reset a board meeting or workshop to `meeting`.
    profileKey: eventProfileKeySchema.optional(),
    active: z.boolean().optional(),
    expectedUpdatedAt: utcInstantSchema,
  });

export const eventSeriesMaterializeSchema = z.object({
  through: utcInstantSchema,
  maxOccurrences: z.number().int().min(1).max(500).default(200),
});
export const eventSeriesMaterializeResponseSchema = z.object({
  created: z.number().int().min(0),
  existing: z.number().int().min(0),
  through: utcInstantSchema,
});

export const EVENT_SERIES_SORT_COLUMNS = ["event_name", "next_occurrence_at", "created_at"] as const;
export const eventSeriesListQuerySchema = listQuerySchema(EVENT_SERIES_SORT_COLUMNS).extend({
  active: booleanQueryFlagSchema.optional(),
  profileKey: eventProfileKeySchema.optional(),
});
export const eventSeriesListResponseSchema = paginatedResponseSchema("series", groupEventSeriesSchema);

export const EVENT_OCCURRENCE_STATUSES = ["scheduled", "cancelled", "completed"] as const;
export const eventOccurrenceStatusSchema = z.enum(EVENT_OCCURRENCE_STATUSES);
export type EventOccurrenceStatus = z.infer<typeof eventOccurrenceStatusSchema>;
export const eventOccurrenceSchema = z.object({
  id: databaseIdSchema,
  seriesId: databaseIdSchema,
  startsAt: utcInstantSchema,
  endsAt: utcInstantSchema,
  status: eventOccurrenceStatusSchema,
  locationOverride: z.string().nullable(),
  location: z.string().nullable(),
  providerConfigured: z.boolean().optional(),
  guestCount: z.number().int().min(0),
  joinConfirmedCount: z.number().int().min(0),
  attendanceVerifiedCount: z.number().int().min(0),
  /** How many rounds of participant join links have gone out; 0 means none. */
  invitationsRound: z.number().int().min(0),
  /** When the most recent round was sent, or `null` while none has been. */
  invitationsSentAt: z.string().nullable(),
  /** How many people hold an invitation to this occurrence, whichever way it reached them. */
  invitedCount: z.number().int().min(0),
  /** The iCalendar SEQUENCE the invited calendars hold; bumped when the meeting moves or is called off. */
  calendarSequence: z.number().int().min(0),
  /** What invited calendars have answered so far. */
  rsvp: z.object({
    accepted: z.number().int().min(0),
    declined: z.number().int().min(0),
    tentative: z.number().int().min(0),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EventOccurrence = z.infer<typeof eventOccurrenceSchema>;

/**
 * What one round of participant join links did.
 *
 * The link itself is not in here and is not per-recipient state: a
 * participant's link is the occurrence's own join page, which is personal
 * because entering it needs their session — that is what binds attendance to
 * a person and makes a forwarded link useless to whoever receives it.
 */
export const eventOccurrenceInvitationsResultSchema = z.object({
  round: z.number().int().min(1),
  /** Participants the round was queued for. */
  recipientCount: z.number().int().min(0),
  sentAt: utcInstantSchema,
});
export type EventOccurrenceInvitationsResult = z.infer<typeof eventOccurrenceInvitationsResultSchema>;
export const eventOccurrenceInvitationsResponseSchema = z.object({
  invitations: eventOccurrenceInvitationsResultSchema,
});

const eventOccurrenceInputSchema = z.object({
  startsAt: utcInstantSchema,
  endsAt: utcInstantSchema,
  locationOverride: trimmedString(0, 500)
    .nullable()
    .refine((value) => !isMeetingLocationUrl(value), "Use the private meeting destination field for URLs")
    .optional(),
  providerJoinUrl: httpsCapabilityUrlSchema.nullable().optional(),
});
export const eventOccurrenceCreateSchema = eventOccurrenceInputSchema.refine((value) => value.endsAt > value.startsAt, {
  message: "Occurrence must end after it starts",
  path: ["endsAt"],
});
export const eventOccurrenceUpdateSchema = eventOccurrenceInputSchema
  .partial()
  .extend({
    status: eventOccurrenceStatusSchema.optional(),
    expectedUpdatedAt: utcInstantSchema,
  })
  .refine((value) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt, {
    message: "Occurrence must end after it starts",
    path: ["endsAt"],
  });

export const EVENT_OCCURRENCE_SORT_COLUMNS = ["starts_at", "ends_at", "status"] as const;
export const eventOccurrencesListQuerySchema = listQuerySchema(EVENT_OCCURRENCE_SORT_COLUMNS).extend({
  status: eventOccurrenceStatusSchema.optional(),
  from: utcInstantSchema.optional(),
  to: utcInstantSchema.optional(),
});
export const eventOccurrencesListResponseSchema = paginatedResponseSchema("occurrences", eventOccurrenceSchema);

export const eventOccurrenceGuestSchema = z.object({
  id: databaseIdSchema,
  occurrenceId: databaseIdSchema,
  seriesId: databaseIdSchema.optional(),
  seriesWide: z.boolean().optional(),
  userId: databaseIdSchema.nullable(),
  email: z.email(),
  name: z.string(),
  affiliation: z.string().nullable(),
  expiresAt: z.string(),
  active: z.boolean(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EventOccurrenceGuest = z.infer<typeof eventOccurrenceGuestSchema>;
export const eventOccurrenceGuestInviteSchema = z
  .object({
    email: normalizedEmailSchema,
    name: trimmedString(1, 200),
    affiliation: trimmedString(0, 200).nullable().optional(),
    seriesWide: z.boolean().optional(),
  })
  .extend(eventInviteValiditySchema.shape);
export const eventOccurrenceGuestsListQuerySchema = listQuerySchema(["name", "email", "created_at"] as const).extend({
  active: booleanQueryFlagSchema.optional(),
});
export const eventOccurrenceGuestsListResponseSchema = paginatedResponseSchema("guests", eventOccurrenceGuestSchema);

export const ATTENDANCE_VERIFICATION_SOURCES = ["microsoft_graph", "cloudflare_meet", "manual"] as const;
export const attendanceVerificationSourceSchema = z.enum(ATTENDANCE_VERIFICATION_SOURCES);
export const attendanceVerifySchema = z.object({
  source: attendanceVerificationSourceSchema,
  verifiedAt: utcInstantSchema.optional(),
  note: trimmedString(0, 500).optional(),
});

export const eventOccurrenceJoinConfirmationSchema = z.object({
  id: databaseIdSchema,
  occurrenceId: databaseIdSchema,
  userId: databaseIdSchema.nullable(),
  guestId: databaseIdSchema.nullable(),
  name: z.string(),
  affiliation: z.string().nullable(),
  joinCount: z.number().int().min(1),
  confirmedAt: z.string(),
  attendanceVerifiedAt: z.string().nullable(),
  attendanceVerificationSource: attendanceVerificationSourceSchema.nullable(),
});
export type EventOccurrenceJoinConfirmation = z.infer<typeof eventOccurrenceJoinConfirmationSchema>;

export const EVENT_ATTENDANCE_SORT_COLUMNS = ["name", "confirmed_at", "attendance_verified_at"] as const;
export const eventAttendanceListQuerySchema = listQuerySchema(EVENT_ATTENDANCE_SORT_COLUMNS).extend({
  verified: booleanQueryFlagSchema.optional(),
});
export const eventAttendanceListResponseSchema = paginatedResponseSchema(
  "confirmations",
  eventOccurrenceJoinConfirmationSchema,
);

export const groupMeetingSeriesParamsSchema = z.object({ groupId: groupReferenceSchema });
export const eventSeriesParamsSchema = groupMeetingSeriesParamsSchema.extend({ seriesId: databaseIdSchema });
export const eventOccurrenceParamsSchema = eventSeriesParamsSchema.extend({ occurrenceId: databaseIdSchema });
export const eventGuestParamsSchema = eventOccurrenceParamsSchema.extend({ guestId: databaseIdSchema });
export const eventAttendanceParamsSchema = eventOccurrenceParamsSchema.extend({ confirmationId: databaseIdSchema });

export const eventManagementErrorResponses = {
  "401": jsonErrorResponse("An authenticated management identity is required."),
  "403": jsonErrorResponse("Effective event-management capability through this group is required."),
  "404": jsonErrorResponse("The group, meeting series, occurrence, or child resource was not found."),
  "409": jsonErrorResponse("Management context or target state changed while the command was being saved."),
};

export const eventSeriesResponseSchema = z.object({ series: eventSeriesSchema });
/** One series through a group context, projected exactly like a list row. */
export const groupEventSeriesResponseSchema = z.object({ series: groupEventSeriesSchema });
export const eventOccurrenceResponseSchema = z.object({ occurrence: eventOccurrenceSchema });
export const eventOccurrenceGuestResponseSchema = z.object({ guest: eventOccurrenceGuestSchema });
export const eventAttendanceResponseSchema = z.object({ confirmation: eventOccurrenceJoinConfirmationSchema });

export const groupMeetingSeriesListRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Meetings"],
  summary: "List meeting series available through a group",
  description: "Access filtering, search, sorting, counting, and pagination are executed in D1.",
  request: { params: groupMeetingSeriesParamsSchema, query: eventSeriesListQuerySchema },
  responses: {
    "200": { description: "A bounded page of group-owned and explicitly shared meeting series." },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "404": jsonErrorResponse("Group not found or not visible."),
  },
};
export const groupMeetingSeriesDetailRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Meetings"],
  summary: "Get a meeting series through one group context",
  request: { params: eventSeriesParamsSchema },
  responses: {
    "200": {
      description: "The meeting series with its effective capabilities and occurrence count in the selected group.",
      content: { "application/json": { schema: groupEventSeriesResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "404": jsonErrorResponse("The meeting series is not available through this group."),
  },
};
export const groupMeetingSeriesCreateRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Meetings"],
  summary: "Create a group-owned meeting series",
  request: {
    params: groupMeetingSeriesParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventSeriesCreateSchema } } },
  },
  responses: { "201": { description: "Meeting series created." } },
};
export const eventSeriesUpdateRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Meetings"],
  summary: "Update a meeting series through a management group context",
  request: {
    params: eventSeriesParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventSeriesUpdateSchema } } },
  },
  responses: { "200": { description: "Meeting series updated." }, ...eventManagementErrorResponses },
};
export const eventOccurrencesListRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Meetings"],
  summary: "List occurrences in a meeting series",
  request: { params: eventSeriesParamsSchema, query: eventOccurrencesListQuerySchema },
  responses: {
    "200": { description: "A bounded occurrence page." },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "404": jsonErrorResponse("The meeting series is not available through this group."),
  },
};
export const eventOccurrenceCreateRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Meetings"],
  summary: "Create a meeting occurrence",
  request: {
    params: eventSeriesParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventOccurrenceCreateSchema } } },
  },
  responses: { "201": { description: "Occurrence created." }, ...eventManagementErrorResponses },
};
export const eventOccurrenceUpdateRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Meetings"],
  summary: "Update a meeting occurrence",
  request: {
    params: eventOccurrenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventOccurrenceUpdateSchema } } },
  },
  responses: { "200": { description: "Occurrence updated." }, ...eventManagementErrorResponses },
};
export const eventOccurrenceGuestInviteRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Meetings"],
  summary: "Invite a guest to one occurrence or explicitly to its series",
  request: {
    params: eventOccurrenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventOccurrenceGuestInviteSchema } } },
  },
  responses: { "201": { description: "Guest invitation created." }, ...eventManagementErrorResponses },
};
export const eventOccurrenceInvitationsSendRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Meetings"],
  summary: "Send every participant their own link to this meeting",
  description:
    "Queues one message per active participant of the owning group, addressed at the identity they act under " +
    "there. The link is the occurrence's join page, which requires the recipient's own session — so attendance " +
    "is recorded against a person and a forwarded link admits nobody. Each send is a numbered round; sending " +
    "again is a new round rather than a duplicate of the last one.",
  request: { params: eventOccurrenceParamsSchema },
  responses: {
    "200": { description: "A round of participant invitations was queued." },
    ...eventManagementErrorResponses,
  },
};
export const eventOccurrenceGuestsListRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Meetings"],
  summary: "List occurrence-specific and series-wide guests",
  description: "Search, filtering, sorting, counting, and pagination are executed in D1.",
  request: { params: eventOccurrenceParamsSchema, query: eventOccurrenceGuestsListQuerySchema },
  responses: { "200": { description: "A bounded guest page." }, ...eventManagementErrorResponses },
};
export const eventOccurrenceGuestRevokeRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Meetings"],
  summary: "Revoke a meeting guest and every active access capability",
  request: { params: eventGuestParamsSchema },
  responses: { "200": { description: "Guest access revoked." }, ...eventManagementErrorResponses },
};
export const eventSeriesCalendarRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Meetings"],
  summary: "Generate the current meeting-series calendar",
  request: {
    params: eventSeriesParamsSchema,
    query: z.object({ occurrenceId: databaseIdSchema.optional(), personal: booleanQueryFlagSchema.optional() }),
  },
  responses: {
    "200": { description: "Generated text/calendar content." },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "404": jsonErrorResponse("The meeting series is not available through this group."),
  },
};
export const eventSeriesMaterializeRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Meetings"],
  summary: "Idempotently materialize recurring meeting occurrences",
  description:
    "Expansion is bounded, timezone-aware, set-based, atomic with authorization, and preserves existing occurrences.",
  request: {
    params: eventSeriesParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventSeriesMaterializeSchema } } },
  },
  responses: {
    "200": { description: "Recurring occurrences materialized through the requested horizon." },
    ...eventManagementErrorResponses,
  },
};
export const eventOccurrenceAttendanceListRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Meetings"],
  summary: "List occurrence join confirmations and verified attendance",
  description: "Search, verification filtering, sorting, counting, and pagination are executed in D1.",
  request: { params: eventOccurrenceParamsSchema, query: eventAttendanceListQuerySchema },
  responses: {
    "200": {
      description: "A bounded occurrence-attendance page.",
      content: { "application/json": { schema: eventAttendanceListResponseSchema } },
    },
    "403": jsonErrorResponse("Effective attendance-management capability is required."),
    "404": jsonErrorResponse("The group, meeting series, or occurrence was not found."),
  },
};
export const eventOccurrenceAttendanceVerifyRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Meetings"],
  summary: "Verify attendance separately from join confirmation",
  request: {
    params: eventAttendanceParamsSchema,
    body: { required: true, content: { "application/json": { schema: attendanceVerifySchema } } },
  },
  responses: {
    "200": {
      description: "Attendance verification recorded.",
      content: { "application/json": { schema: eventAttendanceResponseSchema } },
    },
    "403": jsonErrorResponse("Effective attendance-management capability is required."),
    "404": jsonErrorResponse("The group, meeting occurrence, or join confirmation was not found."),
    "409": jsonErrorResponse("The attendance target or management authority changed while the update was saved."),
  },
};
