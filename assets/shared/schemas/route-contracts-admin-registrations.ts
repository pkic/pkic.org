import { eventSlugParamsSchema, successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { adminRegistrationDetailResponseSchema } from "./admin-registration-detail";
import { z } from "zod";
import { httpUrlSchema } from "./urls";
import { registrationManageSchema } from "./registration";
import { ADMIN_EVENT_REGISTRATION_STATUSES, adminEventRegistrationStatusSchema } from "./admin-events";
import { scopedAuditLogListQuerySchema, scopedAuditLogResponseSchema } from "./audit-log";

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
