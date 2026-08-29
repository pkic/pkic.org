import { z } from "zod";
import { eventSlugParamsSchema, successResponseSchema } from "./api-common";
import { scopedAuditLogListQuerySchema, scopedAuditLogResponseSchema } from "./audit-log";
import { eventRegistrationAdmitSchema, eventRegistrationDetailResponseSchema } from "./event-registration-detail";
import { eventRegistrationsListResponseSchema, eventRegistrationsQuerySchema } from "./event-registrations";
import { databaseIdSchema } from "./identifiers";
import { registrationBadgePatchSchema, registrationBadgeResponseSchema } from "./participant-roles";
import { registrationCapabilitySafeProjectionSchema, registrationManageSchema } from "./registration";
import { httpCapabilityUrlSchema, httpUrlSchema } from "./urls";

const eventRegistrationParamsSchema = eventSlugParamsSchema.extend({ registrationId: databaseIdSchema });

export const eventRegistrationManagementUpdateSchema = registrationManageSchema;
export const eventRegistrationNotificationCreateSchema = z.object({ type: z.literal("confirmation") });

export const eventRegistrationBadgeRegenerationResponseSchema = successResponseSchema.extend({
  status: z.literal("queued"),
  jobId: z.string().regex(/^badge:[A-Za-z0-9]{1,64}$/),
  referralCode: z.string().regex(/^[A-Za-z0-9]{1,64}$/),
  badgeUrl: httpUrlSchema,
});
export const eventRegistrationAccessResponseSchema = z.object({ manageUrl: httpCapabilityUrlSchema });
export const eventRegistrationManagementUpdateResponseSchema = successResponseSchema.extend({
  registration: eventRegistrationDetailResponseSchema.shape.registration.nullable(),
  emailChanged: z.boolean().optional(),
});
export const eventRegistrationNotificationResponseSchema = successResponseSchema.extend({
  message: z.literal("Email queued"),
});
export const eventRegistrationAdmissionResponseSchema = successResponseSchema.extend({
  registration: registrationCapabilitySafeProjectionSchema,
  admittedDayDates: z.array(z.string()),
});
export const eventRegistrationPromotionsResponseSchema = successResponseSchema.extend({
  dayRegistrationOffers: z.number().int().nonnegative(),
  affectedRegistrations: z.array(databaseIdSchema),
});

export const eventRegistrationsListRouteSchema = {
  tags: ["Event registrations"],
  summary: "List event registrations",
  request: { params: eventSlugParamsSchema, query: eventRegistrationsQuerySchema },
  responses: {
    "200": {
      description: "Registrations, event-wide statistics, and pagination information.",
      content: { "application/json": { schema: eventRegistrationsListResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "Event registration-management permission required." },
    "404": { description: "Event not found." },
  },
};

export const eventRegistrationDetailRouteSchema = {
  tags: ["Event registrations"],
  summary: "Get an event registration",
  request: { params: eventRegistrationParamsSchema },
  responses: {
    "200": {
      description: "Registration details and day-level attendance state.",
      content: { "application/json": { schema: eventRegistrationDetailResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "Event registration-management permission required." },
    "404": { description: "Event or registration not found." },
  },
};

export const eventRegistrationPatchRouteSchema = {
  tags: ["Event registrations"],
  summary: "Update an event registration",
  request: {
    params: eventRegistrationParamsSchema,
    body: { content: { "application/json": { schema: eventRegistrationManagementUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Registration updated.",
      content: { "application/json": { schema: eventRegistrationManagementUpdateResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "Event registration-management permission required." },
    "404": { description: "Event or registration not found." },
    "409": { description: "Registration state or authorization changed." },
  },
};

export const eventRegistrationAdmissionsCreateRouteSchema = {
  tags: ["Event registrations"],
  summary: "Create an event-registration admission",
  request: {
    params: eventRegistrationParamsSchema,
    body: { content: { "application/json": { schema: eventRegistrationAdmitSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Registration admitted for the selected event days.",
      content: { "application/json": { schema: eventRegistrationAdmissionResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "Event registration-management permission required." },
    "404": { description: "Event or registration not found." },
    "409": { description: "Capacity, waitlist, registration state, or authorization changed." },
  },
};

export const eventRegistrationAuditRouteSchema = {
  tags: ["Event registrations"],
  summary: "List an event registration's audit history",
  request: { params: eventRegistrationParamsSchema, query: scopedAuditLogListQuerySchema },
  responses: {
    "200": {
      description: "Registration audit entries.",
      content: { "application/json": { schema: scopedAuditLogResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "Event registration-management permission required." },
    "404": { description: "Event or registration not found." },
  },
};

export const eventRegistrationBadgeGetRouteSchema = {
  tags: ["Event registrations"],
  summary: "Get an event registration's badge configuration",
  request: { params: eventRegistrationParamsSchema },
  responses: {
    "200": {
      description: "Configured, detected, and effective badge roles.",
      content: { "application/json": { schema: registrationBadgeResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "Event registration-management permission required." },
    "404": { description: "Event or registration not found." },
  },
};

export const eventRegistrationBadgePatchRouteSchema = {
  tags: ["Event registrations"],
  summary: "Update an event registration's badge role",
  request: {
    params: eventRegistrationParamsSchema,
    body: { content: { "application/json": { schema: registrationBadgePatchSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Updated badge configuration.",
      content: { "application/json": { schema: registrationBadgeResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "Event registration-management permission required." },
    "404": { description: "Event or registration not found." },
    "409": { description: "Registration state or authorization changed." },
  },
};

export const eventRegistrationBadgeCreateRouteSchema = {
  tags: ["Event registrations"],
  summary: "Regenerate an event registration's badge",
  request: { params: eventRegistrationParamsSchema },
  responses: {
    "202": {
      description: "Badge regeneration queued.",
      content: { "application/json": { schema: eventRegistrationBadgeRegenerationResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "Event registration-management permission required." },
    "404": { description: "Event, registration, or referral code not found." },
    "409": { description: "Registration state or authorization changed." },
  },
};

export const eventRegistrationAccessCreateRouteSchema = {
  tags: ["Event registrations"],
  summary: "Create temporary registration management access",
  request: { params: eventRegistrationParamsSchema },
  responses: {
    "200": {
      description: "Temporary management URL created.",
      content: { "application/json": { schema: eventRegistrationAccessResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "Event registration-management permission required." },
    "404": { description: "Event or registration not found." },
    "409": { description: "Registration state or authorization changed." },
    "500": { description: "Management-link signing is not configured." },
  },
};

export const eventRegistrationNotificationsCreateRouteSchema = {
  tags: ["Event registrations"],
  summary: "Create an event-registration notification",
  request: {
    params: eventRegistrationParamsSchema,
    body: {
      content: { "application/json": { schema: eventRegistrationNotificationCreateSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Notification queued.",
      content: { "application/json": { schema: eventRegistrationNotificationResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "Event registration-management permission required." },
    "404": { description: "Event or registration not found." },
    "409": { description: "Registration state or authorization changed." },
  },
};

export const eventRegistrationPromotionsCreateRouteSchema = {
  tags: ["Event registrations"],
  summary: "Create event waitlist promotion offers",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": {
      description: "Day-level waitlist promotions processed.",
      content: { "application/json": { schema: eventRegistrationPromotionsResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "Event registration-management permission required." },
    "404": { description: "Event not found." },
    "409": { description: "Waitlist state or authorization changed." },
  },
};

export const eventRegistrationExportRouteSchema = {
  tags: ["Event registrations"],
  summary: "Export event registrations",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": {
      description: "Bounded CSV representation of event registrations.",
      content: { "text/csv": { schema: z.string() } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "Event registration-management permission required." },
    "404": { description: "Event not found." },
    "409": { description: "Export authorization changed." },
    "413": { description: "Configured export size limit exceeded." },
  },
};
