import {
  analyticsSummaryResponseSchema,
  analyticsSummaryRouteSchema,
  donationAnalyticsResponseSchema,
  donationAnalyticsRouteSchema,
  registrationAnalyticsResponseSchema,
  registrationAnalyticsRouteSchema,
} from "../../../../assets/shared/schemas/analytics";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { getAnalyticsSummary, getDonationAnalytics, getRegistrationAnalytics } from "../../../_lib/services/analytics";
import type { AdminContext } from "../../../_lib/db/context";
import { requireStaffPermission } from "../../../_lib/auth/staff-permissions";

export const AnalyticsSummaryGet = openApiRoute(analyticsSummaryRouteSchema, async (c: AdminContext) => {
  const { db } = await requireStaffPermission(c, "analytics:read");
  return json(analyticsSummaryResponseSchema.parse(await getAnalyticsSummary(db)));
});

export const RegistrationAnalyticsGet = openApiRoute(registrationAnalyticsRouteSchema, async (c: AdminContext) => {
  const { db } = await requireStaffPermission(c, "analytics:read");
  return json(registrationAnalyticsResponseSchema.parse(await getRegistrationAnalytics(db)));
});

export const DonationAnalyticsGet = openApiRoute(donationAnalyticsRouteSchema, async (c: AdminContext) => {
  const { db } = await requireStaffPermission(c, "analytics:read");
  return json(donationAnalyticsResponseSchema.parse(await getDonationAnalytics(db)));
});
