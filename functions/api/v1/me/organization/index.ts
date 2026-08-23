/**
 * GET   /api/v1/me/organization — view my organization's current live profile
 * PATCH /api/v1/me/organization — submit a content change for staff review
 *
 * GET is available to any org-tied member (read-only for
 * non-contacts); PATCH is restricted to the primary/secondary contact by
 * submitOrgContentChange itself.
 */
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { getConfig } from "../../../../_lib/config";
import {
  getMyOrganizationProfile,
  processOrganizationContentReviewNotificationsBackground,
  submitOrgContentChange,
} from "../../../../_lib/services/organization-content";
import {
  myOrganizationContentChangeRouteSchema,
  myOrganizationContentChangeResponseSchema,
  myOrganizationProfileGetRouteSchema,
} from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const MeOrganizationGet = openApiRoute(myOrganizationProfileGetRouteSchema, async (c: AdminContext) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const profile = await getMyOrganizationProfile(db, member);
  return json(profile);
});

export const MeOrganizationPatch = openApiRoute(
  myOrganizationContentChangeRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    const { review } = await submitOrgContentChange(
      db,
      member,
      data.body,
      `${getConfig(c.env, c.req.raw).appBaseUrl}/admin/#/organizations/content-reviews`,
    );

    c.executionCtx.waitUntil(processOrganizationContentReviewNotificationsBackground(db, c.env));

    return json(myOrganizationContentChangeResponseSchema.parse({ review }));
  },
);
