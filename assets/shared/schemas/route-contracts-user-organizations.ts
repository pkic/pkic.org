import { userOrganizationsListQuerySchema, userOrganizationsListResponseSchema } from "./user-organizations";
import { requiresSession } from "./route-contract";

export const selfOrganizationsListRouteSchema = {
  ...requiresSession(),
  tags: ["Users", "Organizations"],
  summary: "List organizations the current user actively represents",
  description:
    "Membership, contact-role, and pending-review status are evaluated in D1. Every organization the caller " +
    "actively represents is included, independent of their currently selected acting capacity.",
  request: { query: userOrganizationsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded self-service organization page.",
      content: { "application/json": { schema: userOrganizationsListResponseSchema } },
    },
    "401": { description: "A member session is required." },
  },
};
