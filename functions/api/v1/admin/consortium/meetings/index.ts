/**
 * GET/POST /api/v1/admin/consortium/meetings — list/create consortium
 * meeting series (PRD §4.12). Staff admin only — see ./router.ts.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { parseJsonBody } from "../../../../../_lib/validation";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import {
  listAdminConsortiumMeetingSeries,
  createConsortiumMeetingSeries,
} from "../../../../../_lib/services/meeting-calendar";
import { meetingSeriesCreateSchema } from "../../../../../../assets/shared/schemas/meeting-calendar";
import {
  consortiumMeetingsListRouteSchema,
  consortiumMeetingsCreateRouteSchema,
} from "../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "working-groups:read");
  const meetingSeries = await listAdminConsortiumMeetingSeries(requestDb(c));
  return json({ meetingSeries });
}

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "working-groups:write");
  const body = await parseJsonBody(c.req, meetingSeriesCreateSchema);
  const meetingSeries = await createConsortiumMeetingSeries(requestDb(c), body);
  return json({ meetingSeries }, 201);
}

export class ConsortiumMeetingsGet extends OpenAPIRoute {
  schema = consortiumMeetingsListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

export class ConsortiumMeetingsCreate extends OpenAPIRoute {
  schema = consortiumMeetingsCreateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
