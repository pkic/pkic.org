/**
 * POST /api/v1/admin/working-groups/:id/meetings/:meetingId/resend —
 * trigger the annual bulk resend for a working group meeting series.
 * Smart-routed: members with a saved, still-active preference
 * get only that variant; everyone else gets all active variants.
 */
import { json } from "../../../../../../../_lib/http";
import { AppError } from "../../../../../../../_lib/errors";
import { getWorkingGroupBySlugOrId } from "../../../../../../../_lib/services/working-groups";
import { queueAnnualResend } from "../../../../../../../_lib/services/meeting-calendar";
import { getConfig } from "../../../../../../../_lib/config";
import { wgMeetingResendRouteSchema } from "../../../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";

export const WgMeetingResendPost = openApiRoute(wgMeetingResendRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const wg = await getWorkingGroupBySlugOrId(db, data.params.id);
  if (!wg) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");

  const result = await queueAnnualResend(
    db,
    data.params.meetingId,
    { scopeType: "working_group", workingGroupId: wg.id },
    getConfig(c.env).adminCampaignMaxRecipients,
  );
  return json({ success: true, ...result });
});
