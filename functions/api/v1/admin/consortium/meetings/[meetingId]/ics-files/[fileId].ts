/**
 * PATCH  /api/v1/admin/consortium/meetings/:meetingId/ics-files/:fileId —
 *        update label or activate/deactivate an ICS file.
 * DELETE /api/v1/admin/consortium/meetings/:meetingId/ics-files/:fileId —
 *        delete an ICS file outright (R2 object included).
 */
import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../../../_lib/services/audit";
import { updateIcsFile, deleteIcsFile } from "../../../../../../../_lib/services/meeting-calendar";
import {
  consortiumMeetingIcsUpdateRouteSchema,
  consortiumMeetingIcsDeleteRouteSchema,
} from "../../../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";

export const ConsortiumMeetingIcsUpdatePatch = openApiRoute(
  consortiumMeetingIcsUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    requirePermission(admin, "working-groups:write");

    const body = data.body;
    const icsFile = await updateIcsFile(
      db,
      data.params.meetingId,
      data.params.fileId,
      { scopeType: "consortium" },
      body,
    );
    return json({ icsFile });
  },
);

export const ConsortiumMeetingIcsDelete = openApiRoute(
  consortiumMeetingIcsDeleteRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    requirePermission(admin, "working-groups:write");

    const meetingId = data.params.meetingId;
    const fileId = data.params.fileId;
    const { r2Key } = await deleteIcsFile(db, meetingId, fileId, { scopeType: "consortium" });
    if (c.env.ASSETS_BUCKET) await c.env.ASSETS_BUCKET.delete(r2Key);
    await writeAuditLog(db, "admin", admin.id, "meeting_ics_file_deleted", "meeting_ics_file", fileId, {
      scopeType: "consortium",
      seriesId: meetingId,
    });
    return json({ success: true });
  },
);
