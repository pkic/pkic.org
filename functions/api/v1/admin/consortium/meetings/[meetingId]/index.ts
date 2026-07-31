/**
 * PATCH  /api/v1/admin/consortium/meetings/:meetingId — update a consortium
 *        meeting series (name, active status) (PRD §4.12).
 * DELETE /api/v1/admin/consortium/meetings/:meetingId — delete a consortium
 *        meeting series, its ICS files, and any member preferences.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../../_lib/http";
import { parseJsonBody } from "../../../../../../_lib/validation";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import { updateMeetingSeries, deleteMeetingSeries } from "../../../../../../_lib/services/meeting-calendar";
import {
  meetingSeriesUpdateSchema,
  consortiumMeetingUpdateRouteSchema,
  consortiumMeetingDeleteRouteSchema,
} from "../../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "working-groups:write");

  const body = await parseJsonBody(c.req, meetingSeriesUpdateSchema);
  const meetingSeries = await updateMeetingSeries(
    requestDb(c),
    c.req.param("meetingId"),
    { scopeType: "consortium" },
    body,
  );
  return json({ meetingSeries });
}

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "working-groups:write");

  const meetingId = c.req.param("meetingId");
  const { deletedIcsFileR2Keys } = await deleteMeetingSeries(db, meetingId, { scopeType: "consortium" });
  const bucket = c.env.ASSETS_BUCKET;
  if (bucket) {
    await Promise.allSettled(deletedIcsFileR2Keys.map((key) => bucket.delete(key)));
  }
  await writeAuditLog(db, "admin", admin.id, "meeting_series_deleted", "meeting_series", meetingId, {
    scopeType: "consortium",
  });
  return json({ success: true });
}

export class ConsortiumMeetingUpdate extends OpenAPIRoute {
  schema = consortiumMeetingUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}

export class ConsortiumMeetingDelete extends OpenAPIRoute {
  schema = consortiumMeetingDeleteRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestDelete(c);
  }
}
