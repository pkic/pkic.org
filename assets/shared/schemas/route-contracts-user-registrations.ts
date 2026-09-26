import {
  currentUserRegistrationsListQuerySchema,
  currentUserRegistrationsListResponseSchema,
} from "./current-user-registrations";
import { requiresSession } from "./route-contract";

export const currentUserRegistrationsListRouteSchema = {
  ...requiresSession(),
  tags: ["Users", "Registrations"],
  summary: "List the current identity's event registrations",
  description:
    "Identity-first participation record (see IMPLEMENTATION_TRACKER.md section 13): every registration matched to the caller's own user id. Gated on the authenticated identity alone, not member capacity — a staff-only or sponsor-only session reads this exactly like a member, and a future credential-less guest identity inherits it too. Filtering, sorting, counting, and pagination run in D1.",
  request: { query: currentUserRegistrationsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of the caller's own event registrations, sorted by event start ascending.",
      content: { "application/json": { schema: currentUserRegistrationsListResponseSchema } },
    },
    "401": { description: "A signed-in session is required." },
  },
};
