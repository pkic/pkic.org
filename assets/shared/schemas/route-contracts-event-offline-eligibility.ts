import { requiresPermissions } from "./route-contract";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { offlineEligibilityQuerySchema, offlineEligibilityResponseSchema } from "./event-offline-eligibility";
export const offlineEligibilityRouteSchema = {
  ...requiresPermissions("agenda:scan"),
  tags: ["Events"],
  summary: "Download scoped identifiers-only offline eligibility evidence",
  request: { params: eventSlugParamsSchema, query: offlineEligibilityQuerySchema },
  responses: {
    "200": {
      description: "Short-lived eligibility page; no seat allocation",
      content: { "application/json": { schema: offlineEligibilityResponseSchema } },
    },
    "403": jsonErrorResponse("Scanning permission required"),
    "409": jsonErrorResponse("Approved revision changed"),
  },
};
