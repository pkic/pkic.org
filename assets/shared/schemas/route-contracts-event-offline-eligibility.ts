import { requiresAnyPermissions } from "./route-contract";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import {
  enrolledOfflineEligibilityQuerySchema,
  enrolledOfflineEligibilityResponseSchema,
} from "./event-offline-eligibility";
export const offlineEligibilityRouteSchema = {
  ...requiresAnyPermissions(["agenda:scan"], ["agenda:check"], ["agenda:admit"], ["agenda:attendance_record"]),
  tags: ["Events"],
  summary: "Download scoped identifiers-only offline eligibility evidence",
  request: { params: eventSlugParamsSchema, query: enrolledOfflineEligibilityQuerySchema },
  responses: {
    "200": {
      description: "Short-lived eligibility page; no seat allocation",
      content: { "application/json": { schema: enrolledOfflineEligibilityResponseSchema } },
    },
    "403": jsonErrorResponse("Scanning permission required"),
    "409": jsonErrorResponse("Approved revision changed"),
  },
};
