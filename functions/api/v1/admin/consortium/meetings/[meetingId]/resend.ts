/**
 * POST /api/v1/admin/consortium/meetings/:meetingId/resend — trigger the
 * annual bulk resend for the consortium meeting series. Smart-
 * routed: active members with a saved, still-active preference get only
 * that variant; everyone else gets all active variants.
 */
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { queueAnnualResend } from "../../../../../../_lib/services/meeting-calendar";
import { getConfig } from "../../../../../../_lib/config";
import { consortiumMeetingResendRouteSchema } from "../../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";

export const ConsortiumMeetingResendPost = openApiRoute(
  consortiumMeetingResendRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    requirePermission(admin, "working-groups:write");

    const result = await queueAnnualResend(
      db,
      data.params.meetingId,
      { scopeType: "consortium" },
      getConfig(c.env).adminCampaignMaxRecipients,
    );
    return json({ success: true, ...result });
  },
);
