import { z } from "zod";
import { requiresSession, publicOperation } from "./route-contract";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import {
  agendaCalendarSettingsSchema,
  agendaCalendarSubscriptionSchema,
  agendaCalendarTokenSchema,
} from "./event-agenda-calendar";
export const agendaCalendarRotateRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Rotate your private agenda calendar subscription",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: agendaCalendarSettingsSchema } } },
  },
  responses: {
    "200": {
      description: "Private URL displayed once",
      content: { "application/json": { schema: agendaCalendarSubscriptionSchema } },
    },
    "401": jsonErrorResponse("Sign in required"),
  },
};
export const agendaCalendarRevokeRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Revoke all your private agenda calendar URLs",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": {
      description: "Revoked",
      content: { "application/json": { schema: z.object({ revoked: z.literal(true) }) } },
    },
  },
};
export const agendaCalendarFeedRouteSchema = {
  ...publicOperation(),
  tags: ["Events"],
  summary: "Read a private calendar using a revocable subscription token",
  request: { params: eventSlugParamsSchema.extend({ token: agendaCalendarTokenSchema }) },
  responses: {
    "200": { description: "Private iCalendar", content: { "text/calendar": { schema: z.string() } } },
    "404": jsonErrorResponse("Subscription not found"),
  },
};
export const agendaCalendarSettingsGetRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Read your agenda calendar and reminder preferences",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": { description: "Preferences", content: { "application/json": { schema: agendaCalendarSettingsSchema } } },
  },
};
export const agendaCalendarSettingsPutRouteSchema = {
  ...agendaCalendarSettingsGetRouteSchema,
  summary: "Update your agenda reminder preferences",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: agendaCalendarSettingsSchema } } },
  },
};
