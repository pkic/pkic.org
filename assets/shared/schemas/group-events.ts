import { z } from "zod";
import { eventIdSchema, frontendPathPattern, jsonErrorResponse, successResponseSchema } from "./api-common";
import {
  eventAttendanceRegistrationsListResponseSchema,
  eventAttendanceRegistrationsQuerySchema,
} from "./event-registrations";
import {
  attendeeInviteLimitSchema,
  eventCreateSchema,
  eventProfileCatalogResponseSchema,
  eventSettingsSchema,
} from "./event-management";
import { eventFormsResponseSchema, formDefinitionCreateSchema, formPlacementSchema } from "./forms";
import {
  eventDaysReplaceResponseSchema,
  eventDaysReplaceSchema,
  eventDaysResponseSchema,
  eventTermsReplaceSchema,
  eventTermsReplaceResponseSchema,
  eventTermsResponseSchema,
} from "./event-configuration";
import {
  eventProfileKeySchema,
  eventRegistrationPolicySchema,
  eventSourceModeSchema,
  standaloneEventProfileKeySchema,
} from "./event-series";
import { groupIdSchema, groupReferenceParamsSchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { attendeeRegistrationParticipationSchema, registrationSubmissionResponseSchema } from "./registration";
import { eventGroupGrantSchemas } from "./resource-grants";
import { proposalAccessSchema } from "./event-proposals";
import {
  eventAttendeeInvitesListResponseSchema,
  eventInvitesListQuerySchema,
  eventInviteResendSchema,
  eventInviteResendResponseSchema,
} from "./event-invites";
import {
  eventRegistrationAdmitResponseSchema,
  eventRegistrationAttendanceDetailResponseSchema,
  eventRegistrationCapacityAdmitSchema,
  eventRegistrationDayAttendanceChangeSchema,
  eventRegistrationDayAttendanceResponseSchema,
} from "./event-registration-detail";

export const GROUP_EVENTS_SORT_COLUMNS = ["name", "starts_at", "next_occurrence_at", "created_at"] as const;

export const groupEventsListQuerySchema = listQuerySchema(GROUP_EVENTS_SORT_COLUMNS).extend({
  profileKey: eventProfileKeySchema.optional(),
  registrationPolicy: eventRegistrationPolicySchema.optional(),
  sourceMode: eventSourceModeSchema.optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export type GroupEventsListQuery = z.infer<typeof groupEventsListQuerySchema>;

export const groupEventSchema = z.object({
  id: eventIdSchema,
  ownerGroupId: groupIdSchema,
  seriesId: databaseIdSchema.nullable(),
  slug: z.string(),
  basePath: z.string().trim().regex(frontendPathPattern).max(300).nullable(),
  name: z.string(),
  timezone: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  profileKey: eventProfileKeySchema.nullable(),
  sourceMode: eventSourceModeSchema.nullable(),
  registrationPolicy: eventRegistrationPolicySchema,
  inviteLimitAttendee: attendeeInviteLimitSchema,
  location: z.string().nullable(),
  links: linksSchema,
  nextOccurrenceAt: z.string().nullable(),
  updatedAt: z.string(),
  capabilities: z.array(eventGroupGrantSchemas.capabilitySchema).max(eventGroupGrantSchemas.capabilities.length),
  /** Event-scoped proposal authority; never implies a generic event or group grant. */
  proposalAccess: proposalAccessSchema.nullable().default(null),
});
export type GroupEvent = z.infer<typeof groupEventSchema>;

export const groupEventsListResponseSchema = paginatedResponseSchema("events", groupEventSchema);
export const groupEventDetailResponseSchema = z.object({ event: groupEventSchema });

export const groupEventProfilesRouteSchema = {
  tags: ["Groups"],
  summary: "List active event profiles available to a group manager",
  description:
    "Returns the active D1-backed event profile catalog. Meeting profiles are intentionally marked series-only.",
  request: { params: groupReferenceParamsSchema },
  responses: {
    "200": {
      description: "Active event profiles and their portal creation eligibility.",
      content: { "application/json": { schema: eventProfileCatalogResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Effective group management permission is required."),
    "404": jsonErrorResponse("Group not found or unavailable to this identity."),
  },
};

export const groupEventParamsSchema = groupReferenceParamsSchema.extend({ eventId: eventIdSchema });
const groupEventRegistrationParamsSchema = groupEventParamsSchema.extend({ registrationId: databaseIdSchema });
const groupEventInviteParamsSchema = groupEventParamsSchema.extend({ inviteId: databaseIdSchema });
const eventConfigurationRevisionSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
});

export const groupEventTermsReplaceSchema = eventConfigurationRevisionSchema.extend({
  configuration: eventTermsReplaceSchema,
});
export const groupEventTermsResponseSchema = eventTermsResponseSchema.extend({
  eventUpdatedAt: z.iso.datetime(),
});
export const groupEventTermsReplaceResponseSchema = eventTermsReplaceResponseSchema.extend({
  eventUpdatedAt: z.iso.datetime(),
});

export const groupEventDaysReplaceSchema = eventConfigurationRevisionSchema.extend({
  configuration: eventDaysReplaceSchema,
});
export const groupEventDaysResponseSchema = eventDaysResponseSchema.extend({
  eventUpdatedAt: z.iso.datetime(),
});
export const groupEventDaysReplaceResponseSchema = eventDaysReplaceResponseSchema.extend({
  eventUpdatedAt: z.iso.datetime(),
});

const groupEventRegistrationFormSchema = z.object({
  placement: formPlacementSchema,
  form: z.object({
    id: databaseIdSchema,
    key: z.string(),
    title: z.string(),
    description: z.string().nullable(),
  }),
});

export const groupEventRegistrationSettingsResponseSchema = z.object({
  eventUpdatedAt: z.iso.datetime(),
  registrationPolicy: eventRegistrationPolicySchema,
  form: groupEventRegistrationFormSchema.nullable(),
});

export const groupEventRegistrationSettingsUpdateSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  registrationPolicy: eventRegistrationPolicySchema,
  /** Existing group-owned form definition to place, or null to remove it. */
  formId: databaseIdSchema.nullable().optional(),
});
export const groupEventRegistrationFormCreateSchema = formDefinitionCreateSchema.safeExtend({
  purpose: z.literal("event_registration"),
});

export const GROUP_EVENT_REGISTRATION_FORMS_SORT_COLUMNS = ["key", "title", "updated_at"] as const;
export const groupEventRegistrationFormsQuerySchema = listQuerySchema(GROUP_EVENT_REGISTRATION_FORMS_SORT_COLUMNS);
export type GroupEventRegistrationFormsQuery = z.infer<typeof groupEventRegistrationFormsQuerySchema>;
export const groupEventRegistrationFormCatalogItemSchema = z.object({
  id: databaseIdSchema,
  key: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  updatedAt: z.string(),
});
export const groupEventRegistrationFormsResponseSchema = paginatedResponseSchema(
  "forms",
  groupEventRegistrationFormCatalogItemSchema,
);

/** A portal-managed event always has the selected group as its owner. */
export const groupEventCreateSchema = eventCreateSchema
  .omit({
    registrationMode: true,
    venue: true,
    virtualUrl: true,
  })
  .extend({
    profileKey: standaloneEventProfileKeySchema,
    registrationPolicy: z.literal("no_registration").default("no_registration"),
    location: eventSettingsSchema.shape.location,
    links: linksSchema.optional(),
  });
export type GroupEventCreateInput = z.infer<typeof groupEventCreateSchema>;

/** Optimistic concurrency keeps two group managers from silently overwriting each other. */
export const groupEventSettingsUpdateSchema = eventSettingsSchema
  .omit({
    registrationMode: true,
    venue: true,
    virtualUrl: true,
  })
  .extend({
    links: linksSchema.optional(),
    expectedUpdatedAt: z.iso.datetime(),
  });
export type GroupEventSettingsUpdateInput = z.infer<typeof groupEventSettingsUpdateSchema>;

export const groupEventsListRouteSchema = {
  tags: ["Groups"],
  summary: "List events available through a group",
  description: "Access filtering, search, sorting, counting, and pagination are executed in D1.",
  request: { params: groupReferenceParamsSchema, query: groupEventsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of group-owned and explicitly shared events.",
      content: { "application/json": { schema: groupEventsListResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "404": jsonErrorResponse("Group not found or not visible."),
  },
};

export const groupEventDetailRouteSchema = {
  tags: ["Groups"],
  summary: "Get one event available through a group",
  request: { params: groupEventParamsSchema },
  responses: {
    "200": {
      description: "The capability-filtered event projection.",
      content: { "application/json": { schema: groupEventDetailResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
  },
};

export const groupEventRegistrationConfigRouteSchema = {
  tags: ["Groups"],
  summary: "Get registration configuration for a group event",
  description:
    "Returns the exact active event form placement, attendee terms, session types, and event-day attendance options.",
  request: { params: groupEventParamsSchema },
  responses: {
    "200": {
      description: "The registration configuration for the selected group event.",
      content: { "application/json": { schema: eventFormsResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event registration access is required."),
    "404": jsonErrorResponse("The event is not available through this group."),
  },
};

export const groupEventTermsGetRouteSchema = {
  tags: ["Groups"],
  summary: "Get terms for a managed group event",
  request: { params: groupEventParamsSchema },
  responses: {
    "200": {
      description: "Active terms and the event revision used for optimistic updates.",
      content: { "application/json": { schema: groupEventTermsResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "404": jsonErrorResponse("The event is not available through this group."),
    "409": jsonErrorResponse("Meeting events must be configured through their meeting series."),
  },
};

export const groupEventTermsReplaceRouteSchema = {
  tags: ["Groups"],
  summary: "Replace terms for a managed group event",
  description: "Replaces all audience term sets in one guarded D1 batch with an optimistic event revision.",
  request: {
    params: groupEventParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupEventTermsReplaceSchema } } },
  },
  responses: {
    "200": {
      description: "The terms were replaced and the event revision advanced.",
      content: { "application/json": { schema: groupEventTermsReplaceResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "409": jsonErrorResponse("The event or management authority changed; reload and retry."),
  },
};

export const groupEventDaysGetRouteSchema = {
  tags: ["Groups"],
  summary: "Get attendance days for a managed group event",
  description: "Attendance counts are aggregated in D1 and returned with the event revision.",
  request: { params: groupEventParamsSchema },
  responses: {
    "200": {
      description: "Configured days, attendance counts, and the event revision.",
      content: { "application/json": { schema: groupEventDaysResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "404": jsonErrorResponse("The event is not available through this group."),
    "409": jsonErrorResponse("Meeting events must be configured through their meeting series."),
  },
};

export const groupEventDaysReplaceRouteSchema = {
  tags: ["Groups"],
  summary: "Replace attendance days for a managed group event",
  description: "Updates matching days in place and removes only unused omitted days in one guarded D1 batch.",
  request: {
    params: groupEventParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupEventDaysReplaceSchema } } },
  },
  responses: {
    "200": {
      description: "Updated days, the new event revision, and dates retained because registrations reference them.",
      content: { "application/json": { schema: groupEventDaysReplaceResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "409": jsonErrorResponse("The event or management authority changed; reload and retry."),
  },
};

export const groupEventRegistrationSettingsGetRouteSchema = {
  tags: ["Groups"],
  summary: "Get registration settings for a managed group event",
  description:
    "Returns the canonical registration policy and the exact active attendee form placement, without global fallback.",
  request: { params: groupEventParamsSchema },
  responses: {
    "200": {
      description: "Registration policy and optional exact attendee form placement.",
      content: { "application/json": { schema: groupEventRegistrationSettingsResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "404": jsonErrorResponse("The event is not available through this group."),
    "409": jsonErrorResponse("Meeting events must be configured through their meeting series."),
  },
};

export const groupEventRegistrationSettingsPutRouteSchema = {
  tags: ["Groups"],
  summary: "Update registration settings for a managed group event",
  description:
    "Atomically updates the canonical registration policy and attaches or removes one exact attendee form placement.",
  request: {
    params: groupEventParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: groupEventRegistrationSettingsUpdateSchema } },
    },
  },
  responses: {
    "200": {
      description: "Registration settings updated.",
      content: { "application/json": { schema: groupEventRegistrationSettingsResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "404": jsonErrorResponse("The event or selected group form is not available."),
    "409": jsonErrorResponse("The event or management authority changed; reload and retry."),
    "422": jsonErrorResponse("Registration requires at least one required attendee term."),
  },
};

export const groupEventRegistrationFormCreateRouteSchema = {
  tags: ["Groups"],
  summary: "Create an attendee form for a managed group event",
  description:
    "Creates one group-owned reusable attendee form with its exact event placement in the same guarded D1 command.",
  request: {
    params: groupEventParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: groupEventRegistrationFormCreateSchema } },
    },
  },
  responses: {
    "201": {
      description: "The attendee form and exact event placement were created.",
      content: { "application/json": { schema: groupEventRegistrationSettingsResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "404": jsonErrorResponse("The event is not available through this group."),
    "409": jsonErrorResponse("The event or management authority changed; reload and retry."),
    "422": jsonErrorResponse("Registration requires at least one required attendee term."),
  },
};

export const groupEventRegistrationFormsListRouteSchema = {
  tags: ["Groups"],
  summary: "List reusable attendee forms for a managed group event",
  description:
    "Lists distinct active group-owned event-registration definitions with server-side search and pagination.",
  request: { params: groupEventParamsSchema, query: groupEventRegistrationFormsQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of reusable group-owned attendee forms.",
      content: { "application/json": { schema: groupEventRegistrationFormsResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "404": jsonErrorResponse("The event is not available through this group."),
  },
};

export const groupEventCreateRouteSchema = {
  tags: ["Groups"],
  summary: "Create a group-owned event",
  description: "Creates a portal-managed event owned by the selected group.",
  request: {
    params: groupReferenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupEventCreateSchema } } },
  },
  responses: {
    "201": {
      description: "Event created.",
      content: { "application/json": { schema: groupEventDetailResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Effective group management permission is required."),
    "409": jsonErrorResponse("The group state or event slug changed concurrently."),
  },
};

export const groupEventSettingsUpdateRouteSchema = {
  tags: ["Groups"],
  summary: "Update a group event's settings",
  description: "Updates one group-owned or explicitly managed event with an optimistic revision check.",
  request: {
    params: groupEventParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupEventSettingsUpdateSchema } } },
  },
  responses: {
    "200": {
      description: "Event settings updated.",
      content: { "application/json": { schema: groupEventDetailResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "409": jsonErrorResponse("The event or management authority changed; reload and retry."),
  },
};

const groupEventAttendeeInvitesListQuerySchema = eventInvitesListQuerySchema.omit({ type: true });
export type GroupEventAttendeeInvitesListQuery = z.infer<typeof groupEventAttendeeInvitesListQuerySchema>;

export const groupEventInvitesListRouteSchema = {
  tags: ["Groups", "Event invites"],
  summary: "List attendee invitations for a managed group event",
  description: "Returns a bounded, attendee-only invitation projection with server-side search and pagination.",
  request: { params: groupEventParamsSchema, query: groupEventAttendeeInvitesListQuerySchema },
  responses: {
    "200": {
      description: "A bounded attendee invitation page.",
      content: { "application/json": { schema: eventAttendeeInvitesListResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "404": jsonErrorResponse("The event is not available through this group."),
  },
};

export const groupEventInviteResendRouteSchema = {
  tags: ["Groups", "Event invites"],
  summary: "Resend an attendee invitation",
  description: "Re-queues an existing attendee invitation that has not been accepted or revoked.",
  request: {
    params: groupEventInviteParamsSchema,
    body: { content: { "application/json": { schema: eventInviteResendSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Invitation resent.",
      content: { "application/json": { schema: eventInviteResendResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "404": jsonErrorResponse("The attendee invitation is not available for this event."),
    "409": jsonErrorResponse("The invitation cannot be resent in its current state."),
  },
};

export const groupEventInviteRevokeRouteSchema = {
  tags: ["Groups", "Event invites"],
  summary: "Revoke an attendee invitation",
  description: "Revokes a pending attendee invitation before it is accepted.",
  request: { params: groupEventInviteParamsSchema },
  responses: {
    "200": {
      description: "Invitation revoked.",
      content: { "application/json": { schema: successResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "404": jsonErrorResponse("The attendee invitation is not available for this event."),
    "409": jsonErrorResponse("The invitation is no longer pending."),
  },
};

/** Reuses canonical list controls with an attendance-manager-only projection. */
export const groupEventRegistrationsListRouteSchema = {
  tags: ["Groups"],
  summary: "List group event attendees",
  description: "Filtering, search, sorting, statistics, and pagination are executed in D1.",
  request: { params: groupEventParamsSchema, query: eventAttendanceRegistrationsQuerySchema },
  responses: {
    "200": {
      description: "A bounded attendee page for an event the selected group may manage.",
      content: { "application/json": { schema: eventAttendanceRegistrationsListResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event attendance-management access is required."),
    "404": jsonErrorResponse("The event is not available through this group."),
  },
};

export const groupEventRegistrationDetailRouteSchema = {
  tags: ["Groups"],
  summary: "Get one group event attendee for attendance management",
  description: "Returns only the identity and day attendance/waitlist fields needed by a group attendance manager.",
  request: { params: groupEventRegistrationParamsSchema },
  responses: {
    "200": {
      description: "The selected attendee's bounded attendance-management projection.",
      content: { "application/json": { schema: eventRegistrationAttendanceDetailResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event attendance-management access is required."),
    "404": jsonErrorResponse("The event or registration is not available through this group."),
  },
};

export const groupEventRegistrationDayAttendancePatchRouteSchema = {
  tags: ["Groups"],
  summary: "Update one group event attendee's day attendance",
  description: "Updates selected event days while preserving the day-level waitlist as the source of truth.",
  request: {
    params: groupEventRegistrationParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventRegistrationDayAttendanceChangeSchema } } },
  },
  responses: {
    "200": {
      description: "Day attendance updated.",
      content: { "application/json": { schema: eventRegistrationDayAttendanceResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event attendance-management access is required."),
    "404": jsonErrorResponse("The event, registration, or event day was not found."),
    "409": jsonErrorResponse("The requested attendance transition conflicts with capacity or current state."),
  },
};

export const groupEventRegistrationAdmitRouteSchema = {
  tags: ["Groups"],
  summary: "Admit selected days for a group event attendee",
  description: "Admits selected waitlisted days without creating a registration-wide waitlisted state.",
  request: {
    params: groupEventRegistrationParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventRegistrationCapacityAdmitSchema } } },
  },
  responses: {
    "200": {
      description: "Selected days admitted.",
      content: { "application/json": { schema: eventRegistrationAdmitResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event attendance-management access is required."),
    "404": jsonErrorResponse("The event or registration is not available through this group."),
    "409": jsonErrorResponse("The event or registration changed; reload and retry."),
  },
};

export const groupEventRegistrationCreateRouteSchema = {
  tags: ["Groups"],
  summary: "Register the authenticated user for a group event",
  description:
    "Uses the verified session identity and the canonical event-registration workflow; submitted identity fields are not accepted.",
  request: {
    params: groupEventParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: attendeeRegistrationParticipationSchema } },
    },
  },
  responses: {
    "200": {
      description: "Authenticated registration completed.",
      content: { "application/json": { schema: registrationSubmissionResponseSchema } },
    },
    "403": jsonErrorResponse("The event does not permit registration through this group."),
    "404": jsonErrorResponse("The event is not available through this group."),
    "409": jsonErrorResponse("Registration state or capacity changed concurrently."),
    "422": jsonErrorResponse("The profile, answers, attendance, or consent is incomplete."),
  },
};
