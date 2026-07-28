/**
 * PATCH /api/v1/admin/consortium/meetings/:meetingId — update a consortium
 * meeting series (name, active status) (PRD §4.12).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../../_lib/http";
import { parseJsonBody } from "../../../../../../_lib/validation";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { updateMeetingSeries } from "../../../../../../_lib/services/meeting-calendar";
import {
  meetingSeriesUpdateSchema,
  consortiumMeetingUpdateRouteSchema,
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

export class ConsortiumMeetingUpdate extends OpenAPIRoute {
  schema = consortiumMeetingUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}
