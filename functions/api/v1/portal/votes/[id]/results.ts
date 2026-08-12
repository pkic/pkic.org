/**
 * GET /api/v1/portal/votes/:id/results — full result detail after close.
 * Results are hidden from all users until closes_at.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { getVoteResultsForMember } from "../../../../../_lib/services/votes";
import { voteResultsRouteSchema } from "../../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  await requireMemberFromRequest(db, c.req.raw, c.env);
  const id = c.req.param("id");
  const result = await getVoteResultsForMember(db, id);
  return json({ result });
}

export class PortalVoteResultsGet extends OpenAPIRoute {
  schema = voteResultsRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
