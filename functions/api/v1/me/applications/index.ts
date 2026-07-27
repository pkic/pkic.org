/**
 * GET /api/v1/me/applications — my application history (PRD §4.10).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { listMyApplications } from "../../../../_lib/services/member-self-service";
import { myApplicationsListRouteSchema } from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const applications = await listMyApplications(db, member);
  return json({ applications });
}

export class MeApplicationsGet extends OpenAPIRoute {
  schema = myApplicationsListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
