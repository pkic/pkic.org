/**
 * GET /api/v1/portal/votes/:id — vote detail for the caller:
 * full aggregate/breakdown once closed, candidate list for elections, and
 * whether the caller can/already did cast a ballot.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { getVoteDetailForMember } from "../../../../../_lib/services/votes";
import { portalVoteGetRouteSchema } from "../../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const id = c.req.param("id");
  const vote = await getVoteDetailForMember(db, member, id);
  return json({ vote });
}

export class PortalVoteGet extends OpenAPIRoute {
  schema = portalVoteGetRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
