/**
 * PATCH  /api/v1/admin/working-groups/:id/meetings/:meetingId — update a
 *        working group meeting series (name, active status).
 * DELETE /api/v1/admin/working-groups/:id/meetings/:meetingId — delete a
 *        working group meeting series, its ICS files, and any member
 *        preferences.
 */
import { json } from "../../../../../../../_lib/http";
import { AppError } from "../../../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { writeAuditLog } from "../../../../../../../_lib/services/audit";
import { getWorkingGroupBySlugOrId } from "../../../../../../../_lib/services/working-groups";
import { updateMeetingSeries, deleteMeetingSeries } from "../../../../../../../_lib/services/meeting-calendar";
import {
  wgMeetingUpdateRouteSchema,
  wgMeetingDeleteRouteSchema,
} from "../../../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";

export const WgMeetingUpdate = openApiRoute(wgMeetingUpdateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const wg = await getWorkingGroupBySlugOrId(db, data.params.id);
  if (!wg) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");

  const body = data.body;
  const meetingSeries = await updateMeetingSeries(
    db,
    data.params.meetingId,
    { scopeType: "working_group", workingGroupId: wg.id },
    body,
  );
  return json({ meetingSeries });
});

export const WgMeetingDelete = openApiRoute(wgMeetingDeleteRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const wg = await getWorkingGroupBySlugOrId(db, data.params.id);
  if (!wg) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");

  // Access is already gated by the parent working-groups/:id/ router's own
  // middleware (see ../../router.ts's requireWorkingGroupAccess) —
  // requireAdminFromRequest here just re-reads the (request-cached) admin
  // to get its id for the audit log, matching the ../../members/[userId].ts
  // precedent.
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);

  const meetingId = data.params.meetingId;
  await deleteMeetingSeries(db, c.env.ASSETS_BUCKET, meetingId, {
    scopeType: "working_group",
    workingGroupId: wg.id,
  });
  await writeAuditLog(db, "admin", admin.id, "meeting_series_deleted", "meeting_series", meetingId, {
    scopeType: "working_group",
    workingGroupId: wg.id,
  });
  return json({ success: true });
});
