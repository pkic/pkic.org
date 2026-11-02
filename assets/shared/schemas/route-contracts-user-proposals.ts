import { currentUserProposalsListQuerySchema, currentUserProposalsListResponseSchema } from "./current-user-proposals";
import { requiresSession } from "./route-contract";

export const currentUserProposalsListRouteSchema = {
  ...requiresSession(),
  tags: ["Users", "Proposals"],
  summary: "List the current identity's event proposals",
  description:
    "A read-only list of proposals the signed-in person submitted or is a speaker on. The response includes their participation status and no capability links. Proposal and speaker actions use their own authorization checks. Filtering, sorting, and pagination run in D1.",
  request: { query: currentUserProposalsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of the caller's own proposals, newest-updated first.",
      content: { "application/json": { schema: currentUserProposalsListResponseSchema } },
    },
    "401": { description: "A signed-in session is required." },
  },
};
