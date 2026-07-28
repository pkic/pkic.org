/**
 * PATCH /api/v1/admin/working-groups/:id/meetings/:meetingId — update a
 * working group meeting series (name, active status) (PRD §4.12).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../../../_lib/http";
import { parseJsonBody } from "../../../../../../../_lib/validation";
import { AppError } from "../../../../../../../_lib/errors";
import { getWorkingGroupBySlugOrId } from "../../../../../../../_lib/services/working-groups";
import { updateMeetingSeries } from "../../../../../../../_lib/services/meeting-calendar";
import {
  meetingSeriesUpdateSchema,
  wgMeetingUpdateRouteSchema,
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

export class WgMeetingUpdate extends OpenAPIRoute {
  schema = wgMeetingUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}
