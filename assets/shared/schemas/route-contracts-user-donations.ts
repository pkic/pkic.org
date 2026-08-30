import { currentUserDonationsListQuerySchema, currentUserDonationsListResponseSchema } from "./current-user-donations";
import { requiresSession } from "./route-contract";

export const currentUserDonationsListRouteSchema = {
  ...requiresSession(),
  tags: ["Users", "Donations"],
  summary: "List the current identity's donations",
  description:
    "Identity-first participation record (see IMPLEMENTATION_TRACKER.md section 13): every donation matched to the caller's own verified email — donations carry no user_id, so this is necessarily an email match. Gated on the authenticated identity alone, not member capacity — a staff-only or sponsor-only session reads this exactly like a member. Newest first; filtering, counting, and pagination run in D1.",
  request: { query: currentUserDonationsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of the caller's own donations, newest first.",
      content: { "application/json": { schema: currentUserDonationsListResponseSchema } },
    },
    "401": { description: "A signed-in session is required." },
  },
};
