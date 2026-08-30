/**
 * Identity-first participation feed: every event registration linked to the
 * caller's own user id (see IMPLEMENTATION_TRACKER.md section 13,
 * "Identity-first participation" and "Participation records"). Unlike the
 * group/vote/meeting/form self-feeds, this gates on the authenticated
 * identity alone, not member capacity.
 */
import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { eventResourceCoreSchema } from "./event-management";
import { databaseIdSchema } from "./identifiers";
import { paginatedResponseSchema, paginationQuerySchemaWithDefaults } from "./pagination";
import { attendanceTypeSchema, registrationLifecycleStatusSchema } from "./registration";

/** Minimal event identity/scheduling projection — composed from the canonical event base, never restated. */
export const currentUserRegistrationEventSchema = eventResourceCoreSchema.pick({
  id: true,
  slug: true,
  name: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
});
export type CurrentUserRegistrationEvent = z.infer<typeof currentUserRegistrationEventSchema>;

export const currentUserRegistrationSchema = z.object({
  id: databaseIdSchema,
  event: currentUserRegistrationEventSchema,
  status: registrationLifecycleStatusSchema,
  attendanceType: attendanceTypeSchema,
  /**
   * True when at least one of this registration's day-waitlist rows is
   * still active — the sole authoritative waitlist state (see
   * `functions/_lib/services/events/viewer-state.ts`); the retired
   * whole-registration `waitlisted` status token is never surfaced.
   */
  waitlisted: z.boolean(),
  createdAt: utcInstantSchema,
});
export type CurrentUserRegistration = z.infer<typeof currentUserRegistrationSchema>;

/**
 * `from`/`to` filter on the event's start time, not the registration's
 * creation time — the caller browses their registrations by when the event
 * happens.
 */
export const currentUserRegistrationsListQuerySchema = paginationQuerySchemaWithDefaults().extend({
  from: utcInstantSchema.optional(),
  to: utcInstantSchema.optional(),
});
export type CurrentUserRegistrationsListQuery = z.infer<typeof currentUserRegistrationsListQuerySchema>;

export const currentUserRegistrationsListResponseSchema = paginatedResponseSchema(
  "registrations",
  currentUserRegistrationSchema,
);
export type CurrentUserRegistrationsListResponse = z.infer<typeof currentUserRegistrationsListResponseSchema>;
