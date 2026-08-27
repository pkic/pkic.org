import { eventSlugParamsSchema, successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { adminRegistrationDetailResponseSchema, adminRegistrationDetailSchema } from "./admin-registration-detail";
import { z } from "zod";
import { httpCapabilityUrlSchema, httpUrlSchema } from "./urls";
import { registrationCapabilitySafeProjectionSchema, registrationManageSchema } from "./registration";
import {
  ADMIN_EVENT_REGISTRATION_STATUSES,
  adminEventRegistrationStatusSchema,
  adminRegistrationAdmitSchema,
} from "./admin-events";
import { scopedAuditLogListQuerySchema, scopedAuditLogResponseSchema } from "./audit-log";
import { adminBadgeRolePatchSchema, adminBadgeRoleResponseSchema } from "./participant-roles";

export const ADMIN_REGISTRATION_FORCE_STATUSES = ADMIN_EVENT_REGISTRATION_STATUSES;
export const adminRegistrationForceStatusSchema = adminEventRegistrationStatusSchema;
export const adminRegistrationUpdateSchema = z.union([
  registrationManageSchema,
  z.object({ action: z.literal("force_status"), status: adminRegistrationForceStatusSchema }),
]);

export const badgeRegenerationQueuedResponseSchema = successResponseSchema.extend({
  status: z.literal("queued"),
  jobId: z.string().regex(/^badge:[A-Za-z0-9]{1,64}$/),
  referralCode: z.string().regex(/^[A-Za-z0-9]{1,64}$/),
  badgeUrl: httpUrlSchema,
});
export const adminRegistrationOpenManageResponseSchema = z.object({ manageUrl: httpCapabilityUrlSchema });
export const adminRegistrationUpdateResponseSchema = successResponseSchema.extend({
  registration: adminRegistrationDetailSchema.nullable(),
  emailChanged: z.boolean().optional(),
});
export const adminRegistrationResendConfirmationResponseSchema = successResponseSchema.extend({
  message: z.literal("Email queued"),
});
export const adminRegistrationAdmitResponseSchema = successResponseSchema.extend({
  registration: registrationCapabilitySafeProjectionSchema,
  admittedDayDates: z.array(z.string()),
});
export const badgeRoleInfoSchema = z.object({
  admin_override: z.string().nullable(),
  auto_detected: z.string(),
  effective_role: z.string(),
  available_roles: z.array(z.string()),
});

export const adminRegistrationAuditLogRouteSchema = {
  tags: ["Admin events"],
  summary: "List registration audit log",
  description: "Returns recent audit events attached to a registration in the requested event.",
  request: {
    params: eventSlugParamsSchema.extend({ registrationId: databaseIdSchema }),
    query: scopedAuditLogListQuerySchema,
  },
  responses: {
    "200": {
      description: "Registration audit log entries.",
      content: { "application/json": { schema: scopedAuditLogResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
    "404": { description: "Event or registration not found." },
  },
};

export const adminRegistrationDetailRouteSchema = {
  tags: ["Admin registrations"],
  summary: "Get registration details",
  request: {
    params: eventSlugParamsSchema.extend({ registrationId: databaseIdSchema }),
  },
  responses: {
    "200": {
      description: "Registration details and day-level attendance state.",
      content: { "application/json": { schema: adminRegistrationDetailResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
    "404": { description: "Event or registration not found." },
  },
};

export const adminRegistrationBadgeRegenerationRouteSchema = {
  tags: ["Admin registrations"],
  summary: "Regenerate a registration badge",
  description: "Durably queues an idempotent replacement of the registration's cached social badge.",
  request: {
    params: eventSlugParamsSchema.extend({ registrationId: databaseIdSchema }),
  },
  responses: {
    "202": {
      description: "Badge regeneration queued.",
      content: { "application/json": { schema: badgeRegenerationQueuedResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
    "404": { description: "Event, registration, or referral code not found." },
  },
};

const adminRegistrationParamsSchema = eventSlugParamsSchema.extend({ registrationId: databaseIdSchema });
export const adminRegistrationBadgeRoleGetRouteSchema = {
  tags: ["Admin registrations"],
  summary: "Get a registration badge role",
  request: { params: adminRegistrationParamsSchema },
  responses: {
    "200": {
      description: "The configured, detected, and effective badge roles.",
      content: { "application/json": { schema: adminBadgeRoleResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
    "404": { description: "Event or registration not found." },
  },
};
export const adminRegistrationBadgeRolePatchRouteSchema = {
  tags: ["Admin registrations"],
  summary: "Override a registration badge role",
  request: {
    params: adminRegistrationParamsSchema,
    body: { content: { "application/json": { schema: adminBadgeRolePatchSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Updated badge-role configuration.",
      content: { "application/json": { schema: adminBadgeRoleResponseSchema } },
    },
    "400": { description: "Invalid badge-role payload." },
    "401": { description: "Admin authorization required." },
    "404": { description: "Event or registration not found." },
  },
};
export const adminRegistrationOpenManageRouteSchema = {
  tags: ["Admin registrations"],
  summary: "Create temporary registration management access",
  description: "Creates an audited, short-lived registration management URL for an authorized administrator.",
  request: { params: adminRegistrationParamsSchema },
  responses: {
    "200": {
      description: "Temporary management URL created.",
      content: { "application/json": { schema: adminRegistrationOpenManageResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
    "404": { description: "Event or registration not found." },
    "500": { description: "Management-link signing is not configured." },
  },
};
export const adminRegistrationPatchRouteSchema = {
  tags: ["Admin registrations"],
  summary: "Update a registration",
  request: {
    params: adminRegistrationParamsSchema,
    body: { content: { "application/json": { schema: adminRegistrationUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Registration updated.",
      content: { "application/json": { schema: adminRegistrationUpdateResponseSchema } },
    },
  },
};
export const adminRegistrationAdmitRouteSchema = {
  tags: ["Admin registrations"],
  summary: "Admit a registration",
  request: {
    params: adminRegistrationParamsSchema,
    body: { content: { "application/json": { schema: adminRegistrationAdmitSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Registration admitted.",
      content: { "application/json": { schema: adminRegistrationAdmitResponseSchema } },
    },
  },
};
export const adminRegistrationResendConfirmationRouteSchema = {
  tags: ["Admin registrations"],
  summary: "Resend registration confirmation",
  request: { params: adminRegistrationParamsSchema },
  responses: {
    "200": {
      description: "Confirmation queued.",
      content: { "application/json": { schema: adminRegistrationResendConfirmationResponseSchema } },
    },
  },
};
