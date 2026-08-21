import { eventSlugParamsSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema } from "./pagination";
import { adminRegistrationDetailResponseSchema } from "./admin-registration-detail";

export const adminRegistrationAuditLogRouteSchema = {
  tags: ["Admin events"],
  summary: "List registration audit log",
  description: "Returns recent audit events attached to a registration in the requested event.",
  request: {
    params: eventSlugParamsSchema.extend({ registrationId: databaseIdSchema }),
    query: listQuerySchema(["createdAt", "action", "actor"] as const),
  },
  responses: {
    "200": { description: "Registration audit log entries." },
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
