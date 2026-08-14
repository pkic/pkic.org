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
import { findUsersWithPermission } from "../../../../_lib/auth/permissions";
import { queueEmail, processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { getConfig } from "../../../../_lib/config";
import {
  getMyOrganizationProfile,
  submitOrgContentChange,
} from "../../../../_lib/services/organization-content-reviews";
import {
  myOrganizationContentChangeRouteSchema,
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
    const { review, organizationName } = await submitOrgContentChange(db, member, data.body);

    const config = getConfig(c.env, c.req.raw);
    // Hash-routed admin SPA (wouter's useHashLocation) — matches
    // membership-scheduled-jobs.ts's reviewUrl convention. Links to the queue
    // list, not a per-review deep link — the admin UI's Content Review screen
    // is a list/detail split with no :id route param.
    const reviewUrl = `${config.appBaseUrl}/admin/#/organizations/content-reviews`;
    const recipients = await findUsersWithPermission(db, "organizations:content-review");
    for (const email of recipients) {
      const outboxId = await queueEmail(db, {
        templateKey: "org-content-submitted",
        recipientEmail: email,
        messageType: "transactional",
        subject: `Organization content change submitted for review — ${organizationName}`,
        data: { organizationName, submitterName: member.email, reviewUrl },
      });
      c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));
    }

    return json({ review });
  },
);
