import { currentUserProposalsListQuerySchema, currentUserProposalsListResponseSchema } from "./current-user-proposals";
import { requiresSession } from "./route-contract";

export const currentUserProposalsListRouteSchema = {
  ...requiresSession(),
  tags: ["Users", "Proposals"],
  summary: "List the current identity's event proposals",
  description:
    "Identity-first participation record (see IMPLEMENTATION_TRACKER.md section 13): a READ-ONLY projection of every proposal the caller submitted or is a listed speaker on, matched to their own user id. Gated on the authenticated identity alone, not member capacity. CRITICAL BOUNDARY: proposal self-service authority lives entirely in signed capability links, which never leak through a session — this response carries no token, no capability URL, and enables no mutation; the portal pairs it with a separate resend-access-link action through the existing capability machinery. Newest-updated first; filtering, counting, and pagination run in D1.",
  request: { query: currentUserProposalsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of the caller's own proposals, newest-updated first.",
      content: { "application/json": { schema: currentUserProposalsListResponseSchema } },
    },
    "401": { description: "A signed-in session is required." },
  },
};
