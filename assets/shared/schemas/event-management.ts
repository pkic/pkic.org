import { z } from "zod";
import { httpOrSameOriginUrlSchema, httpUrlSchema } from "./urls";
import { proposalSessionTypesSchema } from "./proposal-management";
import { eventIdSchema, slugPattern, trimmedString, utcInstantSchema } from "./api-common";
import { eventDayDateSchema } from "./event-read-models";
import {
  eventProfileKeySchema,
  eventRegistrationPolicySchema,
  eventSourceModeSchema,
  eventVisibilitySchema,
  timeZoneSchema,
} from "./event-series";
import { groupIdSchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { attendanceTypeSchema, registrationLifecycleStatusSchema } from "./registration";

/**
 * D1-backed event profile catalog projection. The key remains a validated
 * event-profile identifier, while presentation labels and availability are
 * owned by the catalog rather than duplicated in each client.
 */
export const eventProfileCatalogItemSchema = z.object({
  key: z.string().trim().min(1).max(80),
  label: trimmedString(1, 160),
  description: z.string().trim().max(500).nullable(),
  standaloneEligible: z.boolean(),
});
export type EventProfileCatalogItem = z.infer<typeof eventProfileCatalogItemSchema>;
export const eventProfileCatalogResponseSchema = z.object({
  profiles: z.array(eventProfileCatalogItemSchema).max(100),
});

/**
 * Settings that are stored in dedicated event columns or in the canonical
 * event settings JSON. Custom settings may not shadow them. Frontend routes
 * remain publication metadata for Hugo-authored events and are never a
 * generic portal-event setting.
 */
export const EVENT_MANAGED_SETTING_KEYS = [
  "forms",
  "frontend",
  "heroImageUrl",
  "location",
  "proposal",
  "venue",
  "virtualUrl",
] as const;

const eventManagedSettingKeySet = new Set<string>(EVENT_MANAGED_SETTING_KEYS);
const unsafeObjectKeys = new Set(["__proto__", "constructor", "prototype"]);

export function isEventCustomSettingKey(key: string): boolean {
  return !eventManagedSettingKeySet.has(key) && !unsafeObjectKeys.has(key);
}

export const eventCustomSettingsSchema = z
  .record(z.string().trim().min(1).max(80), z.unknown())
  .refine((settings) => Object.keys(settings).length <= 100, "At most 100 custom settings are allowed")
  .superRefine((settings, ctx) => {
    for (const key of Object.keys(settings)) {
      if (!isEventCustomSettingKey(key)) {
        ctx.addIssue({ code: "custom", path: [key], message: `'${key}' is managed by a dedicated event setting` });
      }
    }
  });

/** Zero disables attendee peer invitations; positive values bound each registered participant. */
export const attendeeInviteLimitSchema = z.number().int().min(0).max(50);

/**
 * Shared event configuration. Individual route families compose this base
 * with their own policy dialect rather than duplicating the common fields.
 */
export const eventSettingsSchema = z.object({
  name: trimmedString(3, 180).optional(),
  timezone: timeZoneSchema.optional(),
  startsAt: utcInstantSchema.nullable().optional(),
  endsAt: utcInstantSchema.nullable().optional(),
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
  registrationPolicy: eventRegistrationPolicySchema.optional(),
  visibility: eventVisibilitySchema.optional(),
  inviteLimitAttendee: attendeeInviteLimitSchema.optional(),
  settings: eventCustomSettingsSchema.optional(),
  userRetentionDays: z.number().int().positive().max(3650).optional(),
});
export type EventSettingsInput = z.infer<typeof eventSettingsSchema>;

/** Shared initial event identity and scheduling fields. */
export const eventCreateSchema = z.object({
  slug: z.string().trim().regex(slugPattern),
  name: trimmedString(3, 180),
  timezone: timeZoneSchema.default("UTC"),
  startsAt: utcInstantSchema.nullable().optional(),
  endsAt: utcInstantSchema.nullable().optional(),
  registrationMode: z.enum(["invite_only", "invite_or_open", "open"]).default("invite_or_open"),
  visibility: eventVisibilitySchema.default("invitation_only"),
  inviteLimitAttendee: attendeeInviteLimitSchema.default(5),
  venue: trimmedString(2, 500).nullable().optional(),
  virtualUrl: httpUrlSchema.nullable().optional(),
});
export type EventCreateInput = z.infer<typeof eventCreateSchema>;

/**
 * Canonical event fields shared by global management and group-context
 * projections. Context-specific contracts extend this base with ownership,
 * capabilities, and other view-specific data instead of copying the event
 * identity and scheduling shape.
 */
export const eventResourceCoreSchema = z.object({
  id: eventIdSchema,
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  profileKey: eventProfileKeySchema.nullable(),
  sourceMode: eventSourceModeSchema.nullable(),
  registrationPolicy: eventRegistrationPolicySchema,
  visibility: eventVisibilitySchema,
  inviteLimitAttendee: attendeeInviteLimitSchema,
  /** Exact persisted D1 revision; clients must return it unchanged for compare-and-set writes. */
  updatedAt: z.string().min(1).max(40),
});
export type EventResourceCore = z.infer<typeof eventResourceCoreSchema>;

/**
 * Per-day state of the viewer's own registration, keyed by the event day's
 * calendar date. Present only for events with day-level registration; a
 * single-attendance-type registration has no day rows and yields `[]`.
 */
export const eventViewerDayStateSchema = z.enum(["registered", "waitlisted"]);
export const eventViewerDaySchema = z.object({
  date: eventDayDateSchema,
  state: eventViewerDayStateSchema,
});
export type EventViewerDay = z.infer<typeof eventViewerDaySchema>;

/**
 * The caller's own standing for an event, derived from their registration.
 * `waitlisted` is true when at least one of the registration's day-waitlist
 * rows is active (day waitlist rows are the sole authoritative waitlist
 * state); `days` mirrors that per day. Null for anonymous callers and for
 * callers with no standing (non-existent or cancelled registration).
 */
export const eventViewerStateSchema = z.object({
  registrationStatus: registrationLifecycleStatusSchema,
  attendanceType: attendanceTypeSchema,
  waitlisted: z.boolean(),
  days: z.array(eventViewerDaySchema).max(31),
});
export type EventViewerState = z.infer<typeof eventViewerStateSchema>;

/** Public/member-safe event representation; management configuration is deliberately absent. */
export const eventAudienceDetailSchema = eventResourceCoreSchema
  .omit({ sourceMode: true, inviteLimitAttendee: true, updatedAt: true })
  .extend({
    accessLevel: z.enum(["public", "participant"]),
    location: z.string().nullable(),
    links: linksSchema,
    /** The public page path for this event, when the event has one. */
    basePath: z.string().nullable(),
    viewer: eventViewerStateSchema.nullable(),
  });
export type EventAudienceDetail = z.infer<typeof eventAudienceDetailSchema>;

/**
 * Event-management list projection for a caller holding live event read
 * permission. It extends the same canonical core as every other event
 * projection and adds ownership, source, and bounded registration aggregates
 * instead of restating the event identity in a separate management contract.
 */
export const eventManagementSummarySchema = eventResourceCoreSchema.extend({
  ownerGroupId: groupIdSchema.nullable(),
  ownerGroupName: z.string().nullable(),
  sourcePath: z.string().nullable(),
  basePath: z.string().nullable(),
  totalRegistrations: z.number().int().nonnegative(),
  confirmedRegistrations: z.number().int().nonnegative(),
  pendingInvites: z.number().int().nonnegative(),
});
export type EventManagementSummary = z.infer<typeof eventManagementSummarySchema>;

export const EVENT_LIST_SORT_COLUMNS = ["name", "starts_at", "ends_at"] as const;
/**
 * Management callers may additionally sort by the registration aggregate.
 * The query contract accepts the superset because the caller's scope is only
 * known after authentication; the service rejects a management-only sort for
 * an audience caller rather than silently ignoring it.
 */
export const EVENT_MANAGEMENT_LIST_SORT_COLUMNS = [
  ...EVENT_LIST_SORT_COLUMNS,
  "registration_mode",
  "total_registrations",
] as const;
export const eventsListQuerySchema = listQuerySchema(EVENT_MANAGEMENT_LIST_SORT_COLUMNS).extend({
  visibility: eventVisibilitySchema.optional(),
  from: utcInstantSchema.optional(),
  to: utcInstantSchema.optional(),
});
export type EventsListQuery = z.infer<typeof eventsListQuerySchema>;
/**
 * Scope-appropriate list payload. The management projection is attempted
 * first; audience rows fall through to the reduced public/member projection.
 * This mirrors `eventDetailResponseSchema`, so list and detail expose the same
 * two scopes through one contract each.
 */
export const eventsManagementListResponseSchema = paginatedResponseSchema("events", eventManagementSummarySchema);
export const eventsAudienceListResponseSchema = paginatedResponseSchema("events", eventAudienceDetailSchema);
export const eventsListResponseSchema = z.union([eventsManagementListResponseSchema, eventsAudienceListResponseSchema]);

export const eventManagementCapabilitySchema = z.enum(["read", "write", "manage"]);
export type EventManagementCapability = z.infer<typeof eventManagementCapabilitySchema>;

/** Full event-management read model for an authenticated event-scoped actor. */
export const eventDetailSchema = eventResourceCoreSchema.extend({
  ownerGroupId: groupIdSchema.nullable(),
  seriesId: databaseIdSchema.nullable(),
  basePath: z.string().nullable(),
  userRetentionDays: z.number().int().positive().nullable(),
  venue: z.string().nullable(),
  virtualUrl: httpUrlSchema.nullable(),
  heroImageUrl: httpOrSameOriginUrlSchema.nullable(),
  location: z.string().nullable(),
  sessionTypes: proposalSessionTypesSchema.nullable(),
  links: linksSchema,
  settings: z.record(z.string(), z.unknown()),
  capabilities: z.array(eventManagementCapabilitySchema).max(3),
});
export type EventDetail = z.infer<typeof eventDetailSchema>;
export const eventManagementDetailResponseSchema = z.object({ event: eventDetailSchema });
export const eventDetailResponseSchema = z.object({ event: z.union([eventDetailSchema, eventAudienceDetailSchema]) });

/** Direct event updates always use optimistic concurrency. */
export const eventSettingsUpdateSchema = eventSettingsSchema.extend({
  expectedUpdatedAt: z.string().min(1).max(40),
});
export type EventSettingsUpdateInput = z.infer<typeof eventSettingsUpdateSchema>;
