/**
 * GET /api/v1/me/applications/:id — my application detail (PRD §4.10, §11 UI-1).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { getMyApplicationDetail } from "../../../../../_lib/services/member-self-service";
import { myApplicationDetailRouteSchema } from "../../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const application = await getMyApplicationDetail(db, member, c.req.param("id"));
  return json(application);
}

export class MeApplicationGet extends OpenAPIRoute {
  schema = myApplicationDetailRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
