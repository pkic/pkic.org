import {
  analyticsSummaryResponseSchema,
  analyticsSummaryRouteSchema,
  donationAnalyticsResponseSchema,
  donationAnalyticsRouteSchema,
  registrationAnalyticsResponseSchema,
  registrationAnalyticsRouteSchema,
  membershipAnalyticsResponseSchema,
  membershipAnalyticsRouteSchema,
  organizationAnalyticsResponseSchema,
  organizationAnalyticsRouteSchema,
  userAnalyticsResponseSchema,
  userAnalyticsRouteSchema,
} from "../../../../assets/shared/schemas/analytics";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import {
  getAnalyticsSummary,
  getDonationAnalytics,
  getMembershipAnalytics,
  getOrganizationAnalytics,
  getRegistrationAnalytics,
  getUserAnalytics,
} from "../../../_lib/services/analytics";
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

/*
 * A page per domain, measuring the domain it belongs to (#39).
 *
 * They answer under `/analytics` beside the registration and donation pages
 * rather than as `/members/analytics`, because `analytics` there would be
 * read as a membership id — the reserved-segment problem the portal's own
 * routes solve by ordering. One permission guards all of them: reading
 * aggregate numbers about people is `analytics:read`, whoever else's list you
 * may otherwise browse.
 */
export const MembershipAnalyticsGet = openApiRoute(membershipAnalyticsRouteSchema, async (c: AdminContext) => {
  const { db } = await requireStaffPermission(c, "analytics:read");
  return json(membershipAnalyticsResponseSchema.parse(await getMembershipAnalytics(db)));
});

export const OrganizationAnalyticsGet = openApiRoute(organizationAnalyticsRouteSchema, async (c: AdminContext) => {
  const { db } = await requireStaffPermission(c, "analytics:read");
  return json(organizationAnalyticsResponseSchema.parse(await getOrganizationAnalytics(db)));
});

export const UserAnalyticsGet = openApiRoute(userAnalyticsRouteSchema, async (c: AdminContext) => {
  const { db } = await requireStaffPermission(c, "analytics:read");
  return json(userAnalyticsResponseSchema.parse(await getUserAnalytics(db)));
});
