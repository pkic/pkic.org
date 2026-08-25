/**
 * GET /api/v1/portal/votes/:id/results — full result detail after close.
 * Results are hidden from all users until closes_at.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { getVoteResultsForMember } from "../../../../../_lib/services/votes";
import { voteResultsRouteSchema } from "../../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const PortalVoteResultsGet = openApiRoute(voteResultsRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const id = data.params.id;
  const result = await getVoteResultsForMember(db, member, id);
  return json({ result });
});
