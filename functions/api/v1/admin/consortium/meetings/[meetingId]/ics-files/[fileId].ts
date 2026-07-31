/**
 * PATCH  /api/v1/admin/consortium/meetings/:meetingId/ics-files/:fileId —
 *        update label or activate/deactivate an ICS file (PRD §4.12).
 * DELETE /api/v1/admin/consortium/meetings/:meetingId/ics-files/:fileId —
 *        delete an ICS file outright (R2 object included).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../../../_lib/http";
import { parseJsonBody } from "../../../../../../../_lib/validation";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../../../_lib/services/audit";
import { updateIcsFile, deleteIcsFile } from "../../../../../../../_lib/services/meeting-calendar";
import {
  meetingIcsFileUpdateSchema,
  consortiumMeetingIcsUpdateRouteSchema,
  consortiumMeetingIcsDeleteRouteSchema,
} from "../../../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "working-groups:write");

  const body = await parseJsonBody(c.req, meetingIcsFileUpdateSchema);
  const icsFile = await updateIcsFile(
    db,
    c.req.param("meetingId"),
    c.req.param("fileId"),
    { scopeType: "consortium" },
    body,
  );
  return json({ icsFile });
}

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "working-groups:write");

  const meetingId = c.req.param("meetingId");
  const fileId = c.req.param("fileId");
  const { r2Key } = await deleteIcsFile(db, meetingId, fileId, { scopeType: "consortium" });
  if (c.env.ASSETS_BUCKET) await c.env.ASSETS_BUCKET.delete(r2Key);
  await writeAuditLog(db, "admin", admin.id, "meeting_ics_file_deleted", "meeting_ics_file", fileId, {
    scopeType: "consortium",
    seriesId: meetingId,
  });
  return json({ success: true });
}

export class ConsortiumMeetingIcsUpdatePatch extends OpenAPIRoute {
  schema = consortiumMeetingIcsUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}

export class ConsortiumMeetingIcsDelete extends OpenAPIRoute {
  schema = consortiumMeetingIcsDeleteRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestDelete(c);
  }
}
