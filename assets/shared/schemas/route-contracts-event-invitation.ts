import { z } from "zod";
import { eventSlugParamsSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import {
  inviteDeclineResponseSchema,
  inviteReminderPreferenceResponseSchema,
  inviteReminderPreferenceSchema,
} from "./invites";
import { inviteDeclineSchema } from "./registration";
import { authErrors, ok, requiresSession } from "./route-contract";

/**
 * The signed-in invitee answers their own invitation: the same decline and
 * reminder rules as the emailed link, matched on the account's address
 * instead of the link's token.
 */
const eventInvitationParamsSchema = eventSlugParamsSchema.extend({ inviteId: databaseIdSchema });

const invitationErrors = authErrors({
  notFound: "No open invitation to this event for the signed-in account",
  conflict: "The invitation changed or is no longer open",
});

export const eventInvitationDeclineRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Decline the signed-in person's invitation",
  request: {
    params: eventInvitationParamsSchema,
    body: { content: { "application/json": { schema: inviteDeclineSchema } }, required: true },
  },
  responses: { ...ok("Invitation declined", inviteDeclineResponseSchema), ...invitationErrors },
};

export const eventInvitationRemindersRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Postpone or pause reminders for the signed-in person's invitation",
  request: {
    params: eventInvitationParamsSchema,
    body: { content: { "application/json": { schema: inviteReminderPreferenceSchema } }, required: true },
  },
  responses: { ...ok("Reminder preference updated", inviteReminderPreferenceResponseSchema), ...invitationErrors },
};

export type EventInvitationParams = z.infer<typeof eventInvitationParamsSchema>;
