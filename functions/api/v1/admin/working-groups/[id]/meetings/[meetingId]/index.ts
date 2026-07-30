/**
 * PATCH  /api/v1/admin/working-groups/:id/meetings/:meetingId — update a
 *        working group meeting series (name, active status) (PRD §4.12).
 * DELETE /api/v1/admin/working-groups/:id/meetings/:meetingId — delete a
 *        working group meeting series, its ICS files, and any member
 *        preferences.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../../../_lib/http";
import { parseJsonBody } from "../../../../../../../_lib/validation";
import { AppError } from "../../../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { writeAuditLog } from "../../../../../../../_lib/services/audit";
import { getWorkingGroupBySlugOrId } from "../../../../../../../_lib/services/working-groups";
import { updateMeetingSeries, deleteMeetingSeries } from "../../../../../../../_lib/services/meeting-calendar";
import {
  meetingSeriesUpdateSchema,
  wgMeetingUpdateRouteSchema,
  wgMeetingDeleteRouteSchema,
} from "../../../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const wg = await getWorkingGroupBySlugOrId(db, c.req.param("id"));
  if (!wg) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");

  const body = await parseJsonBody(c.req, meetingSeriesUpdateSchema);
  const meetingSeries = await updateMeetingSeries(
    db,
    c.req.param("meetingId"),
    { scopeType: "working_group", workingGroupId: wg.id },
    body,
  );
  return json({ meetingSeries });
}

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const wg = await getWorkingGroupBySlugOrId(db, c.req.param("id"));
  if (!wg) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");

  // Access is already gated by this resource's own router middleware (see
  // ../router.ts's requireWgMeetingsAccess) — requireAdminFromRequest here
  // just re-reads the (request-cached) admin to get its id for the audit
  // log, matching the ../../members/[userId].ts precedent.
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);

  const meetingId = c.req.param("meetingId");
  const { deletedIcsFileR2Keys } = await deleteMeetingSeries(db, meetingId, {
    scopeType: "working_group",
    workingGroupId: wg.id,
  });
  const bucket = c.env.ASSETS_BUCKET;
  if (bucket) {
    await Promise.allSettled(deletedIcsFileR2Keys.map((key) => bucket.delete(key)));
  }
  await writeAuditLog(db, "admin", admin.id, "meeting_series_deleted", "meeting_series", meetingId, {
    scopeType: "working_group",
    workingGroupId: wg.id,
  });
  return json({ success: true });
}

export class WgMeetingUpdate extends OpenAPIRoute {
  schema = wgMeetingUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}

export class WgMeetingDelete extends OpenAPIRoute {
  schema = wgMeetingDeleteRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestDelete(c);
  }
}
