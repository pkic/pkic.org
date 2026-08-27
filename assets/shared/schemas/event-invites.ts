import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { paginatedResponseSchema, searchableListQuerySchema, sortColumnSchema } from "./pagination";
import { inviteTypeSchema } from "./registration";
import { eventInviteValiditySchema } from "./event-invite-validity";

export { eventInviteValiditySchema } from "./event-invite-validity";

export const eventInviteResendSchema = eventInviteValiditySchema;

export const EVENT_INVITES_SORT_COLUMNS = ["invitee_email", "status", "created_at", "accepted_at"] as const;
export const eventInvitesSortValueSchema = sortColumnSchema(EVENT_INVITES_SORT_COLUMNS);
export const eventInvitesListQuerySchema = searchableListQuerySchema(eventInvitesSortValueSchema).extend({
  status: z.enum(["sent", "accepted", "declined", "expired", "revoked"]).optional(),
  type: inviteTypeSchema.optional(),
});
export type EventInvitesListQuery = z.infer<typeof eventInvitesListQuerySchema>;

/**
 * The event-invite projection is shared by selected-group invitation views.
 * `actions` is server-derived so clients do not duplicate invite
 * state-transition rules.
 */
export const eventInviteSummarySchema = z.object({
  id: databaseIdSchema,
  inviteeEmail: z.string(),
  inviteeFirstName: z.string().nullable(),
  inviteeLastName: z.string().nullable(),
  inviteType: inviteTypeSchema,
  status: z.enum(["sent", "accepted", "declined", "expired", "revoked"]),
  declineReasonCode: z.string().nullable(),
  declineReasonNote: z.string().nullable(),
  unsubscribeFuture: z.number(),
  reminderCount: z.number(),
  sourceType: z.string(),
  expiresAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  declinedAt: z.string().nullable(),
  createdAt: z.string(),
  inviterUserId: databaseIdSchema.nullable(),
  inviterEmail: z.string().nullable(),
  inviterFirstName: z.string().nullable(),
  inviterLastName: z.string().nullable(),
  actions: z.object({
    resend: z.boolean(),
    revoke: z.boolean(),
  }),
});
export type EventInviteSummary = z.infer<typeof eventInviteSummarySchema>;
export const eventInvitesListResponseSchema = paginatedResponseSchema("invites", eventInviteSummarySchema);

/** Attendee-only projection for selected-group managers; internal/admin fields are excluded. */
export const eventAttendeeInviteSummarySchema = eventInviteSummarySchema.pick({
  id: true,
  inviteeEmail: true,
  inviteeFirstName: true,
  inviteeLastName: true,
  inviteType: true,
  status: true,
  expiresAt: true,
  acceptedAt: true,
  declinedAt: true,
  createdAt: true,
  actions: true,
});
export type EventAttendeeInviteSummary = z.infer<typeof eventAttendeeInviteSummarySchema>;
export const eventAttendeeInvitesListResponseSchema = paginatedResponseSchema(
  "invites",
  eventAttendeeInviteSummarySchema,
);

export const eventInviteResendResponseSchema = z.object({
  success: z.literal(true),
  inviteId: databaseIdSchema,
  resentAt: z.string(),
  inviteType: inviteTypeSchema,
  expiresAt: z.string(),
});
