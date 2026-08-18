/**
 * PATCH  /api/v1/admin/working-groups/:id/meetings/:meetingId/ics-files/:fileId
 *        — update label or activate/deactivate an ICS file.
 * DELETE /api/v1/admin/working-groups/:id/meetings/:meetingId/ics-files/:fileId
 *        — delete an ICS file outright (R2 object included).
 */
import { json } from "../../../../../../../../_lib/http";
import { AppError } from "../../../../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../../../../_lib/auth/admin";
import { writeAuditLog } from "../../../../../../../../_lib/services/audit";
import { getWorkingGroupBySlugOrId } from "../../../../../../../../_lib/services/working-groups";
import { updateIcsFile, deleteIcsFile } from "../../../../../../../../_lib/services/meeting-calendar";
import {
  wgMeetingIcsUpdateRouteSchema,
  wgMeetingIcsDeleteRouteSchema,
} from "../../../../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../../../_lib/openapi/route";

export const WgMeetingIcsUpdatePatch = openApiRoute(wgMeetingIcsUpdateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const wg = await getWorkingGroupBySlugOrId(db, data.params.id);
  if (!wg) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");

  const body = data.body;
  const icsFile = await updateIcsFile(
    db,
    data.params.meetingId,
    data.params.fileId,
    { scopeType: "working_group", workingGroupId: wg.id },
    body,
  );
  return json({ icsFile });
});

export const WgMeetingIcsDelete = openApiRoute(wgMeetingIcsDeleteRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const wg = await getWorkingGroupBySlugOrId(db, data.params.id);
  if (!wg) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");

  // Access is already gated by the parent working-groups/:id/ router's own
  // middleware (see ../../../router.ts's requireWorkingGroupAccess) —
  // requireAdminFromRequest here just re-reads the (request-cached) admin
  // to get its id for the audit log.
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);

  const meetingId = data.params.meetingId;
  const fileId = data.params.fileId;
  const { r2Key } = await deleteIcsFile(db, meetingId, fileId, {
    scopeType: "working_group",
    workingGroupId: wg.id,
  });
  if (c.env.ASSETS_BUCKET) await c.env.ASSETS_BUCKET.delete(r2Key);
  await writeAuditLog(db, "admin", admin.id, "meeting_ics_file_deleted", "meeting_ics_file", fileId, {
    scopeType: "working_group",
    workingGroupId: wg.id,
    seriesId: meetingId,
  });
  return json({ success: true });
});
