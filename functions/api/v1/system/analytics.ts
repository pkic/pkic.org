import {
  systemAnalyticsSummaryResponseSchema,
  systemAnalyticsSummaryRouteSchema,
  systemDonationAnalyticsResponseSchema,
  systemDonationAnalyticsRouteSchema,
  systemRegistrationAnalyticsResponseSchema,
  systemRegistrationAnalyticsRouteSchema,
} from "../../../../assets/shared/schemas/system-analytics";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import {
  getSystemAnalyticsSummary,
  getSystemDonationAnalytics,
  getSystemRegistrationAnalytics,
} from "../../../_lib/services/system-analytics";
import type { AdminContext } from "../../../_lib/db/context";
import { requireSystemPermission } from "./authorization";

export const SystemAnalyticsSummaryGet = openApiRoute(systemAnalyticsSummaryRouteSchema, async (c: AdminContext) => {
  const { db } = await requireSystemPermission(c, "analytics:read");
  return json(systemAnalyticsSummaryResponseSchema.parse(await getSystemAnalyticsSummary(db)));
});

export const SystemRegistrationAnalyticsGet = openApiRoute(
  systemRegistrationAnalyticsRouteSchema,
  async (c: AdminContext) => {
    const { db } = await requireSystemPermission(c, "analytics:read");
    return json(systemRegistrationAnalyticsResponseSchema.parse(await getSystemRegistrationAnalytics(db)));
  },
);

export const SystemDonationAnalyticsGet = openApiRoute(systemDonationAnalyticsRouteSchema, async (c: AdminContext) => {
  const { db } = await requireSystemPermission(c, "analytics:read");
  return json(systemDonationAnalyticsResponseSchema.parse(await getSystemDonationAnalytics(db)));
});
