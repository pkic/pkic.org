/** Shared event-profile, recurrence, occurrence, guest, and meeting-entry contracts. */
import { z } from "zod";
import { eventIdSchema, normalizedEmailSchema, tokenSchema, trimmedString } from "./api-common";
import { groupIdSchema, groupReferenceSchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const EVENT_PROFILE_KEYS = ["meeting", "board_meeting", "conference", "workshop", "tutorial"] as const;
export const eventProfileKeySchema = z.enum(EVENT_PROFILE_KEYS);
export const EVENT_SOURCE_MODES = ["hugo", "portal", "integration"] as const;
export const eventSourceModeSchema = z.enum(EVENT_SOURCE_MODES);

export const EVENT_REGISTRATION_POLICIES = [
  "no_registration",
  "optional",
  "invitation_only",
  "required",
  "public",
] as const;
export const eventRegistrationPolicySchema = z.enum(EVENT_REGISTRATION_POLICIES);
export const EVENT_GUEST_POLICIES = ["none", "occurrence_invitation", "public_registration"] as const;
export const eventGuestPolicySchema = z.enum(EVENT_GUEST_POLICIES);

export const eventProfilePolicySchema = z.object({
  registrationPolicy: eventRegistrationPolicySchema,
  memberEligibility: z.enum(["owner_group", "shared_groups", "public"]),
  guestPolicy: eventGuestPolicySchema,
});

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z.string().trim().min(1).max(100).refine(isValidTimeZone, "Unknown IANA time zone");
export const recurrenceRuleSchema = z
  .string()
  .trim()
  .min(6)
  .max(1024)
  .refine((value) => /(?:^|;)FREQ=(?:DAILY|WEEKLY|MONTHLY|YEARLY)(?:;|$)/.test(value), "Invalid recurrence rule");

export const EVENT_PROVIDER_TYPES = ["external_url", "microsoft_graph", "cloudflare_meet"] as const;
export const eventProviderTypeSchema = z.enum(EVENT_PROVIDER_TYPES);

export const eventSeriesSchema = z.object({
  id: databaseIdSchema,
  eventId: eventIdSchema,
  ownerGroupId: groupIdSchema,
  eventName: z.string(),
  eventSlug: z.string(),
  profileKey: eventProfileKeySchema,
  registrationPolicy: eventRegistrationPolicySchema,
  recurrenceRule: recurrenceRuleSchema,
  timezone: timeZoneSchema,
  durationMinutes: z.number().int().min(1).max(7 * 24 * 60),
  location: z.string().nullable(),
  providerType: eventProviderTypeSchema.nullable(),
  providerConfigured: z.boolean(),
  active: z.boolean(),
  nextOccurrenceAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EventSeries = z.infer<typeof eventSeriesSchema>;

export const eventSeriesCreateSchema = z.object({
  eventName: trimmedString(1, 200),
  eventSlug: z.string().trim().min(1).max(200),
  profileKey: eventProfileKeySchema.default("meeting"),
  policy: eventProfilePolicySchema,
  recurrenceRule: recurrenceRuleSchema,
  timezone: timeZoneSchema,
  durationMinutes: z.number().int().min(1).max(7 * 24 * 60),
  location: trimmedString(0, 500).nullable().optional(),
  providerType: eventProviderTypeSchema.nullable().optional(),
});
export const eventSeriesUpdateSchema = eventSeriesCreateSchema
  .omit({ eventSlug: true })
  .partial()
  .extend({ active: z.boolean().optional() });

export const EVENT_SERIES_SORT_COLUMNS = ["event_name", "next_occurrence_at", "created_at"] as const;
export const eventSeriesListQuerySchema = listQuerySchema(EVENT_SERIES_SORT_COLUMNS).extend({
  active: z.enum(["true", "false"]).optional(),
  profileKey: eventProfileKeySchema.optional(),
});
export const eventSeriesListResponseSchema = paginatedResponseSchema("series", eventSeriesSchema);

export const EVENT_OCCURRENCE_STATUSES = ["scheduled", "cancelled", "completed"] as const;
export const eventOccurrenceStatusSchema = z.enum(EVENT_OCCURRENCE_STATUSES);
export const eventOccurrenceSchema = z.object({
  id: databaseIdSchema,
  seriesId: databaseIdSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  status: eventOccurrenceStatusSchema,
  location: z.string().nullable(),
  guestCount: z.number().int().min(0),
  joinConfirmedCount: z.number().int().min(0),
  attendanceVerifiedCount: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const eventOccurrenceInputSchema = z.object({
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  locationOverride: trimmedString(0, 500).nullable().optional(),
  providerJoinUrl: z.url().nullable().optional(),
});
export const eventOccurrenceCreateSchema = eventOccurrenceInputSchema
  .refine((value) => value.endsAt > value.startsAt, { message: "Occurrence must end after it starts", path: ["endsAt"] });
export const eventOccurrenceUpdateSchema = eventOccurrenceInputSchema
  .partial()
  .extend({ status: eventOccurrenceStatusSchema.optional() })
  .refine((value) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt, {
    message: "Occurrence must end after it starts",
    path: ["endsAt"],
  });

export const EVENT_OCCURRENCE_SORT_COLUMNS = ["starts_at", "ends_at", "status"] as const;
export const eventOccurrencesListQuerySchema = listQuerySchema(EVENT_OCCURRENCE_SORT_COLUMNS).extend({
  status: eventOccurrenceStatusSchema.optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export const eventOccurrencesListResponseSchema = paginatedResponseSchema("occurrences", eventOccurrenceSchema);

export const eventOccurrenceGuestSchema = z.object({
  id: databaseIdSchema,
  occurrenceId: databaseIdSchema,
  userId: databaseIdSchema.nullable(),
  email: z.email(),
  name: z.string(),
  affiliation: z.string().nullable(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});
export const eventOccurrenceGuestInviteSchema = z.object({
  email: normalizedEmailSchema,
  name: trimmedString(1, 200),
  affiliation: trimmedString(0, 200).nullable().optional(),
  expiresAt: z.iso.datetime(),
});
export const eventOccurrenceGuestsListQuerySchema = listQuerySchema(["name", "email", "created_at"] as const).extend({
  active: z.enum(["true", "false"]).optional(),
});
export const eventOccurrenceGuestsListResponseSchema = paginatedResponseSchema("guests", eventOccurrenceGuestSchema);

export const meetingTermAcceptanceSchema = z.object({
  termId: databaseIdSchema,
  version: trimmedString(1, 64),
});
export const meetingJoinConfirmSchema = z.object({
  name: trimmedString(1, 200),
  affiliation: trimmedString(0, 200).nullable(),
  acceptedTerms: z.array(meetingTermAcceptanceSchema).max(20),
  intentionalJoin: z.literal(true),
});
export const meetingJoinLandingSchema = z.object({
  occurrence: eventOccurrenceSchema,
  name: z.string(),
  affiliation: z.string().nullable(),
  terms: z.array(
    z.object({ id: databaseIdSchema, key: z.string(), version: z.string(), displayText: z.string(), required: z.boolean() }),
  ),
});
export const meetingJoinResponseSchema = z.object({
  confirmationId: databaseIdSchema,
  confirmedAt: z.string(),
  redirectUrl: z.url(),
});

export const ATTENDANCE_VERIFICATION_SOURCES = ["microsoft_graph", "cloudflare_meet", "manual"] as const;
export const attendanceVerificationSourceSchema = z.enum(ATTENDANCE_VERIFICATION_SOURCES);
export const attendanceVerifySchema = z.object({
  source: attendanceVerificationSourceSchema,
  verifiedAt: z.iso.datetime().optional(),
  note: trimmedString(0, 500).optional(),
});

export const groupMeetingSeriesParamsSchema = z.object({ groupId: groupReferenceSchema });
export const eventSeriesParamsSchema = groupMeetingSeriesParamsSchema.extend({ seriesId: databaseIdSchema });
export const eventOccurrenceParamsSchema = eventSeriesParamsSchema.extend({ occurrenceId: databaseIdSchema });
export const meetingJoinTokenParamsSchema = z.object({ token: tokenSchema });
