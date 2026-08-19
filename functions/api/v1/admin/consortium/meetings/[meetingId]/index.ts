/**
 * PATCH  /api/v1/admin/consortium/meetings/:meetingId — update a consortium
 *        meeting series (name, active status).
 * DELETE /api/v1/admin/consortium/meetings/:meetingId — delete a consortium
 *        meeting series, its ICS files, and any member preferences.
 */
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import { updateMeetingSeries, deleteMeetingSeries } from "../../../../../../_lib/services/meeting-calendar";
import {
  consortiumMeetingUpdateRouteSchema,
  consortiumMeetingDeleteRouteSchema,
} from "../../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";

export const ConsortiumMeetingUpdate = openApiRoute(
  consortiumMeetingUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    requirePermission(admin, "working-groups:write");

    const body = data.body;
    const meetingSeries = await updateMeetingSeries(
      requestDb(c),
      data.params.meetingId,
      { scopeType: "consortium" },
      body,
    );
    return json({ meetingSeries });
  },
);

export const ConsortiumMeetingDelete = openApiRoute(
  consortiumMeetingDeleteRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    requirePermission(admin, "working-groups:write");

    const meetingId = data.params.meetingId;
    await deleteMeetingSeries(db, c.env.ASSETS_BUCKET, meetingId, { scopeType: "consortium" });
    await writeAuditLog(db, "admin", admin.id, "meeting_series_deleted", "meeting_series", meetingId, {
      scopeType: "consortium",
    });
    return json({ success: true });
  },
);
