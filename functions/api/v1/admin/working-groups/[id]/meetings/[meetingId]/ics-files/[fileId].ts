/**
 * PATCH  /api/v1/admin/working-groups/:id/meetings/:meetingId/ics-files/:fileId
 *        — update label or activate/deactivate an ICS file.
 * DELETE /api/v1/admin/working-groups/:id/meetings/:meetingId/ics-files/:fileId
 *        — delete an ICS file outright (R2 object included).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../../../../_lib/http";
import { parseJsonBody } from "../../../../../../../../_lib/validation";
import { AppError } from "../../../../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../../../../_lib/auth/admin";
import { writeAuditLog } from "../../../../../../../../_lib/services/audit";
import { getWorkingGroupBySlugOrId } from "../../../../../../../../_lib/services/working-groups";
import { updateIcsFile, deleteIcsFile } from "../../../../../../../../_lib/services/meeting-calendar";
import {
  meetingIcsFileUpdateSchema,
  wgMeetingIcsUpdateRouteSchema,
  wgMeetingIcsDeleteRouteSchema,
} from "../../../../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../../../../_lib/db/context";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const wg = await getWorkingGroupBySlugOrId(db, c.req.param("id"));
  if (!wg) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");

  const body = await parseJsonBody(c.req, meetingIcsFileUpdateSchema);
  const icsFile = await updateIcsFile(
    db,
    c.req.param("meetingId"),
    c.req.param("fileId"),
    { scopeType: "working_group", workingGroupId: wg.id },
    body,
  );
  return json({ icsFile });
}

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const wg = await getWorkingGroupBySlugOrId(db, c.req.param("id"));
  if (!wg) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");

  // Access is already gated by this resource's own router middleware (see
  // ../../router.ts's requireWgMeetingsAccess) — requireAdminFromRequest
  // here just re-reads the (request-cached) admin to get its id for the
  // audit log.
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);

  const meetingId = c.req.param("meetingId");
  const fileId = c.req.param("fileId");
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
}

export class WgMeetingIcsUpdatePatch extends OpenAPIRoute {
  schema = wgMeetingIcsUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}

export class WgMeetingIcsDelete extends OpenAPIRoute {
  schema = wgMeetingIcsDeleteRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestDelete(c);
  }
}
