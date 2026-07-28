/**
 * GET/POST /api/v1/admin/working-groups/:id/meetings — list/create meeting
 * series for a working group (PRD §4.12). Access is gated by this router's
 * own middleware (see ./router.ts), not by a per-handler requirePermission
 * call — matches events/[eventSlug]/router.ts's requireEventManagementAccess
 * precedent.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../../_lib/http";
import { parseJsonBody } from "../../../../../../_lib/validation";
import { listAdminMeetingSeriesForWg, createWgMeetingSeries } from "../../../../../../_lib/services/meeting-calendar";
import { meetingSeriesCreateSchema } from "../../../../../../../assets/shared/schemas/meeting-calendar";
import {
  wgMeetingsListRouteSchema,
  wgMeetingsCreateRouteSchema,
} from "../../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const meetingSeries = await listAdminMeetingSeriesForWg(requestDb(c), c.req.param("id"));
  return json({ meetingSeries });
}

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const body = await parseJsonBody(c.req, meetingSeriesCreateSchema);
  const meetingSeries = await createWgMeetingSeries(requestDb(c), c.req.param("id"), body);
  return json({ meetingSeries }, 201);
}

export class WgMeetingsGet extends OpenAPIRoute {
  schema = wgMeetingsListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

export class WgMeetingsCreate extends OpenAPIRoute {
  schema = wgMeetingsCreateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
