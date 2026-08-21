import { z } from "zod";
import { tokenSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { inviteAcceptAttendeeSchema, inviteDeclineSchema, inviteTypeSchema } from "./registration";

export const inviteCapabilityParamsSchema = z.object({ token: tokenSchema });
export const inviteCapabilityQuerySchema = z.object({ id: databaseIdSchema.optional() });
export const inviteCapabilityRequest = {
  params: inviteCapabilityParamsSchema,
  query: inviteCapabilityQuerySchema,
};

export const inviteTerminalInfoSchema = z.object({
  status: z.enum(["already_processed", "expired", "invalid"]),
});

export const inviteInfoValidSchema = z.object({
  status: z.literal("valid"),
  eventName: z.string().nullable(),
  inviteeFirstName: z.string().nullable(),
  inviteType: inviteTypeSchema,
  registrationUrl: z.string().nullable(),
  proposalUrl: z.string().nullable(),
  inviters: z.array(
    z.object({
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      organizationName: z.string().nullable(),
    }),
  ),
  totalInviters: z.number().int().nonnegative(),
});
export const inviteInfoResponseSchema = z.union([inviteInfoValidSchema, inviteTerminalInfoSchema]);

export const inviteDeclineInfoValidSchema = inviteInfoValidSchema.omit({ inviters: true, totalInviters: true });
export const inviteDeclineInfoResponseSchema = z.union([inviteDeclineInfoValidSchema, inviteTerminalInfoSchema]);

export const inviteAcceptResponseSchema = z.union([
  z.object({ success: z.literal(true), inviteType: z.literal("speaker"), next: z.string() }),
  z.object({
    success: z.literal(true),
    registrationId: databaseIdSchema,
    status: z.string(),
    manageToken: tokenSchema,
    shareUrl: z.string(),
  }),
]);
export const inviteDeclineResponseSchema = z.object({
  success: z.literal(true),
  forwarded: z.array(z.email()),
});
export const inviteReminderPreferenceSchema = z.object({
  action: z.enum(["postpone_7d", "pause_30d", "resume", "unsubscribe"]),
});
export const inviteReminderPreferenceResponseSchema = z.object({
  success: z.literal(true),
  state: z.enum(["unsubscribed", "active", "postponed", "paused"]),
  pausedUntil: z.string().nullable().optional(),
});

export const inviteInfoRouteSchema = {
  tags: ["Invites"],
  summary: "Get invite metadata",
  request: inviteCapabilityRequest,
  responses: {
    "200": {
      description: "Invite state and public metadata.",
      content: { "application/json": { schema: inviteInfoResponseSchema } },
    },
  },
};

export const inviteDeclineInfoRouteSchema = {
  tags: ["Invites"],
  summary: "Get invite decline metadata",
  request: inviteCapabilityRequest,
  responses: {
    "200": {
      description: "Invite state and decline-page metadata.",
      content: { "application/json": { schema: inviteDeclineInfoResponseSchema } },
    },
  },
};

export const inviteDeclineRedirectRouteSchema = {
  tags: ["Invites"],
  summary: "Redirect an invite decline link",
  request: inviteCapabilityRequest,
  responses: { "302": { description: "Redirect to the Hugo decline page." } },
};

export const inviteDeclineRouteSchema = {
  tags: ["Invites"],
  summary: "Decline or forward an invite",
  request: {
    ...inviteCapabilityRequest,
    body: { content: { "application/json": { schema: inviteDeclineSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Invite declined.",
      content: { "application/json": { schema: inviteDeclineResponseSchema } },
    },
  },
};

export const inviteAcceptRouteSchema = {
  tags: ["Invites"],
  summary: "Accept an invite",
  request: {
    ...inviteCapabilityRequest,
    body: { content: { "application/json": { schema: inviteAcceptAttendeeSchema.optional() } }, required: false },
  },
  responses: {
    "200": { description: "Invite accepted.", content: { "application/json": { schema: inviteAcceptResponseSchema } } },
  },
};

export const inviteReminderPreferenceRouteSchema = {
  tags: ["Invites"],
  summary: "Update invite reminder preferences",
  request: {
    ...inviteCapabilityRequest,
    body: { content: { "application/json": { schema: inviteReminderPreferenceSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Reminder preference updated.",
      content: { "application/json": { schema: inviteReminderPreferenceResponseSchema } },
    },
  },
};
