import { requiresAnyPermissions } from "./route-contract";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import {
  enrolledOfflineEligibilityQuerySchema,
  enrolledOfflineEligibilityResponseSchema,
} from "./event-offline-eligibility";
export const offlineEligibilityRouteSchema = {
  ...requiresAnyPermissions(["agenda:scan"], ["agenda:check"], ["agenda:admit"], ["agenda:attendance_record"]),
  tags: ["Events"],
  summary: "Download scoped offline eligibility and optional encrypted badge collection names",
  request: { params: eventSlugParamsSchema, query: enrolledOfflineEligibilityQuerySchema },
  responses: {
    "200": {
      description: "Bounded offline eligibility page; no seat allocation",
      content: { "application/json": { schema: enrolledOfflineEligibilityResponseSchema } },
    },
    "403": jsonErrorResponse("Scanning permission required"),
    "409": jsonErrorResponse("Approved revision changed"),
  },
};
